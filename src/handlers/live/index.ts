import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.ts";
import { message } from "../../db/schema.ts";
import {
  searchSimilarMemories,
  type MemorySearchResult,
} from "../../memory/search.ts";
import { Embed } from "../../openai.ts";
import type {
  MessageInsert,
  StoryHandler,
  StoryHandlerContext,
} from "../index.ts";
import {
  extractEventText,
  liveInputSchema,
  normalizeToEvent,
  type LiveEvent,
  type LiveInput,
} from "./events.ts";
import { buildEventSpecificPrompt } from "./event-builders/index.ts";
import {
  getCharacterBasicSettings,
  getStreamProgramSettings,
  getResponseFormatSettings,
} from "./settings/index.ts";

const clipSchema = z.object({
  body: z.string().describe("身体动作/姿势描"),
  face: z.string().describe("面部表情描述"),
  speech: z.string().describe("VTuber要说的文本内容"),
});

const outputSchema = z.object({
  clips: z.array(clipSchema).min(1).max(3).describe("VTuber回复的1-3个片段"),
});

type LiveInputParsed = z.output<typeof liveInputSchema>;
type LiveResponse = z.output<typeof outputSchema>;
type LiveMessage = MessageInsert<LiveInputParsed, LiveResponse>;

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const HISTORY_LIMIT = 20;
const MAX_MEMORY_RESULTS = 5;
const MIN_MEMORY_SIMILARITY = 0.4;

function getTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "清晨";
  if (hour >= 8 && hour < 12) return "上午";
  if (hour >= 12 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 22) return "晚上";
  return "深夜";
}

function buildTimeContext(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString("zh-CN", { weekday: "long" });
  const date = now.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return [
    "## 当前时间信息",
    `- 当前时间：${date}`,
    `- 星期：${weekday}`,
    `- 时段：${getTimeOfDay(now)}`,
  ].join("\n");
}

async function buildRelevantMemories(
  userId: string,
  searchText: string | null,
): Promise<string> {
  if (!searchText?.trim()) {
    return "(本次事件无需记忆检索)";
  }

  try {
    const embeddings = (await Embed([searchText.trim()])) as number[][];
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding) {
      return "(无法检索记忆)";
    }
    const memories = await searchSimilarMemories(queryEmbedding, {
      topK: MAX_MEMORY_RESULTS,
      userId,
      minSimilarity: MIN_MEMORY_SIMILARITY,
    });

    if (memories.length === 0) {
      return "(没有找到相关记忆)";
    }

    return [
      "以下是与你的历史互动中可能相关的记忆：",
      formatMemories(memories),
    ].join("\n");
  } catch (error) {
    console.error("Failed to retrieve memories for live handler", error);
    return "(无法检索记忆)";
  }
}

function formatMemories(memories: MemorySearchResult[]): string {
  return memories
    .map(({ memory }) => {
      const parts: string[] = [];
      parts.push(memory.content ?? "(未记录内容)");
      const meta: string[] = [];
      if (memory.category) meta.push(`category: ${memory.category}`);
      if (typeof memory.importance === "number")
        meta.push(`importance: ${memory.importance}`);
      if (typeof memory.confidence === "number")
        meta.push(`confidence: ${memory.confidence.toFixed(2)}`);
      if (meta.length > 0) {
        parts.push(`[${meta.join(" | ")}]`);
      }
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

async function loadRecentMessages(storyId: number): Promise<LiveMessage[]> {
  const rows = await db
    .select({ contentType: message.contentType, content: message.content })
    .from(message)
    .where(eq(message.storyId, storyId))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(HISTORY_LIMIT);

  return rows
    .reverse()
    .map((record) => parseStoredMessage(record))
    .filter((msg): msg is LiveMessage => msg !== null);
}

function parseStoredMessage(record: {
  contentType: string;
  content: unknown;
}): LiveMessage | null {
  if (record.contentType === "input") {
    const parsed = liveInputSchema.safeParse(record.content);
    if (parsed.success) {
      return { contentType: "input", content: parsed.data };
    }
    return null;
  }

  if (record.contentType === "response") {
    const parsed = outputSchema.safeParse(record.content);
    if (parsed.success) {
      return { contentType: "response", content: parsed.data };
    }
    return null;
  }

  return null;
}

function liveMessageToString(message: LiveMessage): string {
  if (message.contentType === "input") {
    const event = normalizeToEvent(message.content as LiveInput);
    return formatEventText(event);
  }

  const clips = message.content.clips;
  const speech = clips
    .map((clip) => clip.speech)
    .filter((text) => typeof text === "string" && text.trim().length > 0)
    .join(" ");

  if (speech.trim().length > 0) {
    return `Sayo: ${speech}`;
  }

  return `Sayo: ${JSON.stringify(message.content)}`;
}

function formatEventText(event: LiveEvent): string {
  const prefix = event.type === "bullet_chat" ? "弹幕" : "用户";

  switch (event.type) {
    case "user_chat":
      return `${prefix}: ${event.data.message}`;
    case "bullet_chat":
      return `${prefix}: ${event.data.message}`;
    case "program_event": {
      const actionText =
        {
          start: "开始",
          finish: "结束",
          pause: "暂停",
          resume: "恢复",
        }[event.data.action] || event.data.action;
      return `[节目${actionText}] ${event.data.programName}`;
    }
    case "gift_event":
      return `[礼物] ${event.data.username} 送出了 ${event.data.giftCount}x ${event.data.giftName}`;
    case "user_interaction": {
      const actionText =
        {
          follow: "关注",
          subscribe: "订阅",
          like: "点赞",
          share: "分享",
        }[event.data.action] || event.data.action;
      return `[${actionText}] ${event.data.username}`;
    }
    case "system_event":
      return `[系统] ${event.data.message || event.data.eventType}`;
    case "emotion_event":
      return `[情绪] ${event.data.emotion}`;
    case "simple_text":
      return event.data.text;
    default:
      return JSON.stringify(event);
  }
}

export const liveHandler: StoryHandler<
  typeof liveInputSchema,
  typeof outputSchema
> = {
  name: "live",
  description:
    "AI VTuber 直播事件处理器，使用中文输出 1-3 个包含动作、表情和台词的片段",
  inputSchema: liveInputSchema,
  responseSchema: outputSchema,
  async beforeGenerate(context: StoryHandlerContext<LiveInputParsed>) {
    const storyId = storyIdSchema.parse(context.storyId);
    const normalizedEvent = normalizeToEvent(context.input);

    const historyMessages = await loadRecentMessages(storyId);
    const formattedHistory = historyMessages.map((msg) =>
      liveMessageToString(msg),
    );

    const eventPrompt = await buildEventSpecificPrompt(normalizedEvent);
    const memorySearchText =
      eventPrompt.searchText ?? extractEventText(normalizedEvent) ?? null;
    const relevantMemories = await buildRelevantMemories(
      context.user.id,
      memorySearchText,
    );

    const promptSections = [
      getCharacterBasicSettings(),
      getStreamProgramSettings(),
      getResponseFormatSettings(),
      "",
      buildTimeContext(),
      "",
      "## 历史对话",
      formattedHistory.length > 0
        ? formattedHistory.join("\n")
        : "(没有之前的对话)",
      "",
      "## 相关记忆",
      relevantMemories,
      "",
      "## 当前事件",
      ...eventPrompt.sections,
      "",
      "请严格按照给定的 JSON schema 返回，生成 1-3 个片段，避免使用 Markdown 代码块。",
    ];

    const prompt = promptSections.join("\n");

    const inputMessage: LiveMessage = {
      contentType: "input",
      content: normalizedEvent,
    };

    return {
      prompt,
      responseSchema: outputSchema,
      insertMessages: [inputMessage],
    };
  },
  async afterGenerate(
    _context: StoryHandlerContext<LiveInputParsed>,
    response: LiveResponse,
  ) {
    const responseMessage: LiveMessage = {
      contentType: "response",
      content: response,
    };

    return [responseMessage];
  },
  messageToString(message: LiveMessage) {
    return liveMessageToString(message);
  },
};

export type LiveHandler = typeof liveHandler;

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
  QueryMessage,
  ResponseMessage,
  StoryHandler,
  StoryHandlerContext,
} from "../index.ts";
import { SYSTEM_PROMPT } from "./config.ts";
import { generateRuntimeContext } from "./runtime.ts";

const textChatInputSchema = z.object({
  type: z.literal("textchat"),
  message: z.string().min(1).describe("用户发送的消息"),
  userId: z.string().optional().describe("用户 ID"),
});

const commandInputSchema = z.object({
  type: z.literal("command"),
  command: z.string().describe("命令名称"),
  args: z.record(z.string(), z.any()).optional().describe("命令参数"),
});

const querySchema = z.union([textChatInputSchema, commandInputSchema]);

const responseSchema = z
  .object({
    responseType: z
      .enum(["textchat", "image", "task", "busy", "blocked", "error"])
      .describe("响应类型"),
    text: z.string().nullable().describe("文字内容或配文"),
    emotion: z.string().nullable().describe("当前心情表达 (可为空)"),
    affectionChange: z
      .number()
      .nullable()
      .describe("好感度变化 (-10 ~ 10，可为空)"),
    imageKey: z
      .string()
      .nullable()
      .describe("图片键，responseType 为 image 时使用"),
    taskType: z
      .string()
      .nullable()
      .describe("任务类型，responseType 为 task 时使用"),
    taskDelaySeconds: z
      .number()
      .nullable()
      .describe("任务延迟秒数，responseType 为 task 时使用"),
    taskContent: z
      .string()
      .nullable()
      .describe("任务内容，responseType 为 task 时使用"),
    moodChange: z
      .number()
      .nullable()
      .describe("心情数值变化 (-100 ~ 100，可为空)"),
    energyChange: z
      .number()
      .nullable()
      .describe("体力数值变化 (-100 ~ 100，可为空)"),
  })
  .describe("Ria IM Handler 输出模式，未使用字段需显式填写 null");

type IMQuery = z.output<typeof querySchema>;
type IMResponse = z.output<typeof responseSchema>;
type IMMessage = QueryMessage<IMQuery> | ResponseMessage<IMResponse>;

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const MAX_HISTORY_MESSAGES = 20;
const MAX_MEMORY_RESULTS = 5;
const MIN_MEMORY_SIMILARITY = 0;

function getQueryText(input: IMQuery): string {
  if (input.type === "textchat") {
    return input.message;
  }
  const args = input.args ? JSON.stringify(input.args) : "";
  return `Command: ${input.command}${args ? ` ${args}` : ""}`;
}

async function buildRelevantMemoriesSection(
  userId: string,
  query: string,
): Promise<string> {
  try {
    const queryEmbedding = await Embed(query);
    const memories = await searchSimilarMemories(queryEmbedding, {
      topK: MAX_MEMORY_RESULTS,
      userId,
      minSimilarity: MIN_MEMORY_SIMILARITY,
    });
    return formatMemories(memories);
  } catch (error) {
    console.error("[IM] Failed to build memory section for prompt", error);
    return "(Unable to load memories)";
  }
}

function formatMemories(memories: MemorySearchResult[]): string {
  if (memories.length === 0) {
    return "(No relevant memories found)";
  }

  return memories
    .map(({ memory }) => {
      const memoryContent = memory.content ?? "(No stored content)";
      const metadata: string[] = [];
      if (memory.category) {
        metadata.push(`category: ${memory.category}`);
      }
      if (typeof memory.importance === "number") {
        metadata.push(`importance: ${memory.importance}`);
      }
      if (typeof memory.confidence === "number") {
        metadata.push(`confidence: ${memory.confidence.toFixed(2)}`);
      }
      const metadataSuffix =
        metadata.length > 0 ? ` [${metadata.join(" | ")}]` : "";
      return `- ${memoryContent}${metadataSuffix}`;
    })
    .join("\n");
}

function parseStoredMessage(record: {
  contentType: string;
  content: unknown;
}): IMMessage | null {
  if (record.contentType === "query") {
    const parsed = querySchema.safeParse(record.content);
    if (parsed.success) {
      return { contentType: "query", content: parsed.data };
    }
    return null;
  }

  if (record.contentType === "response") {
    const parsed = responseSchema.safeParse(record.content);
    if (parsed.success) {
      return { contentType: "response", content: parsed.data };
    }
    return null;
  }

  return null;
}

export const imHandler: StoryHandler<
  typeof querySchema,
  typeof responseSchema
> = {
  name: "im",
  description:
    "Ria Virtual Idol IM Handler - One-on-one chat with state management, scheduling, and affection system",
  querySchema,
  responseSchema,

  async beforeGenerate(context: StoryHandlerContext<IMQuery>) {
    const storyId = storyIdSchema.parse(context.storyId);
    const historyMessages = (
      await db
        .select({ contentType: message.contentType, content: message.content })
        .from(message)
        .where(eq(message.storyId, storyId))
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(MAX_HISTORY_MESSAGES)
    ).reverse();

    const parsed = querySchema.parse(context.input);
    const runtimeContext = await generateRuntimeContext(
      parsed.type === "textchat"
        ? (parsed.userId ?? context.user.id)
        : context.user.id,
    );
    const relevantMemoriesSection = await buildRelevantMemoriesSection(
      context.user.id,
      getQueryText(parsed),
    );
    const formattedHistory = historyMessages
      .map((msg) => parseStoredMessage(msg))
      .filter((msg): msg is IMMessage => msg !== null)
      .map((msg) => this.messageToString(msg));

    const promptSections = [
      SYSTEM_PROMPT.replace("{CONTEXT_PLACEHOLDER}", runtimeContext),
      "## Conversation so far:",
      formattedHistory.length > 0
        ? formattedHistory.join("\n")
        : "(No previous conversation available)",
      "",
      "## Relevant memories:",
      relevantMemoriesSection,
      "",
      "## Current request:",
      parsed.type === "textchat"
        ? parsed.message
        : `Command: ${parsed.command}`,
      "",
      "Respond in JSON that matches the provided schema.",
    ];

    const queryMessage: IMMessage = {
      contentType: "query",
      content: parsed,
    };

    return {
      prompt: promptSections.join("\n"),
      responseSchema,
      queryMessage,
    };
  },

  async afterGenerate(
    _context: StoryHandlerContext<IMQuery>,
    response: IMResponse,
  ) {
    const responseMessage: IMMessage = {
      contentType: "response",
      content: response,
    };
    return responseMessage;
  },

  messageToString(message: IMMessage): string {
    if (message.contentType === "query") {
      const payload = message.content;
      if (payload.type === "textchat") {
        return `User: ${payload.message}`;
      }
      return `User (command): ${payload.command}`;
    }

    if (message.contentType === "response") {
      const payload = message.content;
      const mainText =
        payload.text ??
        (payload.responseType ? `[${payload.responseType}]` : "(no content)");
      return `Assistant: ${mainText}`;
    }

    return "(Unknown message)";
  },
};

export { querySchema, responseSchema };

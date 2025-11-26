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
import {
  extractEventText,
  getEventContext,
  liveInputSchema,
  normalizeToEvent,
  type LiveEvent,
  type LiveInput,
} from "./events.ts";

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const clipSchema = z.object({
  body: z.string().describe("身体动作/姿势描述"),
  face: z.string().describe("面部表情描述"),
  speech: z.string().describe("VTuber要说的文本内容"),
});

const responseSchema = z.object({
  clips: z.array(clipSchema).min(1).max(3).describe("VTuber回复的1-3个片段"),
});

type LiveQuery = z.output<typeof liveInputSchema>;
type LiveResponse = z.output<typeof responseSchema>;
type LiveMessage = QueryMessage<LiveQuery> | ResponseMessage<LiveResponse>;

const MAX_HISTORY_MESSAGES = 20;
const MAX_MEMORY_RESULTS = 5;
const MIN_MEMORY_SIMILARITY = 0;

function getQueryText(input: LiveInput): string {
  const event = normalizeToEvent(input);
  return extractEventText(event) ?? JSON.stringify(event);
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
    console.error("[live] Failed to build memory section for prompt", error);
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
}): LiveMessage | null {
  if (record.contentType === "query") {
    const parsed = liveInputSchema.safeParse(record.content);
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

function summarizeResponse(payload: LiveResponse): string {
  if (!payload.clips || payload.clips.length === 0) {
    return "(no clips)";
  }
  const speech = payload.clips
    .map((clip) => clip.speech?.trim())
    .filter(Boolean)
    .join(" ");
  return speech || JSON.stringify(payload.clips);
}

export const liveHandler: StoryHandler<LiveQuery, LiveResponse> = {
  name: "live",
  description:
    "AI VTuber handler generating 1-3 expressive clips (body, face, speech) from live events and chat input.",
  querySchema: liveInputSchema,
  responseSchema,

  async beforeGenerate(context: StoryHandlerContext<LiveQuery>) {
    const storyId = storyIdSchema.parse(context.storyId);
    const historyMessages = (
      await db
        .select({ contentType: message.contentType, content: message.content })
        .from(message)
        .where(eq(message.storyId, storyId))
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(MAX_HISTORY_MESSAGES)
    ).reverse();

    const parsedInput = liveInputSchema.parse(context.input);
    const normalizedEvent = normalizeToEvent(parsedInput);
    const queryText = getQueryText(parsedInput);
    const relevantMemoriesSection = await buildRelevantMemoriesSection(
      context.user.id,
      queryText,
    );
    const formattedHistory = historyMessages
      .map((msg) => parseStoredMessage(msg))
      .filter((msg): msg is LiveMessage => msg !== null)
      .map((msg) => this.messageToString(msg));

    const promptSections = [
      "你是虚拟主播「小夜」（Sayo）。根据当前事件生成1-3个片段，每个片段包含 body/face/speech 字段，输出合法 JSON。",
      "## Conversation so far:",
      formattedHistory.length > 0
        ? formattedHistory.join("\n")
        : "(No previous conversation available)",
      "",
      "## Relevant memories:",
      relevantMemoriesSection,
      "",
      "## Current event:",
      getEventContext(normalizedEvent),
      "",
      "Respond in JSON matching the schema, no extra text.",
    ];

    const queryMessage: LiveMessage = {
      contentType: "query",
      content: parsedInput,
    };

    return {
      prompt: promptSections.join("\n"),
      responseSchema,
      queryMessage,
    };
  },

  async afterGenerate(
    _context: StoryHandlerContext<LiveQuery>,
    response: LiveResponse,
  ) {
    const responseMessage: LiveMessage = {
      contentType: "response",
      content: response,
    };
    return responseMessage;
  },

  messageToString(message: LiveMessage): string {
    if (message.contentType === "query") {
      return `User: ${getQueryText(message.content)}`;
    }
    if (message.contentType === "response") {
      return `Assistant: ${summarizeResponse(message.content)}`;
    }
    return "(Unknown message)";
  },
};

export { liveInputSchema as querySchema, responseSchema };

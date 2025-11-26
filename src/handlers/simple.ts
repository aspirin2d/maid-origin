import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.ts";
import { message } from "../db/schema.ts";
import {
  searchSimilarMemories,
  type MemorySearchResult,
} from "../memory/search.ts";
import { Embed } from "../openai.ts";
import type {
  QueryMessage,
  ResponseMessage,
  StoryHandler,
  StoryHandlerContext,
} from "./index.ts";

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const responseSchema = z.object({
  answer: z
    .string()
    .min(1, "Assistant answer is required")
    .describe("Assistant answer to user's question"),
});

const querySchema = z.object({
  question: z
    .string()
    .min(1, "User input is required")
    .describe("User's input"),
});

type SimpleQuery = z.infer<typeof querySchema>;
type SimpleResponse = z.infer<typeof responseSchema>;
type SimpleMessage =
  | QueryMessage<z.infer<typeof querySchema>>
  | ResponseMessage<z.infer<typeof responseSchema>>;

const MAX_MEMORY_RESULTS = 5;
const MIN_MEMORY_SIMILARITY = 0;

async function buildRelevantMemoriesSection(
  userId: string,
  question: string,
): Promise<string> {
  try {
    const queryEmbedding = await Embed(question);
    const memories = await searchSimilarMemories(queryEmbedding, {
      topK: MAX_MEMORY_RESULTS,
      userId,
      minSimilarity: MIN_MEMORY_SIMILARITY,
    });
    return formatMemories(memories);
  } catch (error) {
    console.error("Failed to build memory section for prompt", error);
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

export const simpleHandler: StoryHandler<SimpleQuery, SimpleResponse> = {
  name: "simple",
  description: "Simple story handler.",
  querySchema,
  responseSchema,
  async beforeGenerate(context: StoryHandlerContext<SimpleQuery>) {
    const storyId = storyIdSchema.parse(context.storyId);
    const historyMessages = (
      await db
        .select({ contentType: message.contentType, content: message.content })
        .from(message)
        .where(eq(message.storyId, storyId))
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(20)
    ).reverse();

    const parsed = querySchema.parse(context.input);
    const relevantMemoriesSection = await buildRelevantMemoriesSection(
      context.user.id,
      parsed.question,
    );
    const formattedHistory = historyMessages
      .map((msg) => parseStoredMessage(msg))
      .filter((msg): msg is SimpleMessage => msg !== null)
      .map((msg) => this.messageToString(msg));
    const promptSections = [
      `You are a helpful assistant. Answer the user's question in JSON format that matches the provided schema.`,
      "## Conversation so far:",
      formattedHistory.length > 0
        ? formattedHistory.join("\n")
        : "(No previous conversation available)",
      "",
      "## Relevant memories:",
      relevantMemoriesSection,
      "",
      "## Current request:",
      parsed.question,
    ];
    const prompt = promptSections.join("\n");

    const queryMessage: SimpleMessage = {
      contentType: "query",
      content: parsed,
    };

    return {
      prompt,
      responseSchema,
      queryMessage,
    };
  },
  async afterGenerate(
    context: StoryHandlerContext<SimpleQuery>,
    response: SimpleResponse,
  ) {
    storyIdSchema.parse(context.storyId);
    const responseMessage: SimpleMessage = {
      contentType: "response",
      content: response,
    };
    return responseMessage;
  },
  messageToString(message: SimpleMessage) {
    if (message.contentType === "query") {
      return `User: ${message.content.question}`;
    }
    if (message.contentType === "response") {
      return `Assistant: ${message.content.answer}`;
    }

    return assertUnreachable(message);
  },
};

function parseStoredMessage(record: {
  contentType: string;
  content: unknown;
}): SimpleMessage | null {
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

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported content type");
}

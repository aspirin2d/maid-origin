import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.ts";
import { message } from "../db/schema.ts";
import {
  searchSimilarMemories,
  type MemorySearchResult,
} from "../memory/search.ts";
import { Embed } from "../openai.ts";
import type {
  MessageInsert,
  StoryHandler,
  StoryHandlerContext,
} from "./index.ts";

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const outputSchema = z.object({
  answer: z
    .string()
    .min(1, "Assistant answer is required")
    .describe("Assistant answer to user's question"),
});

const inputSchema = z.object({
  question: z
    .string()
    .min(1, "User input is required")
    .describe("User's input"),
});

const MAX_MEMORY_RESULTS = 5;
const MIN_MEMORY_SIMILARITY = 0.7;

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

export const simpleHandler: StoryHandler<typeof outputSchema> = {
  name: "simple",
  description: "Simple story handler.",
  async beforeGenerate(context: StoryHandlerContext) {
    const storyId = storyIdSchema.parse(context.storyId);
    const historyMessages = (
      await db
        .select({ contentType: message.contentType, content: message.content })
        .from(message)
        .where(
          and(
            eq(message.storyId, storyId),
            eq(message.extracted, false), // don't pull out already extracted messages
          ),
        )
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(20)
    ).reverse();

    const parsed = inputSchema.parse(context.input);
    const relevantMemoriesSection = await buildRelevantMemoriesSection(
      context.user.id,
      parsed.question,
    );
    const formattedHistory = historyMessages.map((msg) => {
      return this.messageToString({
        contentType: msg.contentType,
        content: msg.content,
      });
    });
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

    const inputMessage: MessageInsert = {
      contentType: "input",
      content: parsed,
    };

    return {
      prompt,
      responseSchema: outputSchema,
      // don't save prompt
      // insertMessages: [inputMessage],
      insertMessages: [inputMessage],
    };
  },
  async afterGenerate(
    context: StoryHandlerContext,
    response: z.infer<typeof outputSchema>,
  ) {
    storyIdSchema.parse(context.storyId);
    const responseMessage: MessageInsert = {
      contentType: "response",
      content: response,
    };
    return [responseMessage];
  },
  messageToString(message) {
    if (message.contentType === "input") {
      return `User: ${message.content.question}`;
    }
    if (message.contentType === "response") {
      return `Assistant: ${message.content.answer}`;
    }

    throw new Error("Unsupported content type: " + message.contentType);
  },
};

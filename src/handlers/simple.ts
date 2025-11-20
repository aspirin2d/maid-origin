import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.ts";
import { message, type JSONSerializable } from "../db/schema.ts";
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

export const simpleHandler: StoryHandler<typeof outputSchema> = {
  name: "simple",
  description:
    "Basic handler that turns stored story messages and the latest input into a single LLM prompt.",
  async beforeGenerate(context: StoryHandlerContext) {
    const storyId = storyIdSchema.parse(context.storyId);
    const historyMessages = (
      await db
        .select({ contentType: message.contentType, content: message.content })
        .from(message)
        .where(
          and(
            eq(message.storyId, storyId),
            inArray(message.contentType, ["input", "response"]),
          ),
        )
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(20)
    ).reverse();

    const parsed = inputSchema.parse(context.input);
    const formattedHistory = formatConversationHistory(historyMessages);
    const promptSections = [
      `You are a helpful assistant. Answer the user's question in JSON format that matches the provided schema.`,
      "## Conversation so far:",
      formattedHistory.length > 0
        ? formattedHistory.join("\n")
        : "No previous conversation available.",
      "",
      "## Current request",
      parsed.question,
    ];
    const prompt = promptSections.join("\n");
    const promptMessage: MessageInsert = {
      contentType: "prompt",
      content: prompt,
    };
    const inputMessage: MessageInsert = {
      contentType: "input",
      content: parsed,
    };

    return {
      prompt,
      responseSchema: outputSchema,
      insertMessages: [promptMessage, inputMessage],
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
};

type HistoryMessage = {
  contentType: string;
  content: JSONSerializable | null;
};

function formatConversationHistory(messages: HistoryMessage[]): string[] {
  return messages.map((msg) => {
    const prefix = msg.contentType === "input" ? "User" : "Assistant";
    return `${prefix}: ${extractDisplayText(msg)}`;
  });
}

function extractDisplayText(message: HistoryMessage): string {
  if (message.contentType === "input") {
    const question = extractStringField(message.content, "question");
    if (question) {
      return question;
    }
  }

  if (message.contentType === "response") {
    const answer = extractStringField(message.content, "answer");
    if (answer) {
      return answer;
    }
  }

  return stringifyContent(message.content);
}

function extractStringField(
  content: JSONSerializable | null,
  field: string,
): string | null {
  if (isRecord(content)) {
    const value = content[field];
    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function stringifyContent(content: JSONSerializable | null): string {
  if (content === null || content === undefined) {
    return "<empty>";
  }

  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content);
}

function isRecord(
  value: JSONSerializable | null,
): value is Record<string, JSONSerializable> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// @ts-nocheck
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { message } from "../../../db/schema.ts";
import type { StoryContext } from "../../index.ts";
import { dayjs } from "./time.ts";

/**
 * Parse assistant message to extract speech content from clips
 * @param content - Raw message content (JSON string)
 * @returns Extracted speech or null if parsing fails
 */
function parseAssistantSpeech(content: string): string | null {
  try {
    const parsed = JSON.parse(content);

    if (!parsed.clips || !Array.isArray(parsed.clips)) {
      return null;
    }

    const speeches = parsed.clips
      .map((clip: any) => clip?.speech)
      .filter((speech: any) => typeof speech === "string" && speech.trim().length > 0)
      .join("");

    return speeches.length > 0 ? speeches : null;
  } catch {
    // Silent fail - return null for unparseable messages
    return null;
  }
}

/**
 * Build chat history section with relative time
 * Formats conversation history for inclusion in prompts
 *
 * @param ctx - Story context
 * @param messageLimit - Maximum number of messages to include
 * @returns Formatted chat history as a string
 */
export async function buildChatHistory(
  ctx: StoryContext,
  messageLimit: number,
): Promise<string> {
  const rows = await db
    .select({
      contentType: message.contentType,
      content: message.content,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(eq(message.storyId, Number(ctx.storyId)))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(messageLimit);
  const lines: string[] = ["## 聊天历史"];

  if (rows.length === 0) {
    lines.push("（没有之前的对话）");
    return lines.join("\n");
  }

  for (const row of rows.reverse()) {
    const timeInfo = row.createdAt ? ` [${dayjs(row.createdAt).fromNow()}]` : "";

    if (row.contentType === "query") {
      lines.push(`用户${timeInfo}: ${row.content}`);
      continue;
    }

    if (row.contentType === "response") {
      const speech =
        typeof row.content === "string"
          ? parseAssistantSpeech(row.content)
          : parseAssistantSpeech(JSON.stringify(row.content));
      if (speech) {
        lines.push(`VTuber${timeInfo}: ${speech}`);
      } else {
        lines.push(
          `VTuber${timeInfo}: ${
            typeof row.content === "string"
              ? row.content
              : JSON.stringify(row.content)
          }`,
        );
      }
      continue;
    }
  }

  return lines.join("\n");
}

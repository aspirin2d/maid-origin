// @ts-nocheck
import { Embed } from "../../../openai.ts";
import { searchSimilarMemories } from "../../../memory/search.ts";
import type { StoryContext, HandlerConfig } from "../types.ts";
import { dayjs } from "./time.ts";

/**
 * Build memory context section with semantic search
 *
 * Retrieves relevant memories from previous conversations using vector similarity.
 * Memories are formatted with their category and relative time for context.
 *
 * @param request - Search query text (typically the user's current message)
 * @param ctx - Story context containing user and provider information
 * @param config - Optional configuration with memoryTopK and memoryMinSimilarity
 * @returns Formatted memory context string, or empty string if no relevant memories
 */
export async function buildMemoryContext(
  request: string | null,
  ctx: StoryContext,
  config?: HandlerConfig,
): Promise<string> {
  // Skip memory retrieval if no search text or provider
  if (!request || !ctx.provider) {
    return "";
  }

  try {
    // Extract configuration with sensible defaults
    const topK = (config?.memoryTopK as number | undefined) ?? 5;
    const minSimilarity = (config?.memoryMinSimilarity as number | undefined) ?? 0.5;

    // Generate embedding for semantic search
    const queryEmbedding = await Embed(request);

    // Search for similar memories
    const memories = await searchSimilarMemories(queryEmbedding, {
      userId: ctx.userId,
      topK,
      minSimilarity,
    });

    if (memories.length === 0) {
      return "";
    }

    // Format memories for prompt inclusion
    const lines: string[] = [
      "## 记忆上下文",
      "以下信息是从之前的对话中提取的：",
      "",
    ];

    for (const { memory } of memories) {
      const categoryLabel =
        memory.category?.replace(/_/g, " ").toLowerCase() || "other";
      const relativeTimeStr = memory.createdAt
        ? ` (${dayjs(memory.createdAt).fromNow()})`
        : "";
      lines.push(`- [${categoryLabel}]${relativeTimeStr} ${memory.content}`);
    }
    lines.push("");

    return lines.join("\n");
  } catch (error) {
    // Fail gracefully - don't break the handler if memory retrieval fails
    console.error("Failed to retrieve memories for context:", error);
    return "";
  }
}

import { and, desc, eq, gt, sql, cosineDistance } from "drizzle-orm";

import { db } from "../db/index.ts";
import { memory } from "../db/schema.ts";

export type MemoryRecord = typeof memory.$inferSelect;

export type MemorySearchResult = {
  memory: MemoryRecord;
  similarity: number;
};

/**
 * Bulk search for similar memories using vector embeddings.
 *
 * @param queries - Array of query embeddings (each should be a 1536-dimensional array)
 * @param options - Search options
 * @param options.topK - Number of top results to return per query (default: 5)
 * @param options.userId - User ID to filter results by user
 * @param options.minSimilarity - Minimum similarity threshold (0-1, default: 0)
 */
export async function bulkSearchSimilarMemories(
  queries: number[][],
  options: {
    userId: string;
    topK?: number;
    minSimilarity?: number;
  },
): Promise<MemorySearchResult[][]> {
  if (queries.length === 0) {
    return [];
  }

  const topK = options?.topK ?? 5;
  const minSimilarity = options?.minSimilarity ?? 0;

  const results = await Promise.all(
    queries.map((queryEmbedding) =>
      searchSimilarMemories(queryEmbedding, {
        topK,
        userId: options.userId,
        minSimilarity,
      }),
    ),
  );

  return results;
}

/**
 * Search for similar memories using a single query embedding.
 * @param queryEmbedding - Query embedding vector (1536 dimensions)
 * @param options - Search options
 * @param options.topK - Number of top results to return (default: 5)
 * @param options.userId - User ID to filter results by user
 * @param options.minSimilarity - Minimum similarity threshold (0-1, default: 0)
 */
export async function searchSimilarMemories(
  queryEmbedding: number[],
  options: {
    topK: number;
    userId: string;
    minSimilarity?: number;
  },
): Promise<MemorySearchResult[]> {
  const topK = options?.topK ?? 5;
  const minSimilarity = options?.minSimilarity ?? 0;

  const similarity = sql<number>`1 - (${cosineDistance(memory.embedding, queryEmbedding)})`;

  return await db
    .select({
      memory: memory,
      similarity,
    })
    .from(memory)
    .where(
      and(eq(memory.userId, options.userId), gt(similarity, minSimilarity)),
    )
    .orderBy((t) => desc(t.similarity))
    .limit(topK);
}

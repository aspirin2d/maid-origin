import { and, asc, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./auth.ts";
import { db } from "./db/index.ts";
import { memory, message, story } from "./db/schema.ts";
import { getStoryHandlerByName } from "./handlers/index.ts";
import { Embed, Response } from "./openai.ts";
import {
  FactRetrievalSchema,
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  MemoryUpdateSchema,
} from "./prompts/memory.ts";

type MemoryExtractionStats = {
  factsExtracted: number;
  memoriesAdded: number;
  memoriesUpdated: number;
  messagesExtracted: number;
};

type RetrievedFact = z.infer<typeof FactRetrievalSchema>["facts"][number];

type ExistingMemory = {
  unifiedId: string;
  originalId: number;
  text: string;
};

type FactMetadata = Pick<
  RetrievedFact,
  "category" | "importance" | "confidence"
>;

type PreparedDecision =
  | {
      kind: "ADD";
      text: string;
      metadata: FactMetadata;
      embeddingKey: string;
    }
  | {
      kind: "UPDATE";
      memoryIndex: number;
      text: string;
      embeddingKey: string;
    };

type DecisionPlan = {
  decisions: PreparedDecision[];
  embeddingByText: Map<string, number[]>;
};

type MemoryUpdateDecision = z.infer<
  typeof MemoryUpdateSchema
>["memory"][number];

const EMPTY_STATS: MemoryExtractionStats = {
  factsExtracted: 0,
  memoriesAdded: 0,
  memoriesUpdated: 0,
  messagesExtracted: 0,
};

const SIMILAR_MEMORY_TOP_K = 3;
const MIN_MEMORY_SIMILARITY = 0.7;

type Message = typeof message.$inferSelect & {
  storyId: number;
  storyHandler: string;
};

type Messages = Message[];
type MessageMutator = Pick<typeof db, "update">;

export async function markMessagesAsExtracted(
  messageIds: number[],
  executor: MessageMutator = db,
) {
  if (messageIds.length === 0) return;

  for (const msgId of messageIds) {
    await executor
      .update(message)
      .set({ extracted: true })
      .where(eq(message.id, msgId));
  }
}

export async function extractMemory(
  userId: string,
): Promise<MemoryExtractionStats> {
  // Gather the latest user-only messages that still need memory extraction.
  const pendingMessages: Messages = await db
    .select({
      id: message.id,
      contentType: message.contentType,
      content: message.content,
      extracted: message.extracted,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,

      storyId: story.id,
      storyHandler: story.handler,
    })
    .from(message)
    .innerJoin(story, eq(message.storyId, story.id))
    .where(and(eq(story.userId, userId), eq(message.extracted, false)))
    .orderBy(asc(message.createdAt));

  if (pendingMessages.length === 0) {
    return EMPTY_STATS;
  }

  // Let the LLM convert free-form conversation into normalized facts.
  const facts = await extractFactsFromMessages(pendingMessages);
  if (facts.length === 0) {
    await markMessagesAsExtracted(pendingMessages.map((msg) => msg.id));
    return {
      ...EMPTY_STATS,
      messagesExtracted: pendingMessages.length,
    };
  }

  // Embed every fact once so we can both search for similar memories
  // and avoid redundant OpenAI calls during insert/update later on.
  const factTexts = facts.map((fact) => fact.text);
  const factEmbeddings = await Embed(factTexts);

  // Pull the most relevant existing memories for comparison, using
  // cosine similarity against the freshly embedded facts.
  const existingMemories = await buildExistingMemoryContext({
    userId,
    factEmbeddings,
  });
  const startFactId = existingMemories.length + 1;

  const unifiedExisting = existingMemories.map(({ unifiedId, text }) => ({
    id: unifiedId,
    text,
  }));
  const unifiedNewFacts = facts.map((fact, index) => ({
    id: String(startFactId + index),
    text: fact.text,
    category: fact.category,
    importance: fact.importance,
    confidence: fact.confidence,
  }));

  // Ask the LLM to decide whether each fact is new (ADD) or should
  // revise an existing memory (UPDATE).
  const memoryUpdatePrompt = getUpdateMemoryMessages(
    unifiedExisting,
    unifiedNewFacts,
  );
  const memoryUpdateOutput = await Response(
    memoryUpdatePrompt,
    MemoryUpdateSchema,
  );

  // Translate LLM output into concrete DB operations and batch any
  // additional embeddings that we still need before touching the DB.
  const decisionPlan = await buildDecisionPlan({
    facts,
    factEmbeddings,
    existingMemories,
    startFactId,
    decisions: memoryUpdateOutput.memory,
  });

  // Apply ADD/UPDATE decisions within a single transaction, then mark
  // all processed messages as extracted.
  const { memoriesAdded, memoriesUpdated } = await applyDecisionPlan({
    userId,
    plan: decisionPlan,
    existingMemories,
    messageIds: pendingMessages.map((msg) => msg.id),
  });

  return {
    factsExtracted: facts.length,
    memoriesAdded,
    memoriesUpdated,
    messagesExtracted: pendingMessages.length,
  };
}

async function extractFactsFromMessages(
  messages: Messages,
): Promise<RetrievedFact[]> {
  const conversation = formatMessagesForFactExtraction(messages);
  const prompt = getFactRetrievalMessages(conversation);
  const { facts } = await Response(prompt, FactRetrievalSchema);
  return facts;
}

function formatMessagesForFactExtraction(messages: Messages): string {
  if (messages.length === 0) {
    return "";
  }

  return messages
    .map((msg) => {
      const handler = getStoryHandlerByName(msg.storyHandler);
      return handler.messageToString({
        contentType: msg.contentType,
        content: msg.content,
      });
    })
    .join("\n\n");
}

async function buildExistingMemoryContext(params: {
  userId: string;
  factEmbeddings: number[][];
}): Promise<ExistingMemory[]> {
  if (params.factEmbeddings.length === 0) {
    return [];
  }

  const similarMemories = await bulkSearchSimilarMemories(
    params.factEmbeddings,
    {
      topK: SIMILAR_MEMORY_TOP_K,
      userId: params.userId,
      minSimilarity: MIN_MEMORY_SIMILARITY,
    },
  );

  const uniqueMemories = new Map<number, { id: number; content: string }>();
  for (const results of similarMemories) {
    for (const { memory: mem } of results) {
      if (!uniqueMemories.has(mem.id)) {
        uniqueMemories.set(mem.id, {
          id: mem.id,
          content: mem.content ?? "",
        });
      }
    }
  }

  return Array.from(uniqueMemories.values()).map((mem, index) => ({
    unifiedId: String(index + 1),
    originalId: mem.id,
    text: mem.content,
  }));
}

async function buildDecisionPlan(params: {
  facts: RetrievedFact[];
  factEmbeddings: number[][];
  existingMemories: ExistingMemory[];
  startFactId: number;
  decisions: MemoryUpdateDecision[];
}): Promise<DecisionPlan> {
  const embeddingByText = new Map<string, number[]>();
  params.facts.forEach((fact, index) => {
    if (!embeddingByText.has(fact.text)) {
      embeddingByText.set(fact.text, params.factEmbeddings[index]!);
    }
  });

  const textsToEmbed: string[] = [];
  const pendingEmbeddingTexts = new Set<string>();
  const queueEmbedding = (text: string) => {
    if (!text || embeddingByText.has(text) || pendingEmbeddingTexts.has(text)) {
      return;
    }
    pendingEmbeddingTexts.add(text);
    textsToEmbed.push(text);
  };

  const prepared: PreparedDecision[] = [];
  for (const decision of params.decisions) {
    const decisionId = parseInt(decision.id, 10);
    if (Number.isNaN(decisionId)) {
      continue;
    }

    if (decision.event === "ADD") {
      const factIndex = decisionId - params.startFactId;
      if (factIndex < 0 || factIndex >= params.facts.length) {
        continue;
      }

      const fact = params.facts[factIndex]!;
      const text = decision.text?.length ? decision.text : fact.text;
      queueEmbedding(text);
      prepared.push({
        kind: "ADD",
        text,
        metadata: {
          category: fact.category,
          importance: fact.importance,
          confidence: fact.confidence,
        },
        embeddingKey: text,
      });
    } else if (decision.event === "UPDATE") {
      const memoryIndex = decisionId - 1;
      if (memoryIndex < 0 || memoryIndex >= params.existingMemories.length) {
        continue;
      }

      const text = decision.text;
      queueEmbedding(text);
      prepared.push({
        kind: "UPDATE",
        memoryIndex,
        text,
        embeddingKey: text,
      });
    }
  }

  const overrideEmbeddings =
    textsToEmbed.length > 0 ? await Embed(textsToEmbed) : [];
  textsToEmbed.forEach((text, index) => {
    const embedding = overrideEmbeddings[index];
    if (!embedding) {
      return;
    }
    embeddingByText.set(text, embedding);
  });

  return {
    decisions: prepared,
    embeddingByText,
  };
}

async function applyDecisionPlan(params: {
  userId: string;
  plan: DecisionPlan;
  existingMemories: ExistingMemory[];
  messageIds: number[];
}): Promise<{
  memoriesAdded: number;
  memoriesUpdated: number;
}> {
  let memoriesAdded = 0;
  let memoriesUpdated = 0;

  await db.transaction(async (tx) => {
    for (const decision of params.plan.decisions) {
      const embedding = params.plan.embeddingByText.get(decision.embeddingKey);
      if (!embedding) {
        continue;
      }

      if (decision.kind === "ADD") {
        await tx.insert(memory).values({
          userId: params.userId,
          content: decision.text,
          embedding,
          category: decision.metadata.category,
          importance: decision.metadata.importance,
          confidence: decision.metadata.confidence,
          action: "ADD",
        });
        memoriesAdded++;
        continue;
      }

      const targetMemory = params.existingMemories[decision.memoryIndex];
      if (!targetMemory) {
        continue;
      }

      await tx
        .update(memory)
        .set({
          content: decision.text,
          prevContent: targetMemory.text,
          embedding,
          action: "UPDATE",
        })
        .where(eq(memory.id, targetMemory.originalId));
      memoriesUpdated++;
    }

    await markMessagesAsExtracted(params.messageIds, tx);
  });

  return { memoriesAdded, memoriesUpdated };
}

/**
 * Bulk search for similar memories using vector embeddings
 *
 * @param queries - Array of query embeddings (each should be a 1536-dimensional array)
 * @param options - Search options
 * @param options.topK - Number of top results to return per query (default: 5)
 * @param options.userId - Optional user ID to filter results by user
 * @param options.minSimilarity - Minimum similarity threshold (0-1, default: 0)
 * @param options.category - Optional category filter
 * @returns Array of results, one array per query embedding
 */
export async function bulkSearchSimilarMemories(
  queries: number[][],
  options: {
    userId: string;
    topK?: number;
    minSimilarity?: number;
  },
) {
  const topK = options?.topK ?? 5;
  const minSimilarity = options?.minSimilarity ?? 0;

  // Execute all queries in parallel for better performance
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
 * Search for similar memories using a single query embedding
 * @param queryEmbedding - Query embedding vector (1536 dimensions)
 * @param options - Search options
 * @param options.topK - Number of top results to return (default: 5)
 * @param options.userId - Optional user ID to filter results by user
 * @param options.minSimilarity - Minimum similarity threshold (0-1, default: 0)
 * @returns Array of similar memories with similarity scores
 */
export async function searchSimilarMemories(
  queryEmbedding: number[],
  options: {
    topK: number;
    userId: string;
    minSimilarity?: number;
  },
) {
  const topK = options?.topK ?? 5;
  const minSimilarity = options?.minSimilarity ?? 0;

  // Calculate cosine distance (1 - cosine similarity)
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

const sortableMemoryFields = [
  "id",
  "content",
  "category",
  "importance",
  "confidence",
  "action",
  "createdAt",
  "updatedAt",
] as const;

type MemorySortField = (typeof sortableMemoryFields)[number];

const sortableMemoryColumns = {
  id: memory.id,
  content: memory.content,
  category: memory.category,
  importance: memory.importance,
  confidence: memory.confidence,
  action: memory.action,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
} satisfies Record<MemorySortField, AnyPgColumn>;

const positiveIntegerParam = z.coerce
  .number()
  .int({ message: "Must be an integer" })
  .gt(0, { message: "Must be greater than 0" });

const nonNegativeIntegerParam = z.coerce
  .number()
  .int({ message: "Must be an integer" })
  .min(0, { message: "Must be non-negative" });

const listMemoriesQuerySchema = z.object({
  limit: positiveIntegerParam.optional().nullish(),
  offset: nonNegativeIntegerParam.optional().nullish(),
  sortBy: z.enum(sortableMemoryFields).optional().nullish(),
  sortDirection: z.enum(["asc", "desc"]).optional().nullish(),
});

function normalizeQueryValue(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return undefined;
  }
  return trimmed;
}

export const memoryRoute = new Hono<AppEnv>();

memoryRoute.post("/memory-extraction", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "User missing from request context" }, 500);
  }

  try {
    const stats = await extractMemory(user.id);
    return c.json({ stats });
  } catch (error) {
    console.error("Memory extraction failed", error);
    return c.json({ error: "Failed to extract memory" }, 500);
  }
});

memoryRoute.get("/list-memories", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "User missing from request context" }, 500);
  }

  const rawQuery = c.req.query();
  const parsed = listMemoriesQuerySchema.safeParse({
    limit: normalizeQueryValue(rawQuery.limit),
    offset: normalizeQueryValue(rawQuery.offset),
    sortBy: normalizeQueryValue(rawQuery.sortBy),
    sortDirection: normalizeQueryValue(rawQuery.sortDirection),
  });

  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const sortField: MemorySortField = parsed.data.sortBy ?? "updatedAt";
  const direction: "asc" | "desc" = parsed.data.sortDirection ?? "desc";

  try {
    const query = db
      .select()
      .from(memory)
      .where(eq(memory.userId, user.id))
      .orderBy(
        direction === "asc"
          ? asc(sortableMemoryColumns[sortField])
          : desc(sortableMemoryColumns[sortField]),
      )
      .$dynamic();

    if (parsed.data.limit) {
      query.limit(parsed.data.limit);
    }

    if (parsed.data.offset) {
      query.offset(parsed.data.offset);
    }

    const memories = await query;
    return c.json({ memories });
  } catch (error) {
    console.error("Failed to fetch memories", error);
    return c.json({ error: "Failed to fetch memories" }, 500);
  }
});

memoryRoute.post("/delete-memories", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "User missing from request context" }, 500);
  }

  try {
    const deleted = await db
      .delete(memory)
      .where(eq(memory.userId, user.id))
      .returning({ id: memory.id });
    return c.json({ deleted: deleted.length });
  } catch (error) {
    console.error("Failed to delete memories", error);
    return c.json({ error: "Failed to delete memories" }, 500);
  }
});

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.ts";
import { memory, message, story } from "../db/schema.ts";
import {
  getStoryHandlerByName,
  type MessageInsert,
  type RegisteredStoryHandler,
} from "../handlers/index.ts";
import { Embed, Response } from "../openai.ts";
import {
  FactRetrievalSchema,
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  MemoryUpdateSchema,
} from "./prompt.ts";
import { bulkSearchSimilarMemories } from "./search.ts";

export type MemoryExtractionStats = {
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

type LabeledFact = RetrievedFact & { id: string };

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
      memory: ExistingMemory;
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

  await executor
    .update(message)
    .set({ extracted: true })
    .where(inArray(message.id, messageIds));
}

async function loadPendingMessages(userId: string): Promise<Messages> {
  return db
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
}

export async function extractMemory(
  userId: string,
): Promise<MemoryExtractionStats> {
  const pendingMessages = await loadPendingMessages(userId);

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
  const labeledFacts: LabeledFact[] = facts.map((fact, index) => ({
    ...fact,
    id: String(existingMemories.length + index + 1),
  }));

  const unifiedExisting = existingMemories.map(({ unifiedId, text }) => ({
    id: unifiedId,
    text,
  }));
  const unifiedNewFacts = labeledFacts.map((fact) => ({
    id: fact.id,
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
    labeledFacts,
    factEmbeddings,
    existingMemories,
    decisions: memoryUpdateOutput.memory,
  });

  // Apply ADD/UPDATE decisions within a single transaction, then mark
  // all processed messages as extracted.
  const { memoriesAdded, memoriesUpdated } = await applyDecisionPlan({
    userId,
    plan: decisionPlan,
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
      const typedMessage = toHandlerMessage(handler, msg);
      if (!typedMessage) {
        return null;
      }
      return handler.messageToString(typedMessage);
    })
    .filter((value): value is string => value !== null)
    .join("\n\n");
}

type HandlerInput<THandler extends RegisteredStoryHandler> = z.output<
  THandler["inputSchema"]
>;
type HandlerResponse<THandler extends RegisteredStoryHandler> = z.output<
  THandler["responseSchema"]
>;

function toHandlerMessage<THandler extends RegisteredStoryHandler>(
  handler: THandler,
  msg: Message,
): MessageInsert<HandlerInput<THandler>, HandlerResponse<THandler>> | null {
  if (msg.contentType === "input") {
    const parsedInput = handler.inputSchema.safeParse(msg.content);
    if (parsedInput.success) {
      return {
        contentType: "input",
        content: parsedInput.data as HandlerInput<THandler>,
      };
    }
    return null;
  }

  if (msg.contentType === "response") {
    const parsedResponse = handler.responseSchema.safeParse(msg.content);
    if (parsedResponse.success) {
      return {
        contentType: "response",
        content: parsedResponse.data as HandlerResponse<THandler>,
      };
    }
    return null;
  }

  return null;
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
  labeledFacts: LabeledFact[];
  factEmbeddings: number[][];
  existingMemories: ExistingMemory[];
  decisions: MemoryUpdateDecision[];
}): Promise<DecisionPlan> {
  const embeddingByText = new Map<string, number[]>();
  params.labeledFacts.forEach((fact, index) => {
    const embedding = params.factEmbeddings[index];
    if (embedding) {
      embeddingByText.set(fact.text, embedding);
    }
  });

  const factById = new Map(params.labeledFacts.map((fact) => [fact.id, fact]));
  const memoryById = new Map(
    params.existingMemories.map((memory) => [memory.unifiedId, memory]),
  );

  const textsToEmbed: string[] = [];
  const pendingEmbeddingTexts = new Set<string>();
  const queueEmbedding = (text: string) => {
    if (embeddingByText.has(text) || pendingEmbeddingTexts.has(text)) {
      return;
    }
    pendingEmbeddingTexts.add(text);
    textsToEmbed.push(text);
  };

  const normalize = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed?.length ? trimmed : undefined;
  };

  const prepared: PreparedDecision[] = [];
  for (const decision of params.decisions) {
    if (decision.event === "ADD") {
      const fact = factById.get(decision.id);
      if (!fact) {
        continue;
      }

      const text = normalize(decision.text) ?? fact.text;
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
      continue;
    }

    const targetMemory = memoryById.get(decision.id);
    const text = normalize(decision.text);
    if (!targetMemory || !text) {
      continue;
    }

    queueEmbedding(text);
    prepared.push({
      kind: "UPDATE",
      memory: targetMemory,
      text,
      embeddingKey: text,
    });
  }

  const overrideEmbeddings =
    textsToEmbed.length > 0 ? await Embed(textsToEmbed) : [];
  textsToEmbed.forEach((text, index) => {
    const embedding = overrideEmbeddings[index];
    if (embedding) {
      embeddingByText.set(text, embedding);
    }
  });

  return {
    decisions: prepared,
    embeddingByText,
  };
}

async function applyDecisionPlan(params: {
  userId: string;
  plan: DecisionPlan;
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

      await tx
        .update(memory)
        .set({
          content: decision.text,
          prevContent: decision.memory.text,
          embedding,
          action: "UPDATE",
        })
        .where(eq(memory.id, decision.memory.originalId));
      memoriesUpdated++;
    }

    await markMessagesAsExtracted(params.messageIds, tx);
  });

  return { memoriesAdded, memoriesUpdated };
}

import { and, asc, desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../auth.ts";
import { db } from "../db/index.ts";
import { memory } from "../db/schema.ts";
import { env } from "../env.ts";
import { Embed } from "../openai.ts";
import {
  applyPagination,
  normalizeQueryValue,
  paginationParamsSchema,
} from "../pagination.ts";

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

const listMemoriesQuerySchema = paginationParamsSchema.extend({
  sortBy: z.enum(sortableMemoryFields).optional().nullish(),
  sortDirection: z.enum(["asc", "desc"]).optional().nullish(),
});

const memoryIdSchema = z.coerce.number().int().positive({
  message: "Memory id must be a positive integer",
});

const deleteMemorySchema = z.object({
  id: memoryIdSchema,
});

const memoryUpdateSchema = z.object({
  id: z.int(),
  data: createUpdateSchema(memory),
});

const createMemorySchema = createInsertSchema(memory);

export const memoryRoute = new Hono<AppEnv>();

memoryRoute.get("/list-memories", async (c) => {
  const user = c.get("user")!;

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

    applyPagination(query, parsed.data);

    const memories = await query;
    return c.json({ memories });
  } catch (error) {
    console.error("Failed to fetch memories", error);
    return c.json({ error: "Failed to fetch memories" }, 500);
  }
});

memoryRoute.post("/create-memory", async (c) => {
  const user = c.get("user")!;

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createMemorySchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const { content, category, importance, confidence, action } = parsed.data;

  let embedding: number[] | undefined;
  try {
    embedding = await Embed(content);
  } catch (error) {
    console.error("Failed to embed memory content", error);
    return c.json({ error: "Failed to generate embedding" }, 500);
  }

  const [newMemory] = await db
    .insert(memory)
    .values({
      userId: user.id,
      content,
      category,
      importance,
      confidence,
      action,
      embedding,
    })
    .returning();

  return c.json({ memory: newMemory }, 201);
});

memoryRoute.post("/delete-memory", async (c) => {
  const user = c.get("user")!;

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = deleteMemorySchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const memoryId = parsed.data.id;

  const deleted = await db
    .delete(memory)
    .where(and(eq(memory.id, memoryId), eq(memory.userId, user.id)))
    .returning();

  const record = deleted[0];
  if (!record) {
    console.log("missing memory:", memoryId, user.id);
    return c.json({ error: "Memory not found" }, 404);
  }

  return c.json({ memory: record });
});

memoryRoute.post("/update-memory", async (c) => {
  const user = c.get("user")!;

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = memoryUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  // Prevent changing ownership or immutable fields via payload
  const updateData = { ...parsed.data.data };
  delete (updateData as any).userId;
  delete (updateData as any).id;
  delete (updateData as any).createdAt;

  const existing = await db
    .select()
    .from(memory)
    .where(and(eq(memory.id, parsed.data.id), eq(memory.userId, user.id)))
    .limit(1);

  const record = existing[0];
  if (!record) {
    return c.json({ error: "Memory not found" }, 404);
  }

  const updated = await db
    .update(memory)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(and(eq(memory.id, parsed.data.id), eq(memory.userId, user.id)))
    .returning();

  const updatedRecord = updated[0];
  if (!updatedRecord) {
    return c.json({ error: "Memory not found" }, 404);
  }

  return c.json({ memory: updatedRecord });
});

memoryRoute.post("/prune-memories", async (c) => {
  if (env.isProduction) {
    return c.json({ error: "Endpoint disabled in production" }, 404);
  }

  const user = c.get("user")!;

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

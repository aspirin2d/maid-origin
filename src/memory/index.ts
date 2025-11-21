import { asc, desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../auth.ts";
import { db } from "../db/index.ts";
import { memory } from "../db/schema.ts";
import { extractMemory } from "./extraction.ts";

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

memoryRoute.use("*", async (c, next) => {
  if (!c.get("user")) {
    return c.json({ error: "User missing from request context" }, 500);
  }
  await next();
});

memoryRoute.post("/memory-extraction", async (c) => {
  const user = c.get("user")!;

  try {
    const stats = await extractMemory(user.id);
    return c.json({ stats });
  } catch (error) {
    console.error("Memory extraction failed", error);
    return c.json({ error: "Failed to extract memory" }, 500);
  }
});

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

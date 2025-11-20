import { and, asc, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppEnv } from "./auth.ts";
import { db } from "./db/index.ts";
import { story } from "./db/schema.ts";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

type StoryInsert = typeof story.$inferInsert;
const storyRoute = new Hono<AppEnv>();

const createStorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Story name is required")
    .max(256, "Story name must be at most 256 characters"),
  handler: z
    .string()
    .trim()
    .min(1, "Handler is required")
    .max(128, "Handler must be at most 128 characters"),
});

const updateStorySchema = z
  .object({
    name: createStorySchema.shape.name.optional(),
    handler: createStorySchema.shape.handler.optional(),
  })
  .refine((data) => data.name !== undefined || data.handler !== undefined, {
    message: "Provide at least one field to update",
  });

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const updateStoryRequestSchema = updateStorySchema.safeExtend({
  id: storyIdSchema,
});

const deleteStorySchema = z.object({
  id: storyIdSchema,
});

const sortableStoryFields = [
  "id",
  "name",
  "handler",
  "createdAt",
  "updatedAt",
] as const;

type StorySortField = (typeof sortableStoryFields)[number];

const sortableColumns = {
  id: story.id,
  name: story.name,
  handler: story.handler,
  createdAt: story.createdAt,
  updatedAt: story.updatedAt,
} satisfies Record<StorySortField, AnyPgColumn>;

const positiveIntegerParam = z.coerce
  .number()
  .int({ message: "Must be an integer" })
  .gt(0, { message: "Must be greater than 0" });

const nonNegativeIntegerParam = z.coerce
  .number()
  .int({ message: "Must be an integer" })
  .min(0, { message: "Must be non-negative" });

const listStoriesQuerySchema = z.object({
  limit: positiveIntegerParam.optional().nullish(),
  offset: nonNegativeIntegerParam.optional().nullish(),
  sortBy: z.enum(sortableStoryFields).optional().nullish(),
  sortDirection: z.enum(["asc", "desc"]).optional().nullish(),
});

const missingUserResponse = (c: Context<AppEnv>) =>
  c.json({ error: "User missing from request context" }, 500);

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

storyRoute.post("/create-story", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createStorySchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const [newStory] = await db
    .insert(story)
    .values({
      userId: user.id,
      name: parsed.data.name,
      handler: parsed.data.handler,
    })
    .returning();

  return c.json({ story: newStory }, 201);
});

storyRoute.get("/get-story", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  const storyIdResult = storyIdSchema.safeParse(c.req.query("id"));
  if (!storyIdResult.success) {
    return c.json({ error: z.treeifyError(storyIdResult.error) }, 400);
  }

  const existing = await db
    .select()
    .from(story)
    .where(and(eq(story.id, storyIdResult.data), eq(story.userId, user.id)))
    .limit(1);

  const record = existing[0];
  if (!record) {
    return c.json({ error: "Story not found" }, 404);
  }

  return c.json({ story: record });
});

storyRoute.post("/delete-story", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = deleteStorySchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const storyId = parsed.data.id;

  const deleted = await db
    .delete(story)
    .where(and(eq(story.id, storyId), eq(story.userId, user.id)))
    .returning();

  const record = deleted[0];
  if (!record) {
    return c.json({ error: "Story not found" }, 404);
  }

  return c.json({ story: record });
});

storyRoute.post("/update-story", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = updateStoryRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const updateData: Partial<StoryInsert> = {};
  if (parsed.data.name !== undefined) {
    updateData.name = parsed.data.name;
  }
  if (parsed.data.handler !== undefined) {
    updateData.handler = parsed.data.handler;
  }
  updateData.updatedAt = new Date();

  const updated = await db
    .update(story)
    .set(updateData)
    .where(and(eq(story.id, parsed.data.id), eq(story.userId, user.id)))
    .returning();

  const record = updated[0];
  if (!record) {
    return c.json({ error: "Story not found" }, 404);
  }

  return c.json({ story: record });
});

storyRoute.get("/list-stories", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  const rawQuery = c.req.query();
  const parsed = listStoriesQuerySchema.safeParse({
    limit: normalizeQueryValue(rawQuery.limit),
    offset: normalizeQueryValue(rawQuery.offset),
    sortBy: normalizeQueryValue(rawQuery.sortBy),
    sortDirection: normalizeQueryValue(rawQuery.sortDirection),
  });

  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const sortField: StorySortField = parsed.data.sortBy ?? "createdAt";
  const direction: "asc" | "desc" = parsed.data.sortDirection ?? "desc";

  const storiesQuery = db
    .select()
    .from(story)
    .where(eq(story.userId, user.id))
    .orderBy(
      direction === "asc"
        ? asc(sortableColumns[sortField])
        : desc(sortableColumns[sortField]),
    )
    .$dynamic();

  if (parsed.data.limit) {
    storiesQuery.limit(parsed.data.limit);
  }

  if (parsed.data.offset) {
    storiesQuery.offset(parsed.data.offset);
  }

  const stories = await storiesQuery;
  return c.json({ stories });
});

export { storyRoute };

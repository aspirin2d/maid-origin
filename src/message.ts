import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppEnv } from "./auth.ts";
import { db } from "./db/index.ts";
import { message, story } from "./db/schema.ts";
import { env } from "./env.ts";
import {
  applyPagination,
  normalizeQueryValue,
  paginationParamsSchema,
  positiveIntegerParam,
} from "./pagination.ts";

const sortableMessageFields = [
  "id",
  "storyId",
  "contentType",
  "extracted",
  "createdAt",
  "updatedAt",
] as const;

type MessageSortField = (typeof sortableMessageFields)[number];

const sortableMessageColumns = {
  id: message.id,
  storyId: message.storyId,
  contentType: message.contentType,
  extracted: message.extracted,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
} satisfies Record<MessageSortField, AnyPgColumn>;

const listMessagesQuerySchema = paginationParamsSchema.extend({
  storyId: positiveIntegerParam.optional().nullish(),
  sortBy: z.enum(sortableMessageFields).optional().nullish(),
  sortDirection: z.enum(["asc", "desc"]).optional().nullish(),
});

const messageIdSchema = positiveIntegerParam;

const deleteMessageSchema = z.object({
  id: messageIdSchema,
});

const messageUpdateSchema = z.object({
  id: messageIdSchema,
  data: z.object({
    contentType: z.enum(["query", "response"]).optional(),
    content: z.any().optional(),
    extracted: z.boolean().optional(),
  }),
});

const missingUserResponse = (c: Context<AppEnv>) =>
  c.json({ error: "User missing from request context" }, 500);

export const messageRoute = new Hono<AppEnv>();

messageRoute.get("/list-messages", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  const rawQuery = c.req.query();
  const parsed = listMessagesQuerySchema.safeParse({
    limit: normalizeQueryValue(rawQuery.limit),
    offset: normalizeQueryValue(rawQuery.offset),
    storyId: normalizeQueryValue(rawQuery.storyId),
    sortBy: normalizeQueryValue(rawQuery.sortBy),
    sortDirection: normalizeQueryValue(rawQuery.sortDirection),
  });

  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const sortField: MessageSortField = parsed.data.sortBy ?? "createdAt";
  const direction: "asc" | "desc" = parsed.data.sortDirection ?? "desc";

  const whereCondition = parsed.data.storyId
    ? and(eq(story.userId, user.id), eq(message.storyId, parsed.data.storyId))
    : eq(story.userId, user.id);

  const query = db
    .select({
      id: message.id,
      storyId: message.storyId,
      contentType: message.contentType,
      content: message.content,
      extracted: message.extracted,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    })
    .from(message)
    .innerJoin(story, eq(message.storyId, story.id))
    .where(whereCondition)
    .orderBy(
      direction === "asc"
        ? asc(sortableMessageColumns[sortField])
        : desc(sortableMessageColumns[sortField]),
    )
    .$dynamic();

  applyPagination(query, parsed.data);

  const messages = await query;
  return c.json({ messages });
});

messageRoute.get("/get-message", async (c) => {
  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  const messageIdResult = positiveIntegerParam.safeParse(c.req.query("id"));
  if (!messageIdResult.success) {
    return c.json({ error: z.treeifyError(messageIdResult.error) }, 400);
  }

  const existing = await db
    .select()
    .from(message)
    .innerJoin(story, eq(message.storyId, story.id))
    .where(and(eq(message.id, messageIdResult.data), eq(story.userId, user.id)))
    .limit(1);

  const record = existing[0];
  if (!record) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ message: record });
});

messageRoute.post("/update-message", async (c) => {
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

  const parsed = messageUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const { data: parsedData } = messageUpdateSchema.parse(payload);

  const updateData =
    "data" in parsed.data
      ? parsed.data.data
      : {
          contentType: parsedData.contentType,
          content: parsedData.content,
          extracted: parsedData.extracted,
        };

  const authorizedMessage = await db
    .select({ id: message.id, storyId: message.storyId })
    .from(message)
    .innerJoin(story, eq(message.storyId, story.id))
    .where(and(eq(message.id, parsed.data.id), eq(story.userId, user.id)))
    .limit(1);

  const record = authorizedMessage[0];
  if (!record) {
    return c.json({ error: "Message not found" }, 404);
  }

  const updated = await db
    .update(message)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(and(eq(message.id, record.id), eq(message.storyId, record.storyId)))
    .returning();

  const updatedRecord = updated[0];
  if (!updatedRecord) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ message: updatedRecord });
});

messageRoute.post("/delete-message", async (c) => {
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

  const parsed = deleteMessageSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const authorizedMessage = await db
    .select({ id: message.id, storyId: message.storyId })
    .from(message)
    .innerJoin(story, eq(message.storyId, story.id))
    .where(and(eq(message.id, parsed.data.id), eq(story.userId, user.id)))
    .limit(1);

  const record = authorizedMessage[0];
  if (!record) {
    return c.json({ error: "Message not found" }, 404);
  }

  const deleted = await db
    .delete(message)
    .where(and(eq(message.id, record.id), eq(message.storyId, record.storyId)))
    .returning();

  const deletedRecord = deleted[0];
  if (!deletedRecord) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ message: deletedRecord });
});

messageRoute.post("/prune-messages", async (c) => {
  if (env.isProduction) {
    return c.json({ error: "Endpoint disabled in production" }, 404);
  }

  const user = c.get("user");
  if (!user) {
    return missingUserResponse(c);
  }

  const stories = await db
    .select({ id: story.id })
    .from(story)
    .where(eq(story.userId, user.id));

  if (stories.length === 0) {
    return c.json({ deleted: 0 });
  }

  const deleted = await db
    .delete(message)
    .where(
      inArray(
        message.storyId,
        stories.map((s) => s.id),
      ),
    )
    .returning({ id: message.id });

  return c.json({ deleted: deleted.length });
});

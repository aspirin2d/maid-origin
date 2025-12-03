import { and, asc, desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppEnv } from "./auth.ts";
import { db } from "./db/index.ts";
import { message, story } from "./db/schema.ts";
import {
  getStoryHandlerByName,
  type StoryHandlerContext,
} from "./handlers/index.ts";
import { Response } from "./openai.ts";
import {
  applyPagination,
  normalizeQueryValue,
  paginationParamsSchema,
  positiveIntegerParam,
} from "./pagination.ts";
import { addExtractionJob } from "./queue/index.ts";

const storyRoute = new Hono<AppEnv>();

const storyInsertSchema = z.object({
  name: z.string().trim().min(1).max(100),
  handler: z.string().trim().min(1).max(100),
});

const storyUpdateSchema = z
  .object({
    id: z.int().positive(),
    data: z.object({
      name: z.string().trim().min(1).max(100).optional(),
      handler: z.string().trim().min(1).max(100).optional(),
    }),
  })
  .refine(({ data }) => data.name !== undefined || data.handler !== undefined, {
    message: "Either 'name' or 'handler' must be provided.",
    path: ["name"], // or ["handler"], doesn't matter
  });

const deleteStorySchema = z.object({
  id: z.int().positive(),
});

const generateStorySchema = z.object({
  storyId: z.int().positive(),
  input: z.any(),
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

const listStoriesQuerySchema = paginationParamsSchema.extend({
  sortBy: z.enum(sortableStoryFields).optional().nullish(),
  sortDirection: z.enum(["asc", "desc"]).optional().nullish(),
});

const missingUserResponse = (c: Context<AppEnv>) =>
  c.json({ error: "User missing from request context" }, 500);

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

  const parsed = storyInsertSchema.safeParse(payload);
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

  const storyIdResult = positiveIntegerParam.safeParse(c.req.query("id"));
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
    console.log("missing story:", storyId, user.id);
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

  const parsed = storyUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const { data: parsedData } = parsed.data;

  const updated = await db
    .update(story)
    .set({
      ...parsedData,
      updatedAt: new Date(),
    })
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

  applyPagination(storiesQuery, parsed.data);

  const stories = await storiesQuery;
  return c.json({ stories });
});

storyRoute.post("/generate-story", async (c) => {
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

  const parsed = generateStorySchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: z.treeifyError(parsed.error) }, 400);
  }

  const storyId = parsed.data.storyId;

  const existing = await db
    .select()
    .from(story)
    .where(and(eq(story.id, storyId), eq(story.userId, user.id)))
    .limit(1);

  const record = existing[0];
  if (!record) {
    return c.json({ error: "Story not found" }, 404);
  }

  const handler = getStoryHandlerByName(record.handler);

  const handlerInputResult = handler.querySchema.safeParse(parsed.data.input);
  if (!handlerInputResult.success) {
    return c.json({ error: z.treeifyError(handlerInputResult.error) }, 400);
  }

  const handlerInput = handlerInputResult.data;
  const handlerContext: StoryHandlerContext<typeof handlerInput> = {
    storyId: String(storyId),
    user,
    input: handlerInput,
  };

  let beforeGenerateResult;
  try {
    beforeGenerateResult = await handler.beforeGenerate(handlerContext);
  } catch (error) {
    console.error("Story handler beforeGenerate failed", error);
    return c.json({ error: "Unable to prepare story generation" }, 500);
  }

  let modelResponse;
  try {
    console.log("system prompt:", beforeGenerateResult.prompt);
    const responseSchema = handler.responseSchema;
    modelResponse = await Response(beforeGenerateResult.prompt, responseSchema);
  } catch (error) {
    console.error("OpenAI response generation failed", error);
    return c.json({ error: "Unable to generate story response" }, 502);
  }

  let responseMessage;
  try {
    responseMessage = await handler.afterGenerate(
      handlerContext,
      modelResponse,
    );
  } catch (error) {
    console.error("Story handler afterGenerate failed", error);
    return c.json({ error: "Unable to finalize story generation" }, 500);
  }

  const messagesToInsert = [beforeGenerateResult.queryMessage, responseMessage];

  if (messagesToInsert.length > 0) {
    try {
      await db.insert(message).values(
        messagesToInsert.map((msg) => ({
          storyId,
          contentType: msg.contentType,
          content: msg.content,
        })),
      );
    } catch (error) {
      console.error("Failed to persist generated messages", error);
      return c.json({ error: "Unable to store generated messages" }, 500);
    }

    // add memory extraction job
    await addExtractionJob(user.id);
  }

  return c.json({
    storyId,
    handler: handler.name,
    response: modelResponse,
  });
});

export { storyRoute };

import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.ts";
import z from "zod";

import * as schema from "./schema.ts";

export const db = drizzle(env.DB_URL, { schema });

export const storyInsertSchema = z.object({
  name: z.string().trim().min(3).max(20),
  handler: z.string().trim().min(1).max(20),
});

export const messageInsertSchema = z.object({
  contentType: z.enum(["query", "response"]),
  handler: z.any(),
  extracted: z.boolean().default(false),
});

export const memoryInsertSchema = z.object({
  content: z.string().trim().min(1),
  category: z.string().trim().min(1),
  importance: z.number().gt(0).lte(1),
  confidence: z.number().gt(0).lte(1),
  action: z.enum(["ADD", "UPDATE", "DELETE"]),
});

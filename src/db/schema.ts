import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

const Timestamp = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
};

export const story = pgTable(
  "story",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    handler: text("handler").notNull(),
    ...Timestamp,
  },
  (table) => [
    // Index for finding stories by user
    index("story_user_id_idx").on(table.userId),
  ],
);

export const message = pgTable(
  "message",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    contentType: text("content-type", {
      enum: ["query", "response"],
    }).notNull(),
    content: jsonb("content").notNull(),
    extracted: boolean("extracted").notNull().default(false),
    ...Timestamp,
  },
  (table) => [
    // Index for finding messages by story (most common query)
    index("message_story_id_idx").on(table.storyId),
    // Index for filtering by extracted flag
    index("message_extracted_idx").on(table.extracted),
    // Composite index for story + extracted queries (even faster)
    index("message_story_extracted_idx").on(table.storyId, table.extracted),
  ],
);

export const memory = pgTable(
  "memory",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    content: text("content"),
    prevContent: text("previous_content"),

    // Memory metadata fields
    category: text("category"),
    importance: real("importance"), // 0-1 scale
    confidence: real("confidence"), // 0-1 scale
    action: text("action", { enum: ["ADD", "UPDATE", "DELETE"] }),

    embedding: vector("embedding", { dimensions: 1536 }),
    ...Timestamp,
  },
  (table) => [
    index("memory_user_idx").on(table.userId),
    index("memory_embedding_cos_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

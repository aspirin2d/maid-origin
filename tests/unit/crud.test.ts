import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

type QueryRows = Array<Record<string, unknown>>;

const mocked = vi.hoisted(() => {
  const selectQueue: QueryRows[] = [];
  const insertQueue: QueryRows[] = [];
  const updateQueue: QueryRows[] = [];
  const deleteQueue: QueryRows[] = [];

  const createSelectBuilder = (rows: QueryRows) => {
    const builder: any = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      offset: vi.fn(() => builder),
      $dynamic: vi.fn(() => builder),
      then: (resolve: (value: QueryRows) => unknown) => resolve(rows),
    };
    return builder;
  };

  const db = {
    __queues: { selectQueue, insertQueue, updateQueue, deleteQueue },
    select: vi.fn(() => createSelectBuilder(selectQueue.shift() ?? [])),
    insert: vi.fn(() => {
      const rows = insertQueue.shift() ?? [];
      const builder: any = {
        values: vi.fn(() => ({
          returning: vi.fn(async () => rows),
        })),
      };
      return builder;
    }),
    update: vi.fn(() => {
      const rows = updateQueue.shift() ?? [];
      const builder: any = {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => rows),
          })),
        })),
      };
      return builder;
    }),
    delete: vi.fn(() => {
      const rows = deleteQueue.shift() ?? [];
      const builder: any = {
        where: vi.fn(() => ({
          returning: vi.fn(async () => rows),
        })),
      };
      return builder;
    }),
  };

  const addExtractionJob = vi.fn();
  const embedMock = vi.fn(async () => [0.1]);

  const mockEnv = {
    PORT: 3010,
    NODE_ENV: "test",
    AUTH_API_URL: "",
    DB_URL: "",
    REDIS_URL: "",
    BASE_URL: "",
    ALLOWED_ORIGINS: "",
    OPENAI_API_KEY: "test",
    OPENAI_RESPONSE_MODEL: "gpt-4.1-mini",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    isProduction: false,
    isDevelopment: true,
    isTest: true,
  } as const;

  return { db, addExtractionJob, embedMock, mockEnv };
});

const mockDb = mocked.db;
const addExtractionJob = mocked.addExtractionJob;
const embedMock = mocked.embedMock;
const mockEnv = mocked.mockEnv;

vi.mock("../../src/env.ts", () => ({ env: mocked.mockEnv }));
vi.mock("../../src/db/index.ts", () => ({ db: mocked.db }));
vi.mock("../../src/queue/index.ts", () => ({ addExtractionJob: mocked.addExtractionJob }));
vi.mock("../../src/openai.ts", () => ({
  Embed: mocked.embedMock,
  Response: vi.fn(async () => ({})),
}));

import type { AppEnv, User } from "../../src/auth.ts";
import { memoryRoute } from "../../src/memory/index.ts";
import { messageRoute } from "../../src/message.ts";
import { storyRoute } from "../../src/story.ts";

const mockUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  role: "user",
};

function createApp(route: typeof memoryRoute) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", mockUser);
    return next();
  });
  app.route("/", route);
  return app;
}

function resetDbQueues() {
  mockDb.__queues.selectQueue.length = 0;
  mockDb.__queues.insertQueue.length = 0;
  mockDb.__queues.updateQueue.length = 0;
  mockDb.__queues.deleteQueue.length = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbQueues();
});

describe("memory CRUD routes", () => {
  it("creates a memory with embedding and user scoping", async () => {
    const created = {
      id: 1,
      userId: mockUser.id,
      content: "Remember the milk",
      category: "todo",
      importance: 0.8,
      confidence: 0.9,
      action: "ADD",
      embedding: [0.1],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    mockDb.__queues.insertQueue.push([created]);

    const app = createApp(memoryRoute);
    const response = await app.request("/create-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: created.content,
        category: created.category,
        importance: created.importance,
        confidence: created.confidence,
        action: created.action,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.memory).toMatchObject({
      id: created.id,
      content: created.content,
      userId: mockUser.id,
    });

    const insertBuilder = mockDb.insert.mock.results[0]?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: mockUser.id }),
    );
    expect(embedMock).toHaveBeenCalledWith(created.content);
  });

  it("returns 404 when updating a memory the user does not own", async () => {
    mockDb.__queues.selectQueue.push([]); // simulate missing memory

    const app = createApp(memoryRoute);
    const response = await app.request("/update-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 42,
        data: { content: "updated" },
      }),
    });

    expect(response.status).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("deletes a memory when it belongs to the user", async () => {
    const deleted = { id: 5 };
    mockDb.__queues.deleteQueue.push([deleted]);

    const app = createApp(memoryRoute);
    const response = await app.request("/delete-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deleted.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memory).toMatchObject({ id: deleted.id });
  });
});

describe("story CRUD routes", () => {
  it("creates a story scoped to the current user", async () => {
    const newStory = {
      id: 10,
      userId: mockUser.id,
      name: "Adventure",
      handler: "simple",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    mockDb.__queues.insertQueue.push([newStory]);

    const app = createApp(storyRoute);
    const response = await app.request("/create-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStory.name, handler: newStory.handler }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.story).toMatchObject({
      id: newStory.id,
      name: newStory.name,
      userId: mockUser.id,
    });
  });

  it("returns 404 when deleting a story that does not exist", async () => {
    mockDb.__queues.deleteQueue.push([]); // deletion returned nothing

    const app = createApp(storyRoute);
    const response = await app.request("/delete-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 99 }),
    });

    expect(response.status).toBe(404);
  });

  it("lists stories for the user with pagination applied", async () => {
    const stories = [
      { id: 1, userId: mockUser.id, name: "A", handler: "simple" },
      { id: 2, userId: mockUser.id, name: "B", handler: "simple" },
    ];
    mockDb.__queues.selectQueue.push(stories);

    const app = createApp(storyRoute);
    const response = await app.request(
      "/list-stories?limit=1&offset=1&sortBy=id&sortDirection=asc",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stories).toEqual(stories);

    const builder = mockDb.select.mock.results[0]?.value;
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(builder.offset).toHaveBeenCalledWith(1);
  });
});

describe("message CRUD routes", () => {
  it("creates a message only when the story belongs to the user", async () => {
    mockDb.__queues.selectQueue.push([{ id: 7 }]); // owning story
    const newMessage = {
      id: 3,
      storyId: 7,
      contentType: "query",
      content: { text: "hello" },
      extracted: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    mockDb.__queues.insertQueue.push([newMessage]);

    const app = createApp(messageRoute);
    const response = await app.request("/create-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId: newMessage.storyId,
        contentType: "query",
        content: newMessage.content,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.message).toMatchObject({
      id: newMessage.id,
      storyId: newMessage.storyId,
      contentType: newMessage.contentType,
    });
    expect(addExtractionJob).toHaveBeenCalledWith(mockUser.id);
  });

  it("rejects message creation when the story is missing", async () => {
    mockDb.__queues.selectQueue.push([]); // no story found

    const app = createApp(messageRoute);
    const response = await app.request("/create-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId: 123,
        contentType: "query",
        content: { text: "hello" },
      }),
    });

    expect(response.status).toBe(404);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns 404 when updating a message not owned by the user", async () => {
    mockDb.__queues.selectQueue.push([]); // authorization check fails

    const app = createApp(messageRoute);
    const response = await app.request("/update-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 5,
        data: { content: { text: "changed" } },
      }),
    });

    expect(response.status).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("deletes a message the user owns", async () => {
    mockDb.__queues.selectQueue.push([{ id: 9, storyId: 2 }]);
    mockDb.__queues.deleteQueue.push([
      { id: 9, storyId: 2, contentType: "query", content: {} },
    ]);

    const app = createApp(messageRoute);
    const response = await app.request("/delete-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 9 }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toMatchObject({ id: 9 });
  });

  it("lists messages for a story with pagination applied", async () => {
    const messages = [
      { id: 1, storyId: 2, contentType: "query", content: {} },
      { id: 2, storyId: 2, contentType: "response", content: {} },
    ];
    mockDb.__queues.selectQueue.push(messages);

    const app = createApp(messageRoute);
    const response = await app.request(
      "/list-messages?storyId=2&limit=1&offset=1&sortBy=id&sortDirection=asc",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toEqual(messages);

    const builder = mockDb.select.mock.results[0]?.value;
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(builder.offset).toHaveBeenCalledWith(1);
  });
});

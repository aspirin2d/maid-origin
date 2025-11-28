import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../src/auth.ts";
import { memoryRoute } from "../../src/memory/index.ts";

// Mock database and external services
const mockDb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const mockEmbed = vi.hoisted(() => vi.fn());

vi.mock("../../src/db/index.ts", () => ({ db: mockDb }));
vi.mock("../../src/openai.ts", () => ({ Embed: mockEmbed }));
vi.mock("../../src/env.ts", () => ({ env: { isProduction: false } }));

type Builder<T = any> = T & {
  _limit?: number;
  _offset?: number;
  then: (resolve: any, reject: any) => Promise<any>;
};

function makeSelectBuilder<T>(rows: T[]): Builder {
  const builder: Builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    $dynamic: vi.fn(() => builder),
    limit: vi.fn((n: number) => {
      builder._limit = n;
      return builder;
    }),
    offset: vi.fn((n: number) => {
      builder._offset = n;
      return builder;
    }),
    then(resolve, reject) {
      const start = builder._offset ?? 0;
      const end = builder._limit !== undefined ? start + builder._limit : undefined;
      const slice = rows.slice(start, end);
      return Promise.resolve(slice).then(resolve, reject);
    },
  } as Builder;

  return builder;
}

function makeReturningBuilder<T>(rows: T[]): Builder {
  const builder: Builder = {
    values: vi.fn(() => builder),
    set: vi.fn(() => builder),
    where: vi.fn(() => builder),
    returning: vi.fn(async () => rows),
  } as Builder;
  return builder;
}

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      role: "user",
    });
    await next();
  });

  app.route("/api", memoryRoute);
  return app;
}

describe("memory API routes", () => {
  beforeEach(() => {
    mockDb.insert = vi.fn();
    mockDb.select = vi.fn();
    mockDb.update = vi.fn();
    mockDb.delete = vi.fn();
    mockEmbed.mockReset();
  });

  it("lists memories with pagination applied", async () => {
    const rows = [
      { id: 1, content: "a", userId: "user-1" },
      { id: 2, content: "b", userId: "user-1" },
      { id: 3, content: "c", userId: "user-1" },
    ];
    mockDb.select.mockReturnValue(makeSelectBuilder(rows));

    const app = buildApp();
    const res = await app.request("/api/list-memories?limit=2&offset=1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toHaveLength(2);
    expect(body.memories.map((m: any) => m.id)).toEqual([2, 3]);
  });

  it("creates a memory and embeds its content", async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2]);
    const builder = makeReturningBuilder([
      {
        id: 10,
        content: "Hello world",
        userId: "user-1",
      },
    ]);
    mockDb.insert.mockReturnValue(builder);

    const app = buildApp();
    const res = await app.request("/api/create-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        content: "Hello world",
        category: "note",
        importance: 0.5,
        confidence: 0.9,
        action: "ADD",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memory.id).toBe(10);
    expect(mockEmbed).toHaveBeenCalledWith("Hello world");
    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        content: "Hello world",
        embedding: [0.1, 0.2],
      }),
    );
  });

  it("updates an existing memory", async () => {
    mockDb.select.mockReturnValue(
      makeSelectBuilder([{ id: 5, userId: "user-1", content: "old content" }]),
    );
    mockDb.update.mockReturnValue(
      makeReturningBuilder([{ id: 5, userId: "user-1", content: "new content" }]),
    );

    const app = buildApp();
    const res = await app.request("/api/update-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 5, data: { content: "new content" } }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.content).toBe("new content");
  });

  it("returns 404 when updating a missing memory", async () => {
    mockDb.select.mockReturnValue(makeSelectBuilder([]));

    const app = buildApp();
    const res = await app.request("/api/update-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 99, data: { content: "none" } }),
    });

    expect(res.status).toBe(404);
  });

  it("strips forbidden fields on memory update", async () => {
    mockDb.select.mockReturnValue(
      makeSelectBuilder([{ id: 5, userId: "user-1", content: "old content" }]),
    );
    const updateBuilder = makeReturningBuilder([
      { id: 5, userId: "user-1", content: "new content" },
    ]);
    mockDb.update.mockReturnValue(updateBuilder);

    const app = buildApp();
    await app.request("/api/update-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 5,
        data: {
          content: "new content",
          userId: "evil",
        },
      }),
    });

    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.not.objectContaining({
        userId: expect.anything(),
        createdAt: expect.anything(),
        id: expect.anything(),
      }),
    );
  });

  it("deletes a memory", async () => {
    mockDb.delete.mockReturnValue(makeReturningBuilder([{ id: 7, userId: "user-1" }]));

    const app = buildApp();
    const res = await app.request("/api/delete-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 7 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.id).toBe(7);
  });

  it("returns 404 when deleting a missing memory", async () => {
    mockDb.delete.mockReturnValue(makeReturningBuilder([]));

    const app = buildApp();
    const res = await app.request("/api/delete-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 404 }),
    });

    expect(res.status).toBe(404);
  });
});

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../src/auth.ts";
import { storyRoute } from "../../src/story.ts";

// Required env so mocked imports don't throw
process.env.AUTH_API_URL = "http://auth.local";
process.env.DB_URL = "postgres://user:pass@localhost:5432/db";
process.env.REDIS_URL = "redis://localhost:6379/0";
process.env.OPENAI_API_KEY = "sk-test";

// Prevent queue / OpenAI side effects
vi.mock("../../src/queue/index.ts", () => ({ addExtractionJob: vi.fn() }));
vi.mock("../../src/openai.ts", () => ({ Response: vi.fn() }));

type Builder<T = any> = T & {
  _limit?: number;
  _offset?: number;
  then: (resolve: any, reject: any) => Promise<any>;
};

// Create the mock database in a hoisted block so it exists when vi.mock is hoisted.
const mockDb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../src/db/index.ts", () => ({ db: mockDb }));

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

  app.route("/api", storyRoute);
  return app;
}

describe("story API routes", () => {
  beforeEach(() => {
    mockDb.insert = vi.fn();
    mockDb.select = vi.fn();
    mockDb.update = vi.fn();
    mockDb.delete = vi.fn();
  });

  it("creates a story", async () => {
    mockDb.insert.mockReturnValue(
      makeReturningBuilder([{ id: 1, name: "Test", handler: "simple" }]),
    );

    const app = buildApp();
    const res = await app.request("/api/create-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", handler: "simple" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.story.id).toBe(1);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("rejects create-story with missing fields", async () => {
    const app = buildApp();
    const res = await app.request("/api/create-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("gets a story by id", async () => {
    mockDb.select.mockReturnValue(
      makeSelectBuilder([{ id: 5, name: "Story", handler: "simple", userId: "user-1" }]),
    );

    const app = buildApp();
    const res = await app.request("/api/get-story?id=5");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.story.id).toBe(5);
  });

  it("returns 404 when story is missing", async () => {
    mockDb.select.mockReturnValue(makeSelectBuilder([]));

    const app = buildApp();
    const res = await app.request("/api/get-story?id=999");

    expect(res.status).toBe(404);
  });

  it("lists stories with limit/offset applied", async () => {
    const rows = [
      { id: 1, name: "A", handler: "simple" },
      { id: 2, name: "B", handler: "simple" },
      { id: 3, name: "C", handler: "simple" },
    ];
    mockDb.select.mockReturnValue(makeSelectBuilder(rows));

    const app = buildApp();
    const res = await app.request("/api/list-stories?limit=1&offset=1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stories).toHaveLength(1);
    expect(body.stories[0].id).toBe(2);
  });

  it("updates a story", async () => {
    mockDb.update.mockReturnValue(
      makeReturningBuilder([{ id: 1, name: "Updated", handler: "simple" }]),
    );

    const app = buildApp();
    const res = await app.request("/api/update-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, data: { name: "Updated" } }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.story.name).toBe("Updated");
  });

  it("strips forbidden fields on story update", async () => {
    const updateBuilder = makeReturningBuilder([
      { id: 1, name: "Updated", handler: "simple", userId: "user-1" },
    ]);
    mockDb.update.mockReturnValue(updateBuilder);

    const app = buildApp();
    await app.request("/api/update-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        data: {
          name: "Updated",
          handler: "simple",
          userId: "other-user",
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

  it("deletes a story", async () => {
    mockDb.delete.mockReturnValue(makeReturningBuilder([{ id: 1 }]));

    const app = buildApp();
    const res = await app.request("/api/delete-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.story.id).toBe(1);
  });
});

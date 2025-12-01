import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../src/auth.ts";
import { messageRoute } from "../../src/message.ts";

// Mock database
const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../src/db/index.ts", () => ({ db: mockDb }));
vi.mock("../../src/env.ts", () => ({ env: { isProduction: false } }));

type Builder<T = any> = T & {
  _limit?: number;
  _offset?: number;
  then: (resolve: any, reject: any) => Promise<any>;
};

function makeSelectBuilder<T>(rows: T[]): Builder {
  const builder: Builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
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

  app.route("/api", messageRoute);
  return app;
}

describe("message API routes", () => {
  beforeEach(() => {
    mockDb.select = vi.fn();
    mockDb.update = vi.fn();
    mockDb.delete = vi.fn();
  });

  it("lists messages with pagination applied", async () => {
    const rows = [
      { id: 1, storyId: 1, contentType: "query", content: { text: "hi" } },
      { id: 2, storyId: 1, contentType: "response", content: { text: "yo" } },
    ];
    mockDb.select.mockReturnValue(makeSelectBuilder(rows));

    const app = buildApp();
    const res = await app.request("/api/list-messages?limit=1&offset=1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].id).toBe(2);
  });

  it("gets a message by ID", async () => {
    mockDb.select.mockReturnValue(
      makeSelectBuilder([{ id: 5, storyId: 1, contentType: "query", content: {} }]),
    );

    const app = buildApp();
    const res = await app.request("/api/get-message?id=5");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.id).toBe(5);
  });

  it("returns 404 when message not found", async () => {
    mockDb.select.mockReturnValue(makeSelectBuilder([]));

    const app = buildApp();
    const res = await app.request("/api/get-message?id=999");

    expect(res.status).toBe(404);
  });

  it("updates a message", async () => {
    mockDb.select.mockReturnValue(
      makeSelectBuilder([{ id: 3, storyId: 1, contentType: "query", content: {} }]),
    );
    const updateBuilder = makeReturningBuilder([
      { id: 3, storyId: 1, contentType: "response", content: { text: "ok" } },
    ]);
    mockDb.update.mockReturnValue(updateBuilder);

    const app = buildApp();
    const res = await app.request("/api/update-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 3,
        contentType: "response",
        content: { text: "ok" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.contentType).toBe("response");
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "response",
        content: { text: "ok" },
      }),
    );
  });

  it("deletes a message", async () => {
    mockDb.select.mockReturnValue(
      makeSelectBuilder([{ id: 9, storyId: 1, contentType: "query", content: {} }]),
    );
    mockDb.delete.mockReturnValue(makeReturningBuilder([{ id: 9 }]));

    const app = buildApp();
    const res = await app.request("/api/delete-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 9 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.id).toBe(9);
  });
});

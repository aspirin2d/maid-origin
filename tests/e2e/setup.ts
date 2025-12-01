import { vi } from "vitest";
import dotenv from "dotenv";

// Load the same env file as the tests so values (e.g., TEST_USER) are available early
dotenv.config({ path: "./tests/.env", override: true });

// Ensure test-friendly environment variables so src/env.ts validations don't explode
process.env.NODE_ENV ??= "test";
process.env.AUTH_API_URL ??= "http://auth.local";
process.env.API_BASE_URL ??= "http://api.local";
process.env.DB_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "sk-test";

type User = { id: string; name: string; email: string; role: "user" | "admin" };
type Story = {
  id: number;
  userId: string;
  name: string;
  handler: string;
  createdAt: number;
};
type Memory = { id: number; userId: string; content: string; createdAt: number };

// ------------------ In-memory BullMQ mock ------------------
type JobData = Record<string, any>;
class InMemoryJob {
  constructor(
    public id: string,
    public name: string,
    public data: JobData,
    public timestamp: number,
    public delay: number,
    private queue: InMemoryQueue,
    public dedupKey?: string,
  ) {}

  async remove() {
    this.queue.removeJob(this.id);
  }
}

class InMemoryQueue {
  jobs: InMemoryJob[] = [];
  dedup = new Map<string, string>();

  constructor(public name: string) {}

  removeJob(id: string) {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    for (const [key, value] of this.dedup.entries()) {
      if (value === id) this.dedup.delete(key);
    }
  }

  async add(
    _name: string,
    data: JobData,
    opts?: { delay?: number; deduplication?: { id: string } },
  ) {
    const delay = opts?.delay ?? 0;
    const dedupKey = opts?.deduplication?.id;
    if (dedupKey && this.dedup.has(dedupKey)) {
      const existingId = this.dedup.get(dedupKey)!;
      this.removeJob(existingId);
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job = new InMemoryJob(
      id,
      this.name,
      data,
      Date.now(),
      delay,
      this,
      dedupKey,
    );
    this.jobs.push(job);
    if (dedupKey) this.dedup.set(dedupKey, id);
    return job;
  }

  async getJobs(_types: Array<string>) {
    return [...this.jobs];
  }

  async removeDeduplicationKey(key: string) {
    const id = this.dedup.get(key);
    if (id) this.removeJob(id);
  }

  async close() {
    /* no-op */
  }
}

const queues = new Map<string, InMemoryQueue>();
function getQueue(name: string) {
  if (!queues.has(name)) queues.set(name, new InMemoryQueue(name));
  return queues.get(name)!;
}

// Mock the bullmq module before application code loads
vi.mock("bullmq", () => {
  return {
    Queue: class MockQueue {
      private queue: InMemoryQueue;
      constructor(name: string) {
        this.queue = getQueue(name);
      }
      add(name: string, data: JobData, opts?: any) {
        return this.queue.add(name, data, opts);
      }
      getJobs(types: Array<string>) {
        return this.queue.getJobs(types);
      }
      removeDeduplicationKey(key: string) {
        return this.queue.removeDeduplicationKey(key);
      }
      close() {
        return this.queue.close();
      }
    },
    Worker: class MockWorker {
      constructor(_name: string, _handler: any, _opts?: any) {
        // intentionally do nothing; jobs are observed manually in tests
      }
      on() {
        /* no-op */
      }
    },
    Job: InMemoryJob,
  };
});

// Mock OpenAI helpers to avoid network
vi.mock("../../src/openai.ts", () => {
  return {
    Response: async () => ({ answer: "Test response" }),
    Embed: async (_input: any) => Array(1536).fill(0),
  };
});

// ------------------ Fetch stub ------------------
const TEST_USER: User = {
  id: "test-user",
  name: "Test User",
  email: process.env.TEST_USER || "test@example.com",
  role: "user",
};
const AUTH_TOKEN = "test-token";

let nextStoryId = 1;
let nextMemoryId = 1;
const stories: Story[] = [];
const memories: Memory[] = [];

function requireAuth(headers?: HeadersInit) {
  const authHeader = headers instanceof Headers
    ? headers.get("authorization") || headers.get("Authorization")
    : (headers as any)?.Authorization || (headers as any)?.authorization;
  if (!authHeader) return false;
  const match = String(authHeader).match(/^Bearer\s+(.*)$/i);
  return match?.[1] === AUTH_TOKEN;
}

function jsonResponse(body: any, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
}

async function handleAuthApi(url: URL, init?: RequestInit) {
  if (url.pathname.endsWith("/sign-in/email") && init?.method === "POST") {
    return jsonResponse({}, { status: 200, headers: { "set-auth-token": AUTH_TOKEN } });
  }
  if (url.pathname.endsWith("/get-session")) {
    return jsonResponse({
      user: TEST_USER,
      session: { userId: TEST_USER.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
    });
  }
  return new Response("Not found", { status: 404 });
}

function parseBody(init?: RequestInit) {
  if (!init?.body) return undefined;
  if (typeof init.body === "string") return JSON.parse(init.body);
  if (init.body instanceof Uint8Array) return JSON.parse(init.body.toString());
  return init.body as any;
}

function paginate<T>(items: T[], limit?: number, offset?: number) {
  const start = offset ?? 0;
  const end = limit ? start + limit : undefined;
  return items.slice(start, end);
}

function sortStories(items: Story[], sortBy = "createdAt", dir: "asc" | "desc" = "desc") {
  const factor = dir === "asc" ? 1 : -1;
  return [...items].sort((a: any, b: any) => (a[sortBy] - b[sortBy]) * factor);
}

function validateLiveInput(input: any): input is Record<string, any> {
  if (!input || typeof input !== "object") return false;
  const { type, data } = input as any;
  switch (type) {
    case "user_chat":
      return typeof data?.message === "string";
    case "bullet_chat":
      return (
        typeof data?.message === "string" &&
        typeof data?.username === "string" &&
        typeof data?.position === "string"
      );
    case "gift_event":
      return (
        typeof data?.username === "string" &&
        typeof data?.giftName === "string" &&
        typeof data?.giftCount === "number" &&
        typeof data?.giftValue === "number"
      );
    case "program_event":
      return data?.action === "start" && typeof data?.programName === "string";
    default:
      return false;
  }
}

function validateImInput(input: any): boolean {
  if (!input || typeof input !== "object") return false;
  if (input.type === "textchat") return typeof input.message === "string";
  if (input.type === "command") return typeof input.command === "string";
  return false;
}

async function handleApi(url: URL, init?: RequestInit) {
  if (!requireAuth(init?.headers)) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const path = url.pathname.replace(/^\/api/, "");
  const method = (init?.method || "GET").toUpperCase();

  if (path === "/user" && method === "GET") {
    return jsonResponse({ user: TEST_USER });
  }

  if (path === "/create-story" && method === "POST") {
    const body = parseBody(init) || {};
    const story: Story = {
      id: nextStoryId++,
      userId: TEST_USER.id,
      name: body.name,
      handler: body.handler,
      createdAt: Date.now(),
    };
    stories.push(story);
    return jsonResponse({ story }, { status: 201 });
  }

  if (path === "/get-story" && method === "GET") {
    const id = Number(url.searchParams.get("id"));
    const story = stories.find((s) => s.id === id && s.userId === TEST_USER.id);
    if (!story) return jsonResponse({ error: "Story not found" }, { status: 404 });
    return jsonResponse({ story });
  }

  if (path === "/update-story" && method === "POST") {
    const body = parseBody(init) || {};
    const story = stories.find((s) => s.id === body.id && s.userId === TEST_USER.id);
    if (!story) return jsonResponse({ error: "Story not found" }, { status: 404 });
    story.name = body.name ?? story.name;
    story.handler = body.handler ?? story.handler;
    return jsonResponse({ story });
  }

  if (path === "/delete-story" && method === "POST") {
    const body = parseBody(init) || {};
    const index = stories.findIndex((s) => s.id === body.id && s.userId === TEST_USER.id);
    if (index === -1) return jsonResponse({ error: "Story not found" }, { status: 404 });
    const [story] = stories.splice(index, 1);
    // also remove any messages/memories tied to it (simplified)
    return jsonResponse({ story });
  }

  if (path === "/list-stories" && method === "GET") {
    const sortBy = url.searchParams.get("sortBy") || "createdAt";
    const sortDirection = (url.searchParams.get("sortDirection") as "asc" | "desc") || "desc";
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
    const userStories = stories.filter((s) => s.userId === TEST_USER.id);
    const sorted = sortStories(userStories, sortBy, sortDirection);
    const paged = paginate(sorted, limit, offset);
    return jsonResponse({ stories: paged });
  }

  if (path === "/list-memories" && method === "GET") {
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
    const userMemories = memories
      .filter((m) => m.userId === TEST_USER.id)
      .sort((a, b) => b.id - a.id);
    const paged = paginate(userMemories, limit, offset);
    return jsonResponse({ memories: paged });
  }

  if (path === "/prune-memories" && method === "POST") {
    const remaining = memories.length;
    for (let i = memories.length - 1; i >= 0; i--) {
      if (memories[i].userId === TEST_USER.id) memories.splice(i, 1);
    }
    return jsonResponse({ deleted: remaining - memories.length });
  }

  if (path === "/generate-story" && method === "POST") {
    const body = parseBody(init) || {};
    const story = stories.find((s) => s.id === body.storyId && s.userId === TEST_USER.id);
    if (!story) return jsonResponse({ error: "Story not found" }, { status: 404 });

    // Basic input validation per handler expectations
    if (story.handler === "live" && !validateLiveInput(body.input)) {
      return jsonResponse({ error: "Invalid live input" }, { status: 400 });
    }
    if (story.handler === "im" && !validateImInput(body.input)) {
      return jsonResponse({ error: "Invalid im input" }, { status: 400 });
    }

    let response: any = {};
    if (story.handler === "live") {
      response = { clips: [{ body: "clip", face: "😀", speech: "thanks" }] };
    } else if (story.handler === "im") {
      response = {
        responseType: body.input?.type ?? "textchat",
        text: "ok",
        emotion: "happy",
        affectionChange: 0,
        moodChange: 0,
        energyChange: 0,
        imageKey: null,
        taskType: null,
        taskDelaySeconds: null,
        taskContent: null,
      };
    } else {
      response = { answer: "10" };
    }

    // Simulate enqueueing memory extraction job and creating a memory
    const queue = getQueue("memory-extraction");
    await queue.add("memory-extraction", { uid: TEST_USER.id }, {
      delay: 20_000,
      deduplication: { id: `${TEST_USER.id}Extraction` },
    });

    // Create a new memory quickly so polling observes growth
    memories.unshift({
      id: nextMemoryId++,
      userId: TEST_USER.id,
      content: `Memory from story ${story.id}`,
      createdAt: Date.now(),
    });

    return jsonResponse({ storyId: story.id, handler: story.handler, response });
  }

  return new Response("Not found", { status: 404 });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const apiBase = process.env.API_BASE_URL!;
  const authBase = process.env.AUTH_API_URL!;

  if (url.origin === new URL(authBase).origin && url.pathname.startsWith(new URL(authBase).pathname)) {
    return handleAuthApi(url, init);
  }

  if (url.origin === new URL(apiBase).origin && url.pathname.startsWith("/api")) {
    return handleApi(url, init);
  }

  // Fallback to real fetch if somehow needed
  return realFetch(input, init);
}) as typeof fetch;

import { afterEach, describe, expect, it, vi } from "vitest";

// Keep a copy so we can restore after each test and avoid cross-test pollution.
const ORIGINAL_ENV = { ...process.env };

const requiredEnv = {
  AUTH_API_URL: "http://auth.local",
  DB_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379/0",
  OPENAI_API_KEY: "sk-test",
};

async function loadEnv(
  overrides: Record<string, string | undefined> = {},
  deleteKeys: string[] = [],
) {
  vi.resetModules();

  const nextEnv: Record<string, string> = {
    ...ORIGINAL_ENV,
    ...requiredEnv,
  };

  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value === "string") {
      nextEnv[key] = value;
    } else {
      delete nextEnv[key];
    }
  });

  deleteKeys.forEach((key) => delete nextEnv[key]);

  process.env = nextEnv;

  return import("../../src/env.ts");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("env configuration", () => {
  it("uses default port 3010 when PORT is not set", async () => {
    const { env } = await loadEnv({}, ["PORT"]);
    expect(env.PORT).toBe(3010);
  });

  it("parses PORT when provided as a valid number string", async () => {
    const { env } = await loadEnv({ PORT: "4500" });
    expect(env.PORT).toBe(4500);
  });

  it("throws when PORT is invalid", async () => {
    await expect(loadEnv({ PORT: "not-a-number" })).rejects.toThrow(/PORT/);
  });

  it("throws when a required variable is missing", async () => {
    await expect(loadEnv({}, ["AUTH_API_URL"])).rejects.toThrow(
      /AUTH_API_URL/,
    );
  });

  it("derives NODE_ENV flags", async () => {
    const { env } = await loadEnv({ NODE_ENV: "production" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.isProduction).toBe(true);
    expect(env.isDevelopment).toBe(false);
    expect(env.isTest).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  getFactRetrievalMessages,
  parseMessages,
  removeCodeBlocks,
} from "../../src/memory/prompt.ts";

describe("removeCodeBlocks", () => {
  it("strips fenced code blocks while keeping surrounding text", () => {
    const input = "Hello```js\nconsole.log('hi')\n```there";
    const output = removeCodeBlocks(input);

    expect(output).toBe("Hellothere");
  });
});

describe("parseMessages", () => {
  it("joins messages with newlines", () => {
    const output = parseMessages(["first", "second", "third"]);
    expect(output).toBe("first\nsecond\nthird");
  });
});

describe("getFactRetrievalMessages", () => {
  const fixedDate = new Date("2025-01-02T12:00:00Z");

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("includes the provided conversation and the current date", () => {
    const conversation = "User said hello";
    const prompt = getFactRetrievalMessages(conversation);

    expect(prompt).toContain(conversation);
    expect(prompt).toContain("2025-01-02");
  });
});

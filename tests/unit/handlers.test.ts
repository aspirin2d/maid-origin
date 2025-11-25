import { describe, expect, it } from "vitest";

import {
  getStoryHandlerByName,
  type MessageInsert,
  type StoryHandlerContext,
} from "../../src/handlers/index.ts";
import { simpleHandler } from "../../src/handlers/simple.ts";

describe("getStoryHandlerByName", () => {
  it("returns the concrete handler implementation for a registered name", () => {
    const handler = getStoryHandlerByName("simple");
    expect(handler).toBe(simpleHandler);
    expect(handler.name).toBe("simple");
  });

  it("throws for unknown handler names to prevent silently using the wrong interface", () => {
    expect(() => getStoryHandlerByName("does-not-exist" as any)).toThrow(
      /Unknown story handler/,
    );
  });
});

describe("MessageInsert type contract", () => {
  type Input = { question: string };
  type Response = { answer: string };
  type TestContext = StoryHandlerContext<Input>;

  const messageToString = simpleHandler.messageToString.bind(simpleHandler);

  it("formats user input messages consistently", () => {
    const message: MessageInsert<Input, Response> = {
      contentType: "input",
      content: { question: "How are you?" },
    };
    expect(messageToString(message)).toBe("User: How are you?");
  });

  it("formats assistant response messages consistently", () => {
    const message: MessageInsert<Input, Response> = {
      contentType: "response",
      content: { answer: "Doing well!" },
    };
    expect(messageToString(message)).toBe("Assistant: Doing well!");
  });

  it("preserves schema types across handler context", () => {
    // This test mainly guards the interface shape; runtime assertion keeps it lightweight.
    const context: TestContext = {
      storyId: "123",
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        role: "user",
      },
      input: { question: "What time is it?" },
    };

    expect(context.input.question).toBe("What time is it?");
    expect(context.user.id).toBe("user-1");
  });
});

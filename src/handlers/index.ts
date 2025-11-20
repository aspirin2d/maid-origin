import z from "zod";

import type { ZodType } from "zod";
import type { User } from "../auth.ts";
import type { JSONSerializable } from "../db/schema.ts";
import { simpleHandler } from "./simple.ts";

export type MessageInsert = {
  contentType: string;
  content: JSONSerializable | null;
};

export interface StoryHandlerContext {
  storyId: string;
  user: User;
  input: JSONSerializable; // story-response router payload
}

export interface StoryHandler<T extends ZodType> {
  name: string;
  description: string;
  beforeGenerate(context: StoryHandlerContext): Promise<{
    prompt: string;
    responseSchema: T;
    insertMessages: MessageInsert[];
  }>;
  afterGenerate(
    context: StoryHandlerContext,
    response: z.infer<T>,
  ): Promise<MessageInsert[]>;
}

const registeredStoryHandlers = [simpleHandler] as const;

export type RegisteredStoryHandler = (typeof registeredStoryHandlers)[number];

export function getStoryHandlerByName(name: string): RegisteredStoryHandler {
  const handler = registeredStoryHandlers.find(
    (candidate) => candidate.name === name,
  );
  if (!handler) {
    throw new Error(`Unknown story handler: ${name}`);
  }
  return handler;
}

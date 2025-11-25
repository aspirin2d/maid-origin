import z from "zod";

import type { ZodType } from "zod";
import type { User } from "../auth.ts";
import { simpleHandler } from "./simple.ts";

export type MessageInsert<TInput, TResponse> =
  | { contentType: "input"; content: TInput }
  | { contentType: "response"; content: TResponse };

export interface StoryHandlerContext<TInput> {
  storyId: string;
  user: User;
  input: TInput;
}

export interface StoryHandler<
  TInputSchema extends ZodType,
  TResponseSchema extends ZodType,
> {
  name: string;
  description: string;
  inputSchema: TInputSchema;
  responseSchema: TResponseSchema;
  beforeGenerate(
    context: StoryHandlerContext<z.output<TInputSchema>>,
  ): Promise<{
    prompt: string;
    responseSchema: TResponseSchema;
    insertMessages: MessageInsert<
      z.output<TInputSchema>,
      z.output<TResponseSchema>
    >[];
  }>;
  afterGenerate(
    context: StoryHandlerContext<z.output<TInputSchema>>,
    response: z.output<TResponseSchema>,
  ): Promise<
    MessageInsert<
      z.output<TInputSchema>,
      z.output<TResponseSchema>
    >[]
  >;
  messageToString(
    message: MessageInsert<
      z.output<TInputSchema>,
      z.output<TResponseSchema>
    >,
  ): string;
}

const registeredStoryHandlers = [simpleHandler] as const;
export type RegisteredStoryHandler = (typeof registeredStoryHandlers)[number];

export function getStoryHandlerByName<
  TName extends RegisteredStoryHandler["name"],
>(
  name: TName,
): Extract<RegisteredStoryHandler, { name: TName }> {
  const handler = registeredStoryHandlers.find(
    (candidate) => candidate.name === name,
  );
  if (!handler) {
    throw new Error(`Unknown story handler: ${name}`);
  }
  return handler as Extract<RegisteredStoryHandler, { name: TName }>;
}

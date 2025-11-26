import z from "zod";

import type { ZodType } from "zod";
import type { User } from "../auth.ts";
import { simpleHandler } from "./simple.ts";

export type QueryMessage<TQuery> = {
  contentType: "query";
  content: TQuery;
};

export type ResponseMessage<TResponse> = {
  contentType: "response";
  content: TResponse;
};

// Message shape persisted for any handler: either the user's query or the model's response.
export type MessageInsert<TQuery, TResponse> =
  | QueryMessage<TQuery>
  | ResponseMessage<TResponse>;

export interface StoryHandlerContext<TInput> {
  storyId: string;
  user: User;
  input: TInput;
}

export interface StoryHandler<
  TQuerySchema extends ZodType,
  TResponseSchema extends ZodType,
> {
  name: string;
  description: string;
  querySchema: TQuerySchema;
  responseSchema: TResponseSchema;
  beforeGenerate(
    context: StoryHandlerContext<z.output<TQuerySchema>>,
  ): Promise<{
    prompt: string;
    responseSchema: TResponseSchema;
    queryMessage: QueryMessage<z.output<TQuerySchema>>;
  }>;
  afterGenerate(
    context: StoryHandlerContext<z.output<TQuerySchema>>,
    response: z.output<TResponseSchema>,
  ): Promise<ResponseMessage<z.output<TResponseSchema>>>;
  messageToString(
    message:
      | ResponseMessage<z.output<TResponseSchema>>
      | QueryMessage<z.output<TQuerySchema>>,
  ): string;
}

const registeredStoryHandlers = [simpleHandler] as const;
export type RegisteredStoryHandler = (typeof registeredStoryHandlers)[number];

export function getStoryHandlerByName<
  TName extends RegisteredStoryHandler["name"],
>(name: TName): Extract<RegisteredStoryHandler, { name: TName }> {
  const handler = registeredStoryHandlers.find(
    (candidate) => candidate.name === name,
  );
  if (!handler) {
    throw new Error(`Unknown story handler: ${name}`);
  }
  return handler as Extract<RegisteredStoryHandler, { name: TName }>;
}

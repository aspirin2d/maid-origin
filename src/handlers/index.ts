import type { ZodType } from "zod";
import type { User } from "../auth.ts";
import { imHandler } from "./im/index.ts";
import { simpleHandler } from "./simple.ts";
import { liveHandler } from "./live/index.ts";

export type QueryMessage<TQuery> = {
  contentType: "query";
  content: TQuery;
};

export type ResponseMessage<TResponse> = {
  contentType: "response";
  content: TResponse;
};

export type MessageInsert<TQuery, TResponse> =
  | QueryMessage<TQuery>
  | ResponseMessage<TResponse>;

export interface StoryHandlerContext<TInput> {
  storyId: string;
  user: User;
  input: TInput;
}

export interface StoryHandler<TQuery, TResponse> {
  name: string;
  description: string;
  querySchema: ZodType<TQuery>;
  responseSchema: ZodType<TResponse>;

  beforeGenerate(context: StoryHandlerContext<TQuery>): Promise<{
    prompt: string;
    queryMessage: QueryMessage<TQuery>;
    // you can still allow a different response schema at runtime if needed:
    responseSchema?: ZodType<TResponse>;
  }>;

  afterGenerate(
    context: StoryHandlerContext<TQuery>,
    response: TResponse,
  ): Promise<ResponseMessage<TResponse>>;

  messageToString(
    message: ResponseMessage<TResponse> | QueryMessage<TQuery>,
  ): string;
}

const handlerRegistry = new Map<string, StoryHandler<any, any>>();

export function registerStoryHandler(handler: StoryHandler<any, any>) {
  if (handlerRegistry.has(handler.name)) {
    throw new Error(`Duplicate story handler name: ${handler.name}`);
  }
  handlerRegistry.set(handler.name, handler);
}

export function getStoryHandlerByName(name: string): StoryHandler<any, any> {
  const handler = handlerRegistry.get(name);
  if (!handler) {
    throw new Error(`Unknown story handler: ${name}`);
  }
  return handler;
}

registerStoryHandler(simpleHandler);
registerStoryHandler(imHandler);
registerStoryHandler(liveHandler);

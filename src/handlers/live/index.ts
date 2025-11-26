import { z } from "zod";

import type {
  QueryMessage,
  ResponseMessage,
  StoryHandler,
  StoryHandlerContext,
} from "../index.ts";
import { buildPrompt } from "./prompt-builder.ts";
import {
  extractEventText,
  liveInputSchema,
  normalizeToEvent,
  type LiveInput,
} from "./events.ts";
import type { HandlerConfig, StoryContext } from "./types.ts";

const storyIdSchema = z.coerce.number().int().positive({
  message: "Story id must be a positive integer",
});

const clipSchema = z.object({
  body: z.string().describe("身体动作/姿势描述"),
  face: z.string().describe("面部表情描述"),
  speech: z.string().describe("VTuber要说的文本内容"),
});

const responseSchema = z.object({
  clips: z.array(clipSchema).min(1).max(3).describe("VTuber回复的1-3个片段"),
});

type LiveQuery = z.output<typeof liveInputSchema>;
type LiveResponse = z.output<typeof responseSchema>;
type LiveMessage = QueryMessage<LiveQuery> | ResponseMessage<LiveResponse>;

const MAX_HISTORY_MESSAGES = 20;

function getQueryText(input: LiveInput): string {
  const event = normalizeToEvent(input);
  return extractEventText(event) ?? JSON.stringify(event);
}

function summarizeResponse(payload: LiveResponse): string {
  if (!payload.clips || payload.clips.length === 0) {
    return "(no clips)";
  }
  const speech = payload.clips
    .map((clip) => clip.speech?.trim())
    .filter(Boolean)
    .join(" ");
  return speech || JSON.stringify(payload.clips);
}

export const liveHandler: StoryHandler<LiveQuery, LiveResponse> = {
  name: "live",
  description:
    "AI VTuber handler generating 1-3 expressive clips (body, face, speech) from live events and chat input.",
  querySchema: liveInputSchema,
  responseSchema,

  async beforeGenerate(context: StoryHandlerContext<LiveQuery>) {
    const storyId = storyIdSchema.parse(context.storyId);

    const parsedInput = liveInputSchema.parse(context.input);
    const normalizedEvent = normalizeToEvent(parsedInput);

    const storyContext: StoryContext = {
      storyId,
      userId: context.user.id,
      provider: "openai",
    };

    const handlerConfig: HandlerConfig = {
      messageLimit: MAX_HISTORY_MESSAGES,
    };

    const queryMessage: LiveMessage = {
      contentType: "query",
      content: parsedInput,
    };

    const prompt = await buildPrompt(normalizedEvent, storyContext, handlerConfig);

    return {
      prompt,
      responseSchema,
      queryMessage,
    };
  },

  async afterGenerate(
    _context: StoryHandlerContext<LiveQuery>,
    response: LiveResponse,
  ) {
    const responseMessage: LiveMessage = {
      contentType: "response",
      content: response,
    };
    return responseMessage;
  },

  messageToString(message: LiveMessage): string {
    if (message.contentType === "query") {
      return `User: ${getQueryText(message.content)}`;
    }
    if (message.contentType === "response") {
      return `Assistant: ${summarizeResponse(message.content)}`;
    }
    return "(Unknown message)";
  },
};

export { liveInputSchema as querySchema, responseSchema };

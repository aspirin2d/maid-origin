import { z } from "zod";

/**
 * Event-based input schema for the live handler
 * Supports various types of events from live streaming scenarios
 */

// ==================== Event Type Definitions ====================

/**
 * User interaction events - messages from viewers
 */
const userChatEventSchema = z.object({
  type: z.literal("user_chat"),
  data: z.object({
    message: z.string().describe("The user's message content"),
    username: z.string().describe("Username of the sender").optional(),
    timestamp: z.number().describe("Timestamp of the message").optional(),
  }),
});

/**
 * Bullet chat (danmaku) events - streaming comments
 * These are typically shorter, more casual messages that appear during live streams
 */
const bulletChatEventSchema = z.object({
  type: z.literal("bullet_chat"),
  data: z.object({
    message: z.string().describe("The bullet chat message content"),
    username: z.string().describe("Username of the sender").optional(),
    timestamp: z.number().describe("Timestamp of the message").optional(),
    position: z
      .enum(["top", "bottom", "scroll"])
      .describe("Display position of the bullet chat")
      .optional(),
  }),
});

/**
 * Program transition events - when live programs start or finish
 */
const programEventSchema = z.object({
  type: z.literal("program_event"),
  data: z.object({
    action: z
      .enum(["start", "finish", "pause", "resume"])
      .describe("Program action type"),
    programId: z.string().describe("Unique identifier for the program").optional(),
    programName: z.string().describe("Name of the program"),
    programType: z
      .enum(["singing", "chatting", "gaming", "drawing", "other"])
      .describe("Type of program")
      .optional(),
    duration: z.number().describe("Duration in seconds (for finish events)").optional(),
    metadata: z.record(z.string(), z.unknown()).describe("Additional program metadata").optional(),
  }),
});

/**
 * Gift/donation events - when viewers send gifts or donations
 */
const giftEventSchema = z.object({
  type: z.literal("gift_event"),
  data: z.object({
    username: z.string().describe("Username of the sender"),
    giftName: z.string().describe("Name of the gift"),
    giftCount: z.number().default(1).describe("Number of gifts sent"),
    giftValue: z.number().describe("Value or cost of the gift").optional(),
    message: z.string().describe("Optional message with the gift").optional(),
  }),
});

/**
 * User interaction events - follow, subscribe, etc.
 */
const userInteractionEventSchema = z.object({
  type: z.literal("user_interaction"),
  data: z.object({
    action: z
      .enum(["follow", "subscribe", "like", "share"])
      .describe("Interaction type"),
    username: z.string().describe("Username of the user"),
    tier: z.string().describe("Subscription tier (for subscribe events)").optional(),
    months: z.number().describe("Number of months (for subscribe events)").optional(),
  }),
});

/**
 * System events - platform-level notifications
 */
const systemEventSchema = z.object({
  type: z.literal("system_event"),
  data: z.object({
    eventType: z
      .string()
      .describe("Type of system event (e.g., 'stream_start', 'stream_end', 'technical_issue')"),
    message: z.string().describe("System message content").optional(),
    severity: z
      .enum(["info", "warning", "error"])
      .default("info")
      .describe("Event severity level"),
    metadata: z.record(z.string(), z.unknown()).describe("Additional system event metadata").optional(),
  }),
});

/**
 * Emotion/mood events - emotional state changes or expressions
 */
const emotionEventSchema = z.object({
  type: z.literal("emotion_event"),
  data: z.object({
    emotion: z
      .string()
      .describe("Emotion type (e.g., 'happy', 'excited', 'tired', 'surprised')"),
    intensity: z
      .number()
      .min(0)
      .max(1)
      .describe("Intensity of the emotion (0-1)")
      .optional(),
    trigger: z.string().describe("What triggered this emotion").optional(),
    duration: z.number().describe("Expected duration in seconds").optional(),
  }),
});

/**
 * Simple text input for backward compatibility
 */
const simpleTextEventSchema = z.object({
  type: z.literal("simple_text"),
  data: z.object({
    text: z.string().describe("Simple text input"),
  }),
});

// ==================== Union Schema ====================

/**
 * Main event schema - union of all event types
 */
export const liveEventSchema = z.discriminatedUnion("type", [
  userChatEventSchema,
  bulletChatEventSchema,
  programEventSchema,
  giftEventSchema,
  userInteractionEventSchema,
  systemEventSchema,
  emotionEventSchema,
  simpleTextEventSchema,
]);

export type LiveEvent = z.infer<typeof liveEventSchema>;

// ==================== Input Schema ====================

/**
 * Complete input schema that supports both new event format and legacy formats
 */
const legacyTextSchema = z
  .object({
    prompt: z.string().optional(),
    question: z.string().optional(),
    message: z.string().optional(),
    input: z.string().optional(),
  })
  .strict()
  .refine(
    (data) =>
      [data.prompt, data.question, data.message, data.input].some(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    {
      message:
        "At least one of prompt, question, message, or input must be a non-empty string",
    },
  );

export const liveInputSchema = z.union([
  // New event-based format
  liveEventSchema,
  // Legacy simple string format
  z.string(),
  // Legacy object format with various field names
  legacyTextSchema,
]);

export type LiveInput = z.infer<typeof liveInputSchema>;

// ==================== Helper Functions ====================

/**
 * Normalize legacy input formats to event format
 *
 * Converts various input formats (string, legacy object, or event) into
 * a standardized LiveEvent format for consistent processing.
 *
 * @param input - Raw input in any supported format
 * @returns Normalized LiveEvent
 */
export function normalizeToEvent(input: LiveInput): LiveEvent {
  // Already an event - return as-is
  if (typeof input === "object" && "type" in input) {
    return input as LiveEvent;
  }

  // Simple string - convert to user_chat event
  if (typeof input === "string") {
    return {
      type: "user_chat",
      data: {
        message: input,
      },
    };
  }

  // Legacy object format - extract text and convert to user_chat event
  const text =
    input.prompt ?? input.question ?? input.message ?? input.input ?? "";

  return {
    type: "user_chat",
    data: {
      message: text,
    },
  };
}

/**
 * Extract displayable text from any event for chat history
 *
 * Converts events into human-readable text suitable for saving as
 * user messages in the chat history.
 *
 * @param event - The event to extract text from
 * @returns Formatted text representation, or null if not applicable
 */
export function extractEventText(event: LiveEvent): string | null {
  switch (event.type) {
    case "user_chat":
      return event.data.message;

    case "bullet_chat":
      return `[弹幕] ${event.data.message}`;

    case "program_event": {
      const actionMap = {
        start: "开始",
        finish: "结束",
        pause: "暂停",
        resume: "恢复",
      };
      const action = actionMap[event.data.action] || event.data.action;
      return `[节目${action}] ${event.data.programName}`;
    }

    case "gift_event": {
      const giftMsg = `[礼物] ${event.data.username} 送出了 ${event.data.giftCount}x ${event.data.giftName}`;
      return event.data.message ? `${giftMsg}: ${event.data.message}` : giftMsg;
    }

    case "user_interaction": {
      const actionMap = {
        follow: "关注",
        subscribe: "订阅",
        like: "点赞",
        share: "分享",
      };
      const actionText = actionMap[event.data.action];
      return `[${actionText}] ${event.data.username}`;
    }

    case "system_event":
      return `[系统] ${event.data.message || event.data.eventType}`;

    case "emotion_event": {
      const trigger = event.data.trigger ? ` (触发: ${event.data.trigger})` : "";
      return `[情绪变化] ${event.data.emotion}${trigger}`;
    }

    case "simple_text":
      return event.data.text;

    default:
      return null;
  }
}

/**
 * Get context description for an event to include in the prompt
 *
 * Generates detailed context strings for each event type, optimized
 * for inclusion in LLM prompts to provide rich contextual information.
 *
 * @param event - The event to generate context for
 * @returns Formatted context string
 */
export function getEventContext(event: LiveEvent): string {
  switch (event.type) {
    case "user_chat": {
      const userPrefix = event.data.username
        ? `${event.data.username}: `
        : "用户: ";
      return `${userPrefix}${event.data.message}`;
    }

    case "bullet_chat": {
      const bulletPrefix = event.data.username
        ? `[弹幕] ${event.data.username}: `
        : "[弹幕] ";
      return `${bulletPrefix}${event.data.message}`;
    }

    case "program_event":
      return buildProgramContext(event);

    case "gift_event":
      return buildGiftContext(event);

    case "user_interaction":
      return buildInteractionContext(event);

    case "system_event": {
      const severityText = event.data.severity !== "info" ? ` (${event.data.severity})` : "";
      return `[系统事件: ${event.data.eventType}] ${event.data.message || ""}${severityText}`;
    }

    case "emotion_event":
      return buildEmotionContext(event);

    case "simple_text":
      return event.data.text;

    default:
      return JSON.stringify(event);
  }
}

// ==================== Event Context Builders ====================
// Helper functions for building detailed context strings for complex events

/**
 * Build detailed context for program transition events
 */
function buildProgramContext(event: Extract<LiveEvent, { type: "program_event" }>): string {
  const actionText = {
    start: "开始",
    finish: "结束",
    pause: "暂停",
    resume: "恢复",
  }[event.data.action];

  let context = `[节目${actionText}] ${event.data.programName}`;

  if (event.data.programType) {
    const typeText = {
      singing: "唱歌",
      chatting: "聊天",
      gaming: "游戏",
      drawing: "绘画",
      other: "其他",
    }[event.data.programType];
    context += ` (类型: ${typeText})`;
  }

  if (event.data.duration && event.data.action === "finish") {
    const minutes = Math.floor(event.data.duration / 60);
    const seconds = event.data.duration % 60;
    context += ` (时长: ${minutes > 0 ? `${minutes}分` : ""}${seconds}秒)`;
  }

  return context;
}

/**
 * Build detailed context for gift/donation events
 */
function buildGiftContext(event: Extract<LiveEvent, { type: "gift_event" }>): string {
  let context = `[收到礼物] ${event.data.username} 送出了 ${event.data.giftCount}x ${event.data.giftName}`;

  if (event.data.giftValue) {
    context += ` (价值: ${event.data.giftValue})`;
  }

  if (event.data.message) {
    context += `\n留言: ${event.data.message}`;
  }

  return context;
}

/**
 * Build detailed context for user interaction events (follow, subscribe, etc.)
 */
function buildInteractionContext(
  event: Extract<LiveEvent, { type: "user_interaction" }>,
): string {
  const actionText = {
    follow: "关注了你",
    subscribe: "订阅了你",
    like: "点赞了",
    share: "分享了",
  }[event.data.action];

  let context = `[用户互动] ${event.data.username} ${actionText}`;

  if (event.data.action === "subscribe") {
    if (event.data.tier) {
      context += ` (等级: ${event.data.tier})`;
    }
    if (event.data.months) {
      context += ` (已订阅 ${event.data.months} 个月)`;
    }
  }

  return context;
}

/**
 * Build detailed context for emotion/mood events
 */
function buildEmotionContext(event: Extract<LiveEvent, { type: "emotion_event" }>): string {
  let context = `[情绪] ${event.data.emotion}`;

  if (event.data.intensity !== undefined) {
    context += ` (强度: ${Math.round(event.data.intensity * 100)}%)`;
  }

  if (event.data.trigger) {
    context += `\n触发原因: ${event.data.trigger}`;
  }

  return context;
}

/**
 * Event-specific prompt builders
 * Each event type has its own dedicated builder for customized prompts
 */

import type { LiveEvent } from "../events.ts";
import type { EventPromptResult } from "./types.ts";

// Export types
export type { EventPromptResult, EventPromptBuilder } from "./types.ts";

// Import all event builders
import { buildUserChatPrompt } from "./user-chat.ts";
import { buildBulletChatPrompt } from "./bullet-chat.ts";
import { buildProgramEventPrompt } from "./program-event.ts";
import { buildGiftEventPrompt } from "./gift-event.ts";
import { buildUserInteractionPrompt } from "./user-interaction.ts";
import { buildSystemEventPrompt } from "./system-event.ts";
import { buildEmotionEventPrompt } from "./emotion-event.ts";
import { buildSimpleTextPrompt } from "./simple-text.ts";

// Export individual builders
export { buildUserChatPrompt } from "./user-chat.ts";
export { buildBulletChatPrompt } from "./bullet-chat.ts";
export { buildProgramEventPrompt } from "./program-event.ts";
export { buildGiftEventPrompt } from "./gift-event.ts";
export { buildUserInteractionPrompt } from "./user-interaction.ts";
export { buildSystemEventPrompt } from "./system-event.ts";
export { buildEmotionEventPrompt } from "./emotion-event.ts";
export { buildSimpleTextPrompt } from "./simple-text.ts";

/**
 * Main dispatcher - routes to event-specific prompt builder
 * This is the primary entry point for building event-specific prompts
 */
export async function buildEventSpecificPrompt(
  event: LiveEvent,
): Promise<EventPromptResult> {
  switch (event.type) {
    case "user_chat":
      return buildUserChatPrompt(event);
    case "bullet_chat":
      return buildBulletChatPrompt(event);
    case "program_event":
      return buildProgramEventPrompt(event);
    case "gift_event":
      return buildGiftEventPrompt(event);
    case "user_interaction":
      return buildUserInteractionPrompt(event);
    case "system_event":
      return buildSystemEventPrompt(event);
    case "emotion_event":
      return buildEmotionEventPrompt(event);
    case "simple_text":
      return buildSimpleTextPrompt(event);
    default:
      // TypeScript should ensure we never get here
      // const _exhaustive: never = event;
      throw new Error(`Unknown event type: ${JSON.stringify(event)}`);
  }
}
// @ts-nocheck

import type { LiveEvent } from "../events.ts";

/**
 * Result from an event-specific prompt builder
 */
export interface EventPromptResult {
  sections: string[];
  searchText: string | null; // Text to use for memory search
  requiresMemory: boolean; // Whether this event needs memory context
}

/**
 * Event prompt builder function signature
 */
export type EventPromptBuilder<T extends LiveEvent = LiveEvent> = (
  event: T,
) => Promise<EventPromptResult>;
// @ts-nocheck

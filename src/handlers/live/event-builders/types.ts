import type { LiveEvent } from "../events.ts";

export type LiveHandlerConfig = Record<string, unknown>;

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
  config?: LiveHandlerConfig,
) => Promise<EventPromptResult>;

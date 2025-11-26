import type { LiveEvent } from "../events.ts";
import type { EventPromptResult, LiveHandlerConfig } from "./types.ts";

/**
 * Build prompt for simple_text (legacy support)
 * Fallback to simple text handling
 */
export async function buildSimpleTextPrompt(
  event: Extract<LiveEvent, { type: "simple_text" }>,
  _config?: LiveHandlerConfig,
): Promise<EventPromptResult> {
  const sections: string[] = [];

  sections.push(`## 当前请求`);
  sections.push(event.data.text);

  return {
    sections,
    searchText: event.data.text,
    requiresMemory: true,
  };
}

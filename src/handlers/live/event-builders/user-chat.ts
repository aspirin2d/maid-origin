import type { LiveEvent } from "../events.ts";
import type { EventPromptResult, LiveHandlerConfig } from "./types.ts";

/**
 * Build prompt for user_chat events
 * Regular conversation - needs full context
 */
export async function buildUserChatPrompt(
  event: Extract<LiveEvent, { type: "user_chat" }>,
  _config?: LiveHandlerConfig,
): Promise<EventPromptResult> {
  const sections: string[] = [];
  const userPrefix = event.data.username ? `${event.data.username}` : "用户";

  sections.push(`## 当前对话`);
  sections.push(`${userPrefix}: ${event.data.message}`);

  return {
    sections,
    searchText: event.data.message,
    requiresMemory: true,
  };
}

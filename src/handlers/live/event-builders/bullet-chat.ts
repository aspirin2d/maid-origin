import type { LiveEvent } from "../events.ts";
import type { EventPromptResult } from "./types.ts";

/**
 * Build prompt for bullet_chat events
 * Quick reactions - less context needed
 */
export async function buildBulletChatPrompt(
  event: Extract<LiveEvent, { type: "bullet_chat" }>,
): Promise<EventPromptResult> {
  const sections: string[] = [];
  const userPrefix = event.data.username ? `${event.data.username}` : "观众";

  sections.push(`## 弹幕互动`);
  sections.push(`${userPrefix} 发送弹幕: ${event.data.message}`);

  if (event.data.position) {
    const positionText = {
      top: "顶部",
      bottom: "底部",
      scroll: "滚动",
    }[event.data.position];
    sections.push(`位置: ${positionText}`);
  }

  sections.push("");
  sections.push(
    "提示: 弹幕通常需要简短、活泼的回应。可以选择性回复，不必每条都详细回应。",
  );

  return {
    sections,
    searchText: event.data.message,
    requiresMemory: false, // Bullet chats don't need deep memory search
  };
}
// @ts-nocheck

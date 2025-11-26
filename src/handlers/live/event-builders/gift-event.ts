import type { LiveEvent } from "../events.ts";
import type { EventPromptResult, LiveHandlerConfig } from "./types.ts";

/**
 * Build prompt for gift_event
 * Gift received - needs gratitude and excitement
 */
export async function buildGiftEventPrompt(
  event: Extract<LiveEvent, { type: "gift_event" }>,
  _config?: LiveHandlerConfig,
): Promise<EventPromptResult> {
  const sections: string[] = [];

  sections.push(`## 收到礼物`);
  sections.push(`送礼者: ${event.data.username}`);
  sections.push(`礼物名称: ${event.data.giftName}`);
  sections.push(`数量: ${event.data.giftCount}个`);

  if (event.data.giftValue) {
    sections.push(`价值: ${event.data.giftValue}`);
  }

  if (event.data.message) {
    sections.push(`附言: ${event.data.message}`);
  }

  sections.push("");
  sections.push(
    `提示: 表达真诚的感谢和惊喜。礼物价值越高，反应应该更激动。如果有附言，记得回应附言内容。`,
  );

  return {
    sections,
    searchText: event.data.message || null, // Search on message if exists
    requiresMemory: true, // Check if this user has sent gifts before
  };
}

import type { LiveEvent } from "../events.ts";
import type { EventPromptResult } from "./types.ts";

/**
 * Build prompt for emotion_event
 * Emotion state changes - needs expression
 */
export async function buildEmotionEventPrompt(
  event: Extract<LiveEvent, { type: "emotion_event" }>,
): Promise<EventPromptResult> {
  const sections: string[] = [];

  sections.push(`## 情绪状态变化`);
  sections.push(`情绪: ${event.data.emotion}`);

  if (event.data.intensity !== undefined) {
    const intensityPercent = Math.round(event.data.intensity * 100);
    sections.push(`强度: ${intensityPercent}%`);
  }

  if (event.data.trigger) {
    sections.push(`触发原因: ${event.data.trigger}`);
  }

  if (event.data.duration) {
    sections.push(`预期持续: ${event.data.duration}秒`);
  }

  sections.push("");
  sections.push(
    `提示: 自然地表达这种情绪状态。通过语言、动作和表情展现${event.data.emotion}的感觉。`,
  );

  if (event.data.trigger) {
    sections.push(`确保回应中提到或暗示触发原因。`);
  }

  return {
    sections,
    searchText: event.data.trigger || null,
    requiresMemory: false,
  };
}
// @ts-nocheck

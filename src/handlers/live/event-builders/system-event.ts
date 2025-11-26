import type { LiveEvent } from "../events.ts";
import type { EventPromptResult } from "./types.ts";

/**
 * Build prompt for system_event
 * System notifications - informational
 */
export async function buildSystemEventPrompt(
  event: Extract<LiveEvent, { type: "system_event" }>,
): Promise<EventPromptResult> {
  const sections: string[] = [];

  sections.push(`## 系统事件`);
  sections.push(`事件类型: ${event.data.eventType}`);

  if (event.data.message) {
    sections.push(`消息: ${event.data.message}`);
  }

  const severityText = {
    info: "信息",
    warning: "警告",
    error: "错误",
  }[event.data.severity];
  sections.push(`严重程度: ${severityText}`);

  sections.push("");

  if (event.data.severity === "error") {
    sections.push(
      `提示: 这是一个错误事件。应该向观众说明情况，表示会尽快解决，保持冷静和专业。`,
    );
  } else if (event.data.severity === "warning") {
    sections.push(
      `提示: 这是一个警告。简要说明情况，告知观众正在注意这个问题。`,
    );
  } else {
    sections.push(`提示: 这是一个普通通知。可以简单提及或不做特别反应。`);
  }

  return {
    sections,
    searchText: null,
    requiresMemory: false,
  };
}
// @ts-nocheck

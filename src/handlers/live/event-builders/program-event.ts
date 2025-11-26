import type { LiveEvent } from "../events.ts";
import type { EventPromptResult, LiveHandlerConfig } from "./types.ts";

/**
 * Build prompt for program_event
 * Program transitions - needs announcement style
 */
export async function buildProgramEventPrompt(
  event: Extract<LiveEvent, { type: "program_event" }>,
  _config?: LiveHandlerConfig,
): Promise<EventPromptResult> {
  const sections: string[] = [];

  sections.push(`## 节目状态变化`);

  const actionText = {
    start: "开始",
    finish: "结束",
    pause: "暂停",
    resume: "恢复",
  }[event.data.action];

  sections.push(`动作: ${actionText}`);
  sections.push(`节目名称: ${event.data.programName}`);

  if (event.data.programType) {
    const typeText = {
      singing: "唱歌",
      chatting: "聊天",
      gaming: "游戏",
      drawing: "绘画",
      other: "其他",
    }[event.data.programType];
    sections.push(`节目类型: ${typeText}`);
  }

  if (event.data.duration && event.data.action === "finish") {
    const hours = Math.floor(event.data.duration / 3600);
    const minutes = Math.floor((event.data.duration % 3600) / 60);
    const seconds = event.data.duration % 60;
    const timeStr = [
      hours > 0 ? `${hours}小时` : "",
      minutes > 0 ? `${minutes}分` : "",
      seconds > 0 ? `${seconds}秒` : "",
    ]
      .filter(Boolean)
      .join("");
    sections.push(`持续时长: ${timeStr}`);
  }

  sections.push("");

  // Add context hints based on action
  if (event.data.action === "start") {
    sections.push(
      `提示: 这是节目开始。应该表现出兴奋和期待，向观众介绍接下来要做什么。`,
    );
  } else if (event.data.action === "finish") {
    sections.push(
      `提示: 这是节目结束。应该感谢观众的陪伴，总结一下刚才的内容，表达对这段时间的感受。`,
    );
  } else if (event.data.action === "pause") {
    sections.push(`提示: 节目暂停。告知观众稍作休息，很快回来。`);
  } else if (event.data.action === "resume") {
    sections.push(`提示: 节目恢复。欢迎观众回来，继续之前的内容。`);
  }

  return {
    sections,
    searchText: null, // Program events don't need memory search
    requiresMemory: false,
  };
}

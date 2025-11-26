import type { LiveEvent } from "../events.ts";
import type { EventPromptResult } from "./types.ts";

/**
 * Build prompt for user_interaction events
 * Follow/subscribe/like - needs welcoming response
 */
export async function buildUserInteractionPrompt(
  event: Extract<LiveEvent, { type: "user_interaction" }>,
): Promise<EventPromptResult> {
  const sections: string[] = [];

  sections.push(`## 用户互动`);

  const actionText = {
    follow: "关注了你",
    subscribe: "订阅了你",
    like: "点赞了",
    share: "分享了直播",
  }[event.data.action];

  sections.push(`${event.data.username} ${actionText}`);

  if (event.data.action === "subscribe") {
    if (event.data.tier) {
      sections.push(`订阅等级: ${event.data.tier}`);
    }
    if (event.data.months) {
      sections.push(`已连续订阅: ${event.data.months}个月`);
    }
  }

  sections.push("");

  // Add context hints based on action
  if (event.data.action === "follow") {
    sections.push(`提示: 欢迎新的关注者，表达感谢和期待未来的互动。`);
  } else if (event.data.action === "subscribe") {
    if (event.data.months && event.data.months > 1) {
      sections.push(
        `提示: 这是一位忠实粉丝！特别感谢他们的长期支持，表达对老粉的感激。`,
      );
    } else {
      sections.push(`提示: 欢迎新订阅者，表达感谢并让他们感到受欢迎。`);
    }
  } else if (event.data.action === "like") {
    sections.push(`提示: 简短感谢点赞，表达开心。`);
  } else if (event.data.action === "share") {
    sections.push(`提示: 特别感谢分享，这帮助更多人发现直播。`);
  }

  return {
    sections,
    searchText: null,
    requiresMemory: true, // Check if this user has interacted before
  };
}
// @ts-nocheck

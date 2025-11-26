import dayJsModule from "dayjs";
import relativeTimeModule from "dayjs/plugin/relativeTime.js";
import "dayjs/locale/zh-cn.js";

// Enable relative time plugin and set locale to Chinese
const dayjs = dayJsModule;
const relativeTime = relativeTimeModule;
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/**
 * Get time of day description in Chinese
 */
function getTimeOfDay(time: any): string {
  const hour = time.hour();
  if (hour >= 5 && hour < 8) return "清晨";
  if (hour >= 8 && hour < 12) return "上午";
  if (hour >= 12 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 22) return "晚上";
  return "深夜";
}

/**
 * Build the current time context section
 */
export function buildTimeContext(): string {
  const now = dayjs();
  return `## 当前时间信息

- 当前时间：${now.format("YYYY年MM月DD日 HH:mm:ss")}
- 星期：${now.format("dddd")}
- 时段：${getTimeOfDay(now)}
`;
}

// Re-export dayjs for use in other modules
export { dayjs };

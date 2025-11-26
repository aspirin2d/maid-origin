/**
 * IM Handler Schedule Management - Busy Mode & Activity Detection
 *
 * 根据当前时间和日程表，判断 Ria 是否在忙碌状态
 * 以及当前在进行什么活动
 */

import { SCHEDULE } from "./config.ts";
import type { ScheduleItem } from "./types.ts";
import { getBusyOverride } from "./state.ts";

export const BUSY_REASONS = Array.from(
  new Set(
    SCHEDULE.filter(
      (item) => item.isBusy && typeof item.busyReason === "string",
    ).map((item) => item.busyReason as string),
  ),
);

export function isValidBusyReason(reason: string): boolean {
  return BUSY_REASONS.includes(reason);
}

// ============================================================================
// 日期与时间工具
// ============================================================================

/**
 * 将时间戳转换为 HH:MM 格式
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * 从时间戳中提取小时和分钟
 */
function extractHourMinute(timestamp: number): {
  hour: number;
  minute: number;
} {
  const date = new Date(timestamp);
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/**
 * 获取当前日期的星期几（0=周日，1=周一...6=周六）
 */
function getDayOfWeek(timestamp: number): number {
  return new Date(timestamp).getDay();
}

/**
 * 检查时间是否在指定范围内
 * 支持跨越午夜的时间段（如 23:00 - 08:00）
 */
function isTimeInRange(
  hour: number,
  minute: number,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): boolean {
  const currentTotalMinutes = hour * 60 + minute;
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + endMinute;

  if (startTotalMinutes <= endTotalMinutes) {
    // 正常时间段（不跨午夜）
    return (
      currentTotalMinutes >= startTotalMinutes &&
      currentTotalMinutes < endTotalMinutes
    );
  } else {
    // 跨越午夜的时间段
    return (
      currentTotalMinutes >= startTotalMinutes ||
      currentTotalMinutes < endTotalMinutes
    );
  }
}

// ============================================================================
// 日程查询
// ============================================================================

/**
 * 根据当前时间查找匹配的日程项
 * @param timestamp Unix timestamp（毫秒）
 * @returns 匹配的日程项，如果没有匹配则返回 undefined
 */
export function findCurrentScheduleItem(
  timestamp: number,
): ScheduleItem | undefined {
  const { hour, minute } = extractHourMinute(timestamp);
  const dayOfWeek = getDayOfWeek(timestamp);

  for (const item of SCHEDULE) {
    // 检查星期是否匹配
    if (
      item.daysOfWeek &&
      item.daysOfWeek.length > 0 &&
      !item.daysOfWeek.includes(dayOfWeek)
    ) {
      continue;
    }

    // 检查时间是否在范围内
    if (
      isTimeInRange(
        hour,
        minute,
        item.startHour,
        item.startMinute,
        item.endHour,
        item.endMinute,
      )
    ) {
      return item;
    }
  }

  return undefined;
}

/**
 * 获取 Ria 当前的活动
 * @param timestamp Unix timestamp（毫秒）
 * @returns 活动名称
 */
export function getCurrentActivity(timestamp: number): string {
  const item = findCurrentScheduleItem(timestamp);
  return item?.name ?? "离线中";
}

/**
 * 判断 Ria 当前是否在忙碌状态
 * @param timestamp Unix timestamp（毫秒）
 * @returns { isBusy: boolean, reason?: string, until?: number }
 */
export function isBroadcasterBusy(timestamp: number): {
  isBusy: boolean;
  reason?: string;
  until?: number;
} {
  const override = getBusyOverride();
  if (override.mode === "forced_busy") {
    return { isBusy: true, reason: override.reason };
  }

  if (override.mode === "forced_available") {
    return { isBusy: false };
  }

  const item = findCurrentScheduleItem(timestamp);

  if (!item) {
    return { isBusy: false };
  }

  if (!item.isBusy) {
    return { isBusy: false };
  }

  // 计算忙碌截止时间
  const date = new Date(timestamp);
  const busyUntilDate = new Date(date);
  busyUntilDate.setHours(item.endHour, item.endMinute, 0, 0);

  // 如果结束时间小于开始时间，说明跨越了午夜
  if (
    item.endHour * 60 + item.endMinute <
    item.startHour * 60 + item.startMinute
  ) {
    busyUntilDate.setDate(busyUntilDate.getDate() + 1);
  }

  return {
    isBusy: true,
    ...(item.busyReason ? { reason: item.busyReason } : {}),
    until: busyUntilDate.getTime(),
  };
}

/**
 * 获取下一个日程项
 * @param timestamp Unix timestamp（毫秒）
 * @returns 下一个日程项及其开始时间
 */
export function getNextScheduleItem(timestamp: number): {
  item: ScheduleItem;
  startsAt: number;
} | null {
  const { hour, minute } = extractHourMinute(timestamp);
  const dayOfWeek = getDayOfWeek(timestamp);

  // 首先查找今天的后续项
  for (const item of SCHEDULE) {
    if (
      item.daysOfWeek &&
      item.daysOfWeek.length > 0 &&
      !item.daysOfWeek.includes(dayOfWeek)
    ) {
      continue;
    }

    const itemStartMinutes = item.startHour * 60 + item.startMinute;
    const currentMinutes = hour * 60 + minute;

    if (itemStartMinutes > currentMinutes) {
      const date = new Date(timestamp);
      date.setHours(item.startHour, item.startMinute, 0, 0);
      return { item, startsAt: date.getTime() };
    }
  }

  // 如果没有找到，查找明天的第一项
  const nextDate = new Date(timestamp);
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(0, 0, 0, 0);

  const nextDayOfWeek = getDayOfWeek(nextDate.getTime());

  for (const item of SCHEDULE) {
    if (
      item.daysOfWeek &&
      item.daysOfWeek.length > 0 &&
      !item.daysOfWeek.includes(nextDayOfWeek)
    ) {
      continue;
    }

    const date = new Date(nextDate);
    date.setHours(item.startHour, item.startMinute, 0, 0);
    return { item, startsAt: date.getTime() };
  }

  return null;
}

/**
 * 获取今天剩余的直播时间段
 * 用于自动回复时告诉用户什么时候会直播
 * @param timestamp Unix timestamp（毫秒）
 * @returns { hasLiveToday: boolean, startTime?: string, endTime?: string }
 */
export function getTodayLiveStream(timestamp: number): {
  hasLiveToday: boolean;
  startTime?: string;
  endTime?: string;
} {
  const { hour, minute } = extractHourMinute(timestamp);
  const dayOfWeek = getDayOfWeek(timestamp);
  const currentMinutes = hour * 60 + minute;

  for (const item of SCHEDULE) {
    if (
      item.daysOfWeek &&
      item.daysOfWeek.length > 0 &&
      !item.daysOfWeek.includes(dayOfWeek)
    ) {
      continue;
    }

    // 查找 busyReason 为 "streaming" 的项
    if (item.busyReason !== "streaming") {
      continue;
    }

    const itemStartMinutes = item.startHour * 60 + item.startMinute;
    const itemEndMinutes = item.endHour * 60 + item.endMinute;

    // 只返回还没开始或正在进行的直播
    if (itemStartMinutes >= currentMinutes || itemEndMinutes > currentMinutes) {
      const startStr = `${String(item.startHour).padStart(2, "0")}:${String(item.startMinute).padStart(2, "0")}`;
      const endStr = `${String(item.endHour).padStart(2, "0")}:${String(item.endMinute).padStart(2, "0")}`;
      return {
        hasLiveToday: true,
        startTime: startStr,
        endTime: endStr,
      };
    }
  }

  return { hasLiveToday: false };
}

// ============================================================================
// 上下文生成（用于 prompt）
// ============================================================================

/**
 * 生成日程相关的上下文信息
 * 用于注入到 LLM prompt 中
 */
export function generateScheduleContext(timestamp: number): string {
  const currentActivity = getCurrentActivity(timestamp);
  const busyStatus = isBroadcasterBusy(timestamp);
  const override = getBusyOverride();
  const nextSchedule = getNextScheduleItem(timestamp);
  const liveToday = getTodayLiveStream(timestamp);

  let context = `【当前日程信息】\n`;
  context += `- 当前活动：${currentActivity}\n`;
  context += `- 忙碌状态：${busyStatus.isBusy ? "是" : "否"}`;

  if (busyStatus.isBusy && busyStatus.reason) {
    context += `（原因：${busyStatus.reason}）`;
  }
  context += `\n`;

  if (override.mode === "forced_busy") {
    context += `- 忙碌覆盖：手动忙碌（原因：${override.reason}）\n`;
  } else if (override.mode === "forced_available") {
    context += `- 忙碌覆盖：手动可用（忽略日程忙碌）\n`;
  }

  if (nextSchedule) {
    const nextTime = new Date(nextSchedule.startsAt);
    const nextTimeStr = `${String(nextTime.getHours()).padStart(2, "0")}:${String(nextTime.getMinutes()).padStart(2, "0")}`;
    context += `- 下一项活动：${nextSchedule.item.name}（${nextTimeStr}）\n`;
  }

  if (liveToday.hasLiveToday) {
    context += `- 今日直播：${liveToday.startTime} ~ ${liveToday.endTime}\n`;
  }

  return context;
}

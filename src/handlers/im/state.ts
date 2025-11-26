/**
 * IM Handler State Management - User Block State & Persistence
 *
 * 管理用户拉黑状态、好感度等动态数据
 * 在生产环境中，这些数据应该存储在数据库中
 *
 * 注：当前实现使用内存存储，重启后会丢失。生产环境应改为数据库存储。
 */

import type { UserBlockRecord } from "./types.ts";
import { DEFAULT_BLOCK_DURATION_MINUTES } from "./config.ts";

// ============================================================================
// 内存存储（开发/测试用）
// ============================================================================

/**
 * 用户拉黑记录
 * 生产环境应存储在数据库
 */
const blockRecords = new Map<string, UserBlockRecord>();

// ============================================================================
// 主播忙碌状态覆盖（开发/调试用）
// ============================================================================

export type BusyOverrideState =
  | { mode: "auto" }
  | { mode: "forced_busy"; reason: string; setAt: number }
  | { mode: "forced_available"; setAt: number };

let busyOverride: BusyOverrideState = { mode: "auto" };

// ============================================================================
// 拉黑状态查询与管理
// ============================================================================

/**
 * 检查用户是否被拉黑
 * @param userId 用户 ID
 * @returns { isBlocked: boolean, remainingMinutes: number }
 */
export function checkUserBlockStatus(userId: string): {
  isBlocked: boolean;
  remainingMinutes: number;
} {
  const record = blockRecords.get(userId);

  if (!record) {
    return { isBlocked: false, remainingMinutes: 0 };
  }

  const now = Date.now();
  const blockedUntil =
    record.blockedAt + record.blockDurationMinutes * 60 * 1000;

  if (now >= blockedUntil) {
    // 拉黑已过期，移除记录
    blockRecords.delete(userId);
    return { isBlocked: false, remainingMinutes: 0 };
  }

  const remainingMs = blockedUntil - now;
  const remainingMinutes = Math.ceil(remainingMs / 60 / 1000);

  return { isBlocked: true, remainingMinutes };
}

/**
 * 拉黑用户
 * @param userId 用户 ID
 * @param durationMinutes 拉黑时长（分钟），默认为配置值
 * @param reason 拉黑原因（可选）
 */
export function blockUser(
  userId: string,
  durationMinutes: number = DEFAULT_BLOCK_DURATION_MINUTES,
  reason?: string,
): void {
  const record: UserBlockRecord = reason
    ? {
        userId,
        blockedAt: Date.now(),
        blockDurationMinutes: durationMinutes,
        reason,
      }
    : {
        userId,
        blockedAt: Date.now(),
        blockDurationMinutes: durationMinutes,
      };

  blockRecords.set(userId, record);

  console.log(
    `[IM] User ${userId} blocked for ${durationMinutes} minutes${reason ? ` (reason: ${reason})` : ""}`,
  );
}

/**
 * 解除用户拉黑
 * @param userId 用户 ID
 */
export function unblockUser(userId: string): void {
  blockRecords.delete(userId);
  console.log(`[IM] User ${userId} unblocked`);
}

/**
 * 获取用户的拉黑记录
 * @param userId 用户 ID
 */
export function getBlockRecord(userId: string): UserBlockRecord | undefined {
  return blockRecords.get(userId);
}

/**
 * 获取所有被拉黑的用户
 */
export function getAllBlockedUsers(): UserBlockRecord[] {
  return Array.from(blockRecords.values());
}

/**
 * 清除所有过期的拉黑记录
 * 可以定期调用此函数进行清理
 */
export function cleanupExpiredBlocks(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [userId, record] of blockRecords.entries()) {
    const blockedUntil =
      record.blockedAt + record.blockDurationMinutes * 60 * 1000;
    if (now >= blockedUntil) {
      blockRecords.delete(userId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[IM] Cleaned up ${cleaned} expired block records`);
  }

  return cleaned;
}

// ============================================================================
// 忙碌覆盖管理
// ============================================================================

export function forceBusyMode(reason: string) {
  busyOverride = { mode: "forced_busy", reason, setAt: Date.now() };
  console.log(`[IM] Busy override: forced busy (${reason})`);
}

export function forceAvailableMode() {
  busyOverride = { mode: "forced_available", setAt: Date.now() };
  console.log("[IM] Busy override: forced available (ignore schedule)");
}

export function clearBusyOverride() {
  busyOverride = { mode: "auto" };
  console.log("[IM] Busy override cleared (follow schedule)");
}

export function getBusyOverride(): BusyOverrideState {
  return busyOverride;
}

// ============================================================================
// 好感度管理（预留接口）
// ============================================================================

/**
 * 更新用户好感度
 *
 * 注：生产环境中，这应该调用服务器 API 来持久化数据
 * @param userId 用户 ID
 * @param delta 好感度变化量（-100 ~ 100）
 */
export async function updateUserAffection(
  userId: string,
  delta: number,
): Promise<{ success: boolean; newAffection?: number }> {
  // 预留 API 接口
  console.log(`[IM] Updating affection for user ${userId}: delta=${delta}`);

  try {
    // TODO: 调用服务器 API
    // const response = await fetch(`${API_BASE}/users/${userId}/affection`, {
    //   method: "PATCH",
    //   body: JSON.stringify({ delta }),
    // });
    // return response.json();

    // 临时返回成功
    return { success: true, newAffection: 50 + delta };
  } catch (error) {
    console.error("[IM] Failed to update affection:", error);
    return { success: false };
  }
}

// ============================================================================
// 主播状态管理（预留接口）
// ============================================================================

/**
 * 更新主播体力值
 *
 * 注：生产环境中应调用服务器 API
 * @param delta 体力变化量
 */
export async function updateBroadcasterEnergy(delta: number): Promise<void> {
  console.log(`[IM] Updating broadcaster energy: delta=${delta}`);

  // TODO: 调用服务器 API 更新体力
  // await fetch(`${API_BASE}/broadcaster/energy`, {
  //   method: "PATCH",
  //   body: JSON.stringify({ delta }),
  // });
}

/**
 * 更新主播心情值
 *
 * 注：生产环境中应调用服务器 API
 * @param mood 新心情
 * @param value 心情值（0-100）
 */
export async function updateBroadcasterMood(
  mood: string,
  value: number,
): Promise<void> {
  console.log(`[IM] Updating broadcaster mood: ${mood} (${value})`);

  // TODO: 调用服务器 API 更新心情
  // await fetch(`${API_BASE}/broadcaster/mood`, {
  //   method: "PATCH",
  //   body: JSON.stringify({ mood, value }),
  // });
}

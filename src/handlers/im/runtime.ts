/**
 * IM Handler Runtime - Dynamic Data Fetching
 *
 * 在运行时获取动态数据：
 * - 用户数据（好感度、是否被拉黑等）
 * - 主播状态（体力、心情等）
 * - 网络时间（用于日程判断）
 * - 聊天记录（上下文）
 */

import type {
  UserDataResponse,
  ChatHistoryResponse,
  BroadcasterStatusResponse,
} from "./types.ts";
import { checkUserBlockStatus } from "./state.ts";
import { isBroadcasterBusy, generateScheduleContext } from "./schedule.ts";

// ============================================================================
// API 端点配置（预留接口）
// ============================================================================

/**
 * 这些是预留的 API 端点配置
 * 实际实现时，根据后端接口设计进行调整
 *
 * 可能的实现方式：
 * 1. HTTP 请求（fetch）
 * 2. WebSocket 长链接
 * 3. gRPC
 * 4. 直接数据库查询（如果在同一服务）
 */

const API_CONFIG = {
  // TODO: 根据实际后端配置调整这些 URL
  getUserDataUrl: (userId: string) =>
    `http://localhost:3001/api/users/${userId}`,
  getChatHistoryUrl: (userId: string) =>
    `http://localhost:3001/api/chat-history/${userId}`,
  getBroadcasterStatusUrl: () => `http://localhost:3001/api/broadcaster/status`,
  createTaskUrl: () => `http://localhost:3001/api/tasks`,
};

// ============================================================================
// 用户数据获取
// ============================================================================

/**
 * 从服务器获取用户数据
 *
 * 预留接口：需要实现以下 API：
 * GET /api/users/:userId
 * 返回：{ userId, nickname, affectionLevel, isBlocked, blockedUntil, ... }
 */
export async function fetchUserData(userId: string): Promise<UserDataResponse> {
  console.log(`[IM Runtime] Fetching user data for ${userId}`);

  try {
    // TODO: 实现实际的 API 请求
    // const response = await fetch(API_CONFIG.getUserDataUrl(userId));
    // if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // return response.json();

    // 临时返回默认数据
    return {
      userId,
      nickname: `用户${userId.slice(-4)}`,
      affectionLevel: 50,
      isBlocked: false,
      firstInteractionTime: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 天前
      totalInteractions: 15,
    };
  } catch (error) {
    console.error(`[IM Runtime] Failed to fetch user data:`, error);
    // 返回默认数据作为降级方案
    return {
      userId,
      nickname: `用户${userId.slice(-4)}`,
      affectionLevel: 50,
      isBlocked: false,
    };
  }
}

// ============================================================================
// 聊天历史获取
// ============================================================================

/**
 * 从服务器获取聊天历史
 *
 * 预留接口：需要实现以下 API：
 * GET /api/chat-history/:userId?limit=10
 * 返回：{ messages: [...], totalCount: number }
 */
export async function fetchChatHistory(
  userId: string,
  limit: number = 10,
): Promise<ChatHistoryResponse> {
  console.log(
    `[IM Runtime] Fetching chat history for ${userId} (limit: ${limit})`,
  );

  try {
    // TODO: 实现实际的 API 请求
    // const response = await fetch(
    //   `${API_CONFIG.getChatHistoryUrl(userId)}?limit=${limit}`
    // );
    // if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // return response.json();

    // 临时返回空历史
    return {
      messages: [],
      totalCount: 0,
    };
  } catch (error) {
    console.error(`[IM Runtime] Failed to fetch chat history:`, error);
    return {
      messages: [],
      totalCount: 0,
    };
  }
}

// ============================================================================
// 主播状态获取
// ============================================================================

/**
 * 从服务器获取主播状态
 *
 * 预留接口：需要实现以下 API：
 * GET /api/broadcaster/status
 * 返回：{ energy, mood, moodValue, currentActivity, isLive, ... }
 */
export async function fetchBroadcasterStatus(): Promise<BroadcasterStatusResponse> {
  console.log(`[IM Runtime] Fetching broadcaster status`);

  try {
    // TODO: 实现实际的 API 请求
    // const response = await fetch(API_CONFIG.getBroadcasterStatusUrl());
    // if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // return response.json();

    // 临时返回默认状态
    return {
      energy: 75,
      mood: "happy",
      moodValue: 80,
      currentActivity: "离线中",
      isLive: false,
    };
  } catch (error) {
    console.error(`[IM Runtime] Failed to fetch broadcaster status:`, error);
    return {
      energy: 50,
      mood: "normal",
      moodValue: 50,
      currentActivity: "离线中",
      isLive: false,
    };
  }
}

// ============================================================================
// 综合上下文生成
// ============================================================================

/**
 * 为 LLM prompt 生成完整的运行时上下文
 * 包含用户信息、主播状态、日程、好感度等
 */
export async function generateRuntimeContext(userId: string): Promise<string> {
  const now = Date.now();

  // 并行获取所有数据
  const [userData, broadcasterStatus, chatHistory] = await Promise.all([
    fetchUserData(userId),
    fetchBroadcasterStatus(),
    fetchChatHistory(userId, 5),
  ]);

  // 检查用户是否被拉黑
  const blockStatus = checkUserBlockStatus(userId);

  // 获取日程信息
  const scheduleContext = generateScheduleContext(now);

  // 检查主播是否在忙碌
  const busyStatus = isBroadcasterBusy(now);

  // 构建完整的上下文
  let context = "";

  context += `【用户信息】\n`;
  context += `- 用户 ID：${userId}\n`;
  context += `- 昵称：${userData.nickname}\n`;
  context += `- 好感度：${userData.affectionLevel}/100\n`;

  if (userData.totalInteractions) {
    context += `- 互动次数：${userData.totalInteractions}\n`;
  }

  if (blockStatus.isBlocked) {
    context += `- 状态：已被拉黑（还要 ${blockStatus.remainingMinutes} 分钟才能解除）\n`;
  }

  context += `\n`;

  context += `【主播状态】\n`;
  context += `- 体力值：${broadcasterStatus.energy}/100\n`;
  context += `- 心情：${broadcasterStatus.mood} (${broadcasterStatus.moodValue}/100)\n`;
  context += `- 当前活动：${broadcasterStatus.currentActivity}\n`;

  if (broadcasterStatus.isLive) {
    context += `- 直播状态：正在直播中 🔴\n`;
  }

  context += `\n`;

  context += scheduleContext;

  if (chatHistory.messages && chatHistory.messages.length > 0) {
    context += `\n【最近聊天记录】\n`;
    for (const msg of chatHistory.messages.slice(-5)) {
      const role = msg.role === "user" ? "用户" : "Ria";
      const time = new Date(msg.timestamp).toLocaleTimeString("zh-CN");
      context += `- [${time}] ${role}：${msg.content}\n`;
    }
  }

  return context;
}

// ============================================================================
// 创建任务（主动发消息）
// ============================================================================

/**
 * 创建一个定时任务，让 Ria 在指定时间后主动给用户发消息
 *
 * 预留接口：需要实现以下 API：
 * POST /api/tasks
 * 请求体：{ taskType, targetUserId, content, delaySeconds, createdBy }
 * 返回：{ taskId, createdAt, ... }
 */
export async function createScheduledTask(
  taskType: "message" | "greeting" | "reminder",
  content: string,
  delaySeconds: number,
  targetUserId?: string,
): Promise<{ success: boolean; taskId?: string }> {
  console.log(
    `[IM Runtime] Creating task: type=${taskType}, delay=${delaySeconds}s, target=${targetUserId ?? "broadcast"}`,
  );

  try {
    // TODO: 实现实际的 API 请求
    // const response = await fetch(API_CONFIG.createTaskUrl(), {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     taskType,
    //     targetUserId,
    //     content,
    //     delaySeconds,
    //     createdBy: "ria",
    //   }),
    // });
    //
    // if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // const data = await response.json();
    // return { success: true, taskId: data.taskId };

    // 临时返回成功（实际应有真实 taskId）
    const fakeTaskId = `task_${Date.now()}`;
    return { success: true, taskId: fakeTaskId };
  } catch (error) {
    console.error(`[IM Runtime] Failed to create task:`, error);
    return { success: false };
  }
}

// ============================================================================
// 获取网络时间（可选，用于时间同步）
// ============================================================================

/**
 * 获取服务器时间
 * 用于确保客户端和服务器时间同步
 * 在本地测试时可以直接返回当前时间
 */
export async function getNetworkTime(): Promise<number> {
  // 在生产环境，可以调用服务器的时间同步接口
  // 目前直接返回本地时间
  return Date.now();
}

// ============================================================================
// 调试和监控
// ============================================================================

/**
 * 记录一条消息交互（用于分析和调试）
 */
export async function logInteraction(
  userId: string,
  userMessage: string,
  riaResponse: string,
): Promise<void> {
  console.log(`[IM Runtime] Interaction logged:`);
  console.log(`  User (${userId}): ${userMessage.slice(0, 50)}...`);
  console.log(`  Ria: ${riaResponse.slice(0, 50)}...`);

  // TODO: 发送日志到服务器用于分析
  // await fetch(`${API_CONFIG.getLogsUrl()}`, {
  //   method: "POST",
  //   body: JSON.stringify({
  //     userId,
  //     userMessage,
  //     riaResponse,
  //     timestamp: Date.now(),
  //   }),
  // });
}

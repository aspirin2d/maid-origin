/**
 * IM Handler Types - Ria Virtual Idol Chat System
 *
 * 类型定义集中在此，确保类型安全和代码可维护性
 */

// ============================================================================
// 输入类型
// ============================================================================

/**
 * IM Handler 接收的输入
 */
export type IMInput = TextChatInput | CommandInput;

/**
 * 纯文字聊天输入（用户端）
 */
export interface TextChatInput {
  type: "textchat";
  message: string;
  userId?: string; // 可选，如果来自 API 可能包含用户 ID
  timestamp?: number;
}

/**
 * 调试命令输入（后台使用）
 */
export interface CommandInput {
  type: "command";
  command: string; // e.g., "get_state", "set_busy", "set_mood", "block_user"
  args?: Record<string, any>;
}

// ============================================================================
// 输出类型
// ============================================================================

/**
 * IM Handler 的输出内容
 */
export type IMOutputContent =
  | TextChatOutput
  | ImageOutput
  | CreateTaskOutput
  | BusyModeOutput
  | BlockModeOutput;

/**
 * 纯文字回复
 */
export interface TextChatOutput {
  type: "textchat";
  text: string;
}

/**
 * 发送图片
 */
export interface ImageOutput {
  type: "image";
  url: string;
  caption?: string; // 图片说明
}

/**
 * 创建定时任务（主动给用户发消息）
 */
export interface CreateTaskOutput {
  type: "create_task";
  taskType: "message" | "greeting" | "reminder";
  delaySeconds: number; // 延迟多少秒后执行
  content: string; // 任务的具体内容
  userId?: string; // 目标用户，如果为空则广播
}

/**
 * 忙碌模式自动回复
 */
export interface BusyModeOutput {
  type: "busy_mode";
  text: string; // 自动回复文本（e.g. "我暂时不在喔，这是自动回复；直播时段xx～yy"）
}

/**
 * 拉黑模式回复
 */
export interface BlockModeOutput {
  type: "block_mode";
  text: string; // 自动回复文本
  remainingBlockMinutes: number; // 还要被拉黑多少分钟
}

// ============================================================================
// Handler 输出 Schema
// ============================================================================

/**
 * 最终返回给 LLM 的响应对象
 * LLM 会填充这些字段，Handler 据此生成相应的输出
 */
export interface IMHandlerOutput {
  responseType:
    | "textchat"
    | "image"
    | "task"
    | "busy"
    | "blocked"
    | "error";
  text?: string | null; // 文字内容（textchat、busy、blocked、error）
  imageKey?: string | null; // 图片键（来自配置中的图片库）
  taskType?: string | null; // 任务类型（task）
  taskDelaySeconds?: number | null; // 任务延迟（task）
  taskContent?: string | null; // 任务内容（task）
  emotion?: string | null; // 当前心情表达
  affectionChange?: number | null; // 好感度变化（-1 ~ 1）
  moodChange?: number | null; // 心情数值变化（-100 ~ 100）
  energyChange?: number | null; // 体力数值变化（-100 ~ 100）
}

// ============================================================================
// 主播状态
// ============================================================================

/**
 * 主播的实时动态数据
 */
export interface BroadcasterState {
  // 基础数据
  broadcasterId: string;
  broadcasterName: string;

  // 体力和心情
  energy: number; // 0-100
  mood: string; // e.g., "happy", "tired", "excited"
  moodValue: number; // 0-100

  // 用户关系
  affectionLevel: number; // 用户对主播的好感度 0-100
  affectionStage: string; // "陌生", "友好", "熟悉", "喜欢", "爱慕"

  // 时间相关
  currentTime: number; // Unix timestamp
  isInBusyMode: boolean;
  busyUntil?: number; // Unix timestamp，何时结束忙碌
  busyReason?: string; // 忙碌原因（e.g., "streaming", "offline", "sleeping"）
  liveStreamTimeStart?: number;
  liveStreamTimeEnd?: number;

  // 用户关系
  isUserBlocked: boolean;
  userBlockedUntil?: number; // Unix timestamp，何时解除拉黑
}

/**
 * 用户拉黑记录
 */
export interface UserBlockRecord {
  userId: string;
  blockedAt: number; // Unix timestamp
  blockDurationMinutes: number;
  reason?: string;
}

// ============================================================================
// 日程表
// ============================================================================

/**
 * 日程项目
 */
export interface ScheduleItem {
  name: string; // e.g., "直播", "休息", "录制", "健身"
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number;
  endMinute: number;
  isBusy: boolean; // 是否算作"忙碌"模式
  busyReason?: string; // 如果忙碌，原因是什么
  daysOfWeek?: number[]; // 0=周日，1=周一...，如果空则每天
}

// ============================================================================
// 配置
// ============================================================================

/**
 * 图片库项目
 */
export interface ImageItem {
  key: string; // 唯一标识符
  url: string; // 图片 URL
  name: string; // 图片名称，方便 LLM 理解（e.g., "dance_pose_1", "wink", "tired_face"）
  description?: string; // 图片描述
}

// ============================================================================
// API 请求/响应（预留接口）
// ============================================================================

/**
 * 从服务器获取用户数据的响应
 */
export interface UserDataResponse {
  userId: string;
  nickname: string;
  affectionLevel: number;
  isBlocked: boolean;
  blockedUntil?: number;
  firstInteractionTime?: number;
  totalInteractions?: number;
}

/**
 * 从服务器获取聊天记录的响应
 */
export interface ChatHistoryResponse {
  messages: Array<{
    role: "user" | "broadcaster";
    content: string;
    timestamp: number;
  }>;
  totalCount: number;
}

/**
 * 主播状态 API 响应
 */
export interface BroadcasterStatusResponse {
  energy: number;
  mood: string;
  moodValue: number;
  currentActivity: string;
  isLive: boolean;
  liveStreamStart?: number;
  liveStreamEnd?: number;
}

/**
 * 创建任务的 API 请求体
 */
export interface CreateTaskRequest {
  taskType: "message" | "greeting" | "reminder";
  targetUserId?: string; // 如果为空则广播
  content: string;
  delaySeconds: number;
  createdBy: string; // 谁创建的这个任务（通常是 broadcasterId）
}

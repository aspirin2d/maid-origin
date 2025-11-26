# IM Handler - Ria Virtual Idol

Interactive chat handler that powers one-on-one conversations with the Ria virtual idol, balancing scripted persona, live schedule, and moderation controls.

## Directory Structure

```
im/
├── index.ts                # Handler entry point and LLM orchestration
├── config.ts               # Static persona, schedule, image library, defaults
├── runtime.ts              # External data fetchers and logging hooks
├── schedule.ts             # Busy-mode calculation and context assembly
├── state.ts                # In-memory moderation state and overrides
├── types.ts                # Shared TypeScript contracts
├── QUICK_START.md          # API walkthrough for story creation
├── IMPLEMENTATION_SUMMARY.md
├── CLI_INTEGRATION.md
└── __tests__/integration.test.ts
```

## Capabilities

- Text chat pipeline with automatic schedule-aware busy replies and rude-content moderation.
- Command channel for runtime diagnostics (`get_state`, `view_stats`) and manual overrides (`force_busy`, `force_available`, `clear_busy_override`).
- Memory awareness: `view_stats` surfaces recent broadcaster memories for quick inspection.
- Structured image and scheduled-task responses with schema validation.
- CLI integration (`cmd/handlers.ts`, `cmd/stories.ts`) for local debug flows.

## Runtime Flow

1. Parse incoming payload (`textchat` or `command`).
2. For chat messages: enforce block list and busy schedule, enrich prompt with user data, broadcaster status, and recent history, then call LLM.
3. Normalize LLM JSON output and trigger side effects (task creation, logging, affection deltas).
4. For commands: execute synchronous logic without LLM involvement and return plain-text diagnostics.

## Input Contracts

```jsonc
// Text chat
{
  "type": "textchat",
  "message": "string",
  "userId": "string | optional",
  "timestamp": "number | optional"
}

// Command
{
  "type": "command",
  "command": "get_state | view_stats | block_user | unblock_user | force_busy | force_available | clear_busy_override",
  "args": { "key": "any" } | optional
}
```

## Output Schema

LLM responses must conform to a single-object JSON structure:
其中 result 的 metadata 结构为 不同模块不同。

```jsonc
{

    "ok": "boolean value true/false",
    "result": 
        {
            "userMessage": "string | null",
            "assistantMessage": "string | null",
            "metadata":
            {
                "responseType": "textchat | image | task | busy | blocked | error",
                "text": "string | null",
                "emotion": "string | null",
                "affectionChange": "number | null",
                "moodChange": "number | null",
                "energyChange": "number | null",
                "imageKey": "string | null",
                "taskType": "string | null",
                "taskDelaySeconds": "number | null",
                "taskContent": "string | null",
                "action":"string | null"
            }
        }

}
```

> metadata 内，对IM模块而言 各个字段含义如下

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `responseType` | `"textchat" | "image" | "task" | "busy" | "blocked" | "error"` | 指定 Ria 本次回复的响应模式：纯文本、图片推送、创建任务、忙碌自动回复、拉黑自动回复或错误提示。后续字段的取值范围完全依赖于此枚举，未匹配的模式会被视为错误。其中，textchat、busy、blocked都是纯文本，直接回复即可；image需要解析为客户的图片；task暂时不需要实现；error需要客户的转为本地错误日志；「task」后续单独提需求对接，用于让主播主动发消息。 |
| `text` | `string \\| null` | 主要文案内容。对 `textchat`、`busy`、`blocked` 三个模式直接展示在客户的IM消息即可；，其余场景写 `null`。允许内嵌表情符号和自然语言说明。 |
| `emotion` | `string \\| null` | （预留字段）Ria 的即时情绪标签，用于驱动前端表情或语气渲染。例如 `happy`、`tired`、`excited`。若无需要可写 `null`。 |
| `affectionChange` | `number \\| null` | 好感度增减量（-10～10）。为 0或`null` 表示不调整。正值代表提升，负值代表下降。需要游戏服务端存储该值。 |
| `moodChange` | `number \\| null` | 主播心情数值的增减（-100～100）。为 0 或 `null` 表示心情值保持不变，可用于驱动 HUD 或主播状态栏。 |
| `energyChange` | `number \\| null` | 主播体力数值的增减（-100～100）。为 0 或 `null` 表示体力值保持不变，供上游逻辑同步。 |
| `imageKey` | `string \\| null` | 当 `responseType` 为 `image` 时，客户的需解析此字段，回复给用户一张包内图片。其他片模式必为 `null`。 |
| `taskType` | `string \\| null` | （预留字段）当 `responseType` 为 `task` 时，标记任务类型（如 `message`、`greeting`、`reminder`）。其余模式强制 `null`。 |
| `taskDelaySeconds` | `number \\| null` | `task` 模式下的延迟秒数，用于安排定时任务触发时间。必须为正整数，其他模式设为 `null`。 |
| `taskContent` | `string \\| null` | （预留字段）`task` 模式下的定时内容文本。用于后台通知或消息正文。非任务模式设为 `null`。 |
| `action` | `string \\| null` | （预留字段）当前处理分支。常见值：`normal_llm`（常规 LLM 回复）、`busy_mode`（忙碌自动回复）、`block_mode`（拉黑自动回复）、`command`（命令行返回）。保留 `null` 以兼容未来扩展。 |

### 特别注意
1. textchat 模式下，返回的 text 可能会包含 换行符 '\n' ，此时需要拆分为多条客户端IM文本，而非单条文本内换行
2. 目前协议仍然为SSE，调试用id是7；可在 192.168.101.150:3000 测试（yifei的开发机）；后续会上到内网dev服务器：192.168.103.222

## Output Data Example
测试输出如下
```jsonc
{
    "ok": true,
    "result": {
        "userMessage": "我又回来了，你还好么！",
        "assistantMessage": "我暂时不在喔，这是自动回复。我在进行舞蹈训练中，等我练完再聊呀！💪",
        "metadata": {
            "responseType": "busy",
            "text": "我暂时不在喔，这是自动回复。我在进行舞蹈训练中，等我练完再聊呀！💪",
            "emotion": null,
            "affectionChange": null,
            "moodChange": null,
            "energyChange": null,
            "imageKey": null,
            "taskType": null,
            "taskDelaySeconds": null,
            "taskContent": null,
            "action": "busy_mode"
        }
    }
}
```

Handler logic maps these responses to downstream side effects:
- `image`: validates `imageKey` against `config.IMAGE_LIBRARY`.
- `task`: delegates to `createScheduledTask` for delayed messages.
- `busy` / `blocked`: generates canned replies using schedule and block state.

## Command Reference

| Command | Description |
| --- | --- |
| `get_state` | Reports caller block status, busy state, and current override mode. |
| `view_stats` | Includes busy summary, override label, block list preview, cached schedule context, current broadcaster core stats (energy, mood, activity, live flag), and the latest three broadcaster memories. |
| `block_user` | Blocks the provided user (or caller) for a configurable duration. |
| `unblock_user` | Removes block for the provided user (or caller). |
| `force_busy` | Forces busy mode with a validated reason from `BUSY_REASONS`. |
| `force_available` | Forces availability, bypassing schedule. |
| `clear_busy_override` | Returns to schedule-driven busy evaluation. |

## External Interfaces (`runtime.ts`)

All network operations are stubbed and should be replaced with production integrations:

- `fetchUserData(userId)` → base profile, affection metrics, block metadata.
- `fetchBroadcasterStatus()` → energy, mood, activity, live state (consumed by chat flow and `view_stats`).
- `fetchChatHistory(userId, limit)` → recent conversation context.
- `createScheduledTask(type, content, delay, targetUserId)` → background outreach tasks.
- `logInteraction(userId, message, response)` → telemetry hook.

Each helper returns fallback data when the downstream service is unavailable to keep the handler resilient during development.

## Configuration Surface (`config.ts`)

- `SYSTEM_PROMPT`: Persona and formatting rules injected into every prompt. Update to revise character profile or policy.
- `IMAGE_LIBRARY`: Available response assets. Extend when new image keys are added to storage.
- `SCHEDULE`: Defines daily activities, busy flags, and busy reasons used by `schedule.ts`.
- `DEFAULT_BLOCK_DURATION_MINUTES`, `BLOCK_TRIGGER_KEYWORDS`, `AFFECTION_STAGES`, `MOOD_DESCRIPTIONS`, `ENERGY_THRESHOLDS`: Tunables for moderation and response shaping.

## State Management (`state.ts`)

- In-memory block registry with expiry enforcement.
- Busy override state machine supporting `auto`, `forced_busy`, `forced_available`.
- Helper shims for updating affection and broadcaster stats (API hooks to be implemented).

## Testing

- `__tests__/integration.test.ts` exercises core scenarios (busy gating, block flow, command handling) against the handler factory.
- Recommended manual verification via CLI (`pnpm dev` → IM debug commands) and `pnpm build` for type safety.

## TODO

- Persist block state, overrides, and affection changes to durable storage.
- Replace runtime stubs with real backend integrations (users, status, history, tasks, logging).
- Extend rude-content detection beyond simple regex heuristics.
- Add automated coverage for CLI command formatting and memory preview output.

# Live Handler Event Schema

The live handler now supports event-driven input for handling various types of interactions in live streaming scenarios. This document describes the available event types and their usage.

## Overview

The event-based input system allows the VTuber handler to respond to different types of events beyond simple text messages, including:

- User chat messages
- Bullet chats (danmaku/弹幕)
- Program transitions (start/finish)
- Gift/donation events
- User interactions (follow, subscribe, etc.)
- System events
- Emotion state changes

## Backward Compatibility

The handler maintains full backward compatibility with the original input formats:

```typescript
// Legacy simple string
"Hello, how are you?"

// Legacy object format
{
  prompt: "Hello, how are you?",
  message: "Hello, how are you?",
  question: "Hello, how are you?",
  input: "Hello, how are you?"
}
```

These formats are automatically converted to `user_chat` events internally.

## Event Types

### 1. User Chat Event

Regular user messages in a conversational context.

```typescript
{
  type: "user_chat",
  data: {
    message: "今天天气真好！",
    username: "user123",        // optional
    timestamp: 1635724800000    // optional
  }
}
```

**When to use:** Regular chat interactions, Q&A sessions, direct conversations.

### 2. Bullet Chat Event

Short, casual messages typical in live streaming (danmaku/弹幕).

```typescript
{
  type: "bullet_chat",
  data: {
    message: "哈哈哈",
    username: "viewer456",      // optional
    timestamp: 1635724800000,   // optional
    position: "scroll"          // optional: "top" | "bottom" | "scroll"
  }
}
```

**When to use:** Live stream comments, rapid-fire messages, danmaku-style interactions.

**Difference from user_chat:** Bullet chats are typically:
- Shorter and more casual
- More frequent and rapid
- May not require direct response
- Often displayed differently in the UI

### 3. Program Event

Notifications about program/segment transitions during a live stream.

```typescript
{
  type: "program_event",
  data: {
    action: "finish",              // "start" | "finish" | "pause" | "resume"
    programName: "歌回",
    programId: "singing-001",      // optional
    programType: "singing",        // optional: "singing" | "chatting" | "gaming" | "drawing" | "other"
    duration: 3600,                // optional: duration in seconds (for finish events)
    metadata: {                    // optional: custom metadata
      songsPerformed: 5,
      viewersPeak: 1200
    }
  }
}
```

**When to use:**
- Starting a new program segment
- Finishing a program segment
- Pausing or resuming a program
- Transitioning between different activities

**Example scenarios:**
```typescript
// Starting a singing session
{ type: "program_event", data: { action: "start", programName: "歌回", programType: "singing" }}

// Finishing a game
{ type: "program_event", data: { action: "finish", programName: "Minecraft", programType: "gaming", duration: 7200 }}

// Taking a break
{ type: "program_event", data: { action: "pause", programName: "自由聊天" }}
```

### 4. Gift Event

When viewers send gifts or donations during the stream.

```typescript
{
  type: "gift_event",
  data: {
    username: "generous_fan",
    giftName: "超级火箭",
    giftCount: 3,
    giftValue: 299.99,             // optional: monetary value
    message: "继续加油！"           // optional: message with gift
  }
}
```

**When to use:** Processing donations, gifts, super chats, or any viewer monetary support.

**VTuber response expectations:**
- Thank the user
- React appropriately to gift size
- Read and respond to accompanying message
- Show excitement/gratitude

### 5. User Interaction Event

Non-chat user actions like following, subscribing, or sharing.

```typescript
{
  type: "user_interaction",
  data: {
    action: "subscribe",           // "follow" | "subscribe" | "like" | "share"
    username: "new_subscriber",
    tier: "premium",               // optional: for subscriptions
    months: 6                      // optional: subscription duration
  }
}
```

**When to use:** Acknowledging new followers, subscribers, likes, or shares.

**Example scenarios:**
```typescript
// New follower
{ type: "user_interaction", data: { action: "follow", username: "fan123" }}

// 6-month subscriber
{ type: "user_interaction", data: { action: "subscribe", username: "loyal_fan", months: 6, tier: "premium" }}

// Stream share
{ type: "user_interaction", data: { action: "share", username: "helpful_viewer" }}
```

### 6. System Event

Platform or technical notifications that may affect the stream.

```typescript
{
  type: "system_event",
  data: {
    eventType: "stream_quality_warning",
    message: "网络连接不稳定",      // optional
    severity: "warning",           // "info" | "warning" | "error"
    metadata: {                    // optional
      bitrate: 2500,
      droppedFrames: 120
    }
  }
}
```

**When to use:** Technical issues, platform announcements, automated notifications.

**Example scenarios:**
```typescript
// Stream start notification
{ type: "system_event", data: { eventType: "stream_start", severity: "info" }}

// Technical issue
{ type: "system_event", data: { eventType: "encoding_error", message: "编码器错误", severity: "error" }}

// Milestone reached
{ type: "system_event", data: { eventType: "viewer_milestone", message: "观众数达到10000", severity: "info" }}
```

### 7. Emotion Event

Direct emotional state changes or mood shifts.

```typescript
{
  type: "emotion_event",
  data: {
    emotion: "excited",
    intensity: 0.8,                // optional: 0-1 scale
    trigger: "达到订阅目标",        // optional: what caused this emotion
    duration: 60                   // optional: expected duration in seconds
  }
}
```

**When to use:** Explicitly changing emotional state, mood transitions, reaction triggers.

**Example scenarios:**
```typescript
// Excitement from milestone
{ type: "emotion_event", data: { emotion: "excited", intensity: 0.9, trigger: "达到1万订阅" }}

// Tiredness during long stream
{ type: "emotion_event", data: { emotion: "tired", intensity: 0.6, duration: 300 }}

// Surprise from unexpected event
{ type: "emotion_event", data: { emotion: "surprised", intensity: 1.0, trigger: "突然的大礼物" }}
```

## Integration Examples

### REST API Usage

```typescript
// POST /api/stories/:storyId/message
// Body can be any valid event

// Simple message (backward compatible)
{
  "message": "Hello!"
}

// Bullet chat
{
  "type": "bullet_chat",
  "data": {
    "message": "666",
    "username": "viewer123"
  }
}

// Program finished
{
  "type": "program_event",
  "data": {
    "action": "finish",
    "programName": "游戏时间",
    "programType": "gaming",
    "duration": 5400
  }
}
```

### Frontend Integration

```typescript
import type { LiveEvent } from './handlers/live/events';

class LiveStreamClient {
  // Send regular chat
  sendChat(message: string, username?: string) {
    const event: LiveEvent = {
      type: "user_chat",
      data: { message, username }
    };
    return this.sendEvent(event);
  }

  // Send bullet chat
  sendBulletChat(message: string, username?: string) {
    const event: LiveEvent = {
      type: "bullet_chat",
      data: { message, username, position: "scroll" }
    };
    return this.sendEvent(event);
  }

  // Notify program change
  startProgram(programName: string, programType: string) {
    const event: LiveEvent = {
      type: "program_event",
      data: { action: "start", programName, programType }
    };
    return this.sendEvent(event);
  }

  finishProgram(programName: string, duration: number) {
    const event: LiveEvent = {
      type: "program_event",
      data: { action: "finish", programName, duration }
    };
    return this.sendEvent(event);
  }

  // Process gift
  handleGift(username: string, giftName: string, count: number, message?: string) {
    const event: LiveEvent = {
      type: "gift_event",
      data: { username, giftName, giftCount: count, message }
    };
    return this.sendEvent(event);
  }

  private async sendEvent(event: LiveEvent) {
    const response = await fetch(`/api/stories/${this.storyId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    return response;
  }
}
```

### Event Processing Pipeline

The handler processes events through the following pipeline:

1. **Input Normalization**: Legacy formats are converted to event format
2. **Event Context Building**: Extract context based on event type
3. **Memory Search**: Relevant events trigger memory lookup
4. **Prompt Building**: Event context is added with appropriate headers
5. **Response Generation**: VTuber generates clips (body, face, speech)
6. **Message Persistence**: Event text is saved to chat history

## Best Practices

### When to Use Each Event Type

| Scenario | Event Type | Reason |
|----------|------------|--------|
| Regular conversation | `user_chat` | Standard Q&A, discussions |
| Live stream comments | `bullet_chat` | Rapid, casual interactions |
| Segment transitions | `program_event` | Track stream structure |
| Donations/gifts | `gift_event` | Proper acknowledgment |
| New followers | `user_interaction` | Welcome and thank users |
| Technical issues | `system_event` | Address problems |
| Mood changes | `emotion_event` | Explicit state control |

### Event Frequency Considerations

- **High frequency** (bullet_chat, user_chat): May not require response to every message
- **Medium frequency** (gift_event, user_interaction): Should acknowledge each
- **Low frequency** (program_event, emotion_event, system_event): Always process

### Response Expectations

Different events have different response expectations:

- **user_chat**: Direct answer or conversation
- **bullet_chat**: Optional acknowledgment, reactions
- **program_event**: Transition commentary, setup/wrapup
- **gift_event**: Gratitude, excitement, read message
- **user_interaction**: Welcome, thanks
- **system_event**: Acknowledge issue or info
- **emotion_event**: Express the emotion naturally

## Schema Validation

All events are validated using Zod schemas. Invalid events will be rejected:

```typescript
import { liveInputSchema } from './handlers/live/events';

// Validate input
try {
  const validated = liveInputSchema.parse(userInput);
  // Process validated input
} catch (error) {
  // Handle validation error
  console.error('Invalid event format:', error);
}
```

## Migration Guide

If you're upgrading from the old format:

### Before (v1.0.0)
```typescript
// Only supported simple text
POST /api/stories/123/message
{ "message": "Hello" }
```

### After (v2.0.0)
```typescript
// Still supports simple text (backward compatible)
POST /api/stories/123/message
{ "message": "Hello" }

// Now also supports rich events
POST /api/stories/123/message
{
  "type": "bullet_chat",
  "data": {
    "message": "Hello",
    "username": "viewer123"
  }
}
```

No breaking changes - all existing code continues to work!

## Extending the Event System

To add new event types:

1. Add schema to `events.ts`:
```typescript
const myCustomEventSchema = z.object({
  type: z.literal("my_custom_event"),
  data: z.object({
    // your fields
  })
});
```

2. Add to discriminated union:
```typescript
export const liveEventSchema = z.discriminatedUnion("type", [
  // ... existing events
  myCustomEventSchema,
]);
```

3. Update helper functions:
```typescript
export function extractEventText(event: LiveEvent): string | null {
  switch (event.type) {
    // ... existing cases
    case "my_custom_event":
      return // your logic
  }
}
```

4. Update prompt builder if needed for special handling.

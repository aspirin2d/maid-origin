# Live Handler - Sayo VTuber

A modular, well-structured handler for the Sayo AI VTuber character with rich, expressive responses.

## Directory Structure

```
live/
├── index.ts                    # Main handler entry point
├── prompt-builder.ts           # Orchestrates prompt assembly
├── utils.ts                    # Shared utility functions
├── settings/                   # Character and format settings
│   ├── index.ts               # Barrel export
│   ├── character.ts           # Sayo's personality, appearance, background
│   ├── stream-program.ts      # Stream schedule, segments, interactions
│   └── response-format.ts     # Output format and examples
└── context/                    # Dynamic context builders
    ├── index.ts               # Barrel export
    ├── time.ts                # Current time context
    ├── memory.ts              # Semantic memory retrieval
    └── chat-history.ts        # Recent conversation history
```

## Architecture

### Separation of Concerns

**Settings** (`settings/`)
- Static character definitions
- Response format specifications
- Stream program information
- Cached on first use for performance

**Context** (`context/`)
- Dynamic runtime information
- Time-sensitive data
- User-specific memories
- Conversation history

**Orchestration** (`prompt-builder.ts`)
- Assembles settings and context
- Parallelizes async operations
- Clean, maintainable entry point

### Key Features

1. **Modular Design**: Each concern is in its own file
2. **Performance Optimized**:
   - Settings are cached
   - Memory/history fetched in parallel
3. **Easy to Maintain**:
   - Update character? Edit `settings/character.ts`
   - Change time format? Edit `context/time.ts`
4. **Type Safe**: Full TypeScript support throughout

## Usage

The handler is registered automatically on import. It responds with structured JSON containing 1-3 "clips" (body, face, speech) for expressive VTuber responses.

### Configuration Options

```typescript
{
  messageLimit: number;        // Chat history limit (default: 50)
  systemPrompt?: string;       // Override default system prompt
  memoryTopK?: number;         // Memory search results (default: 5)
  memoryMinSimilarity?: number; // Similarity threshold (default: 0.5)
}
```

### Output Format

```json
{
  "clips": [
    {
      "body": "双手在胸前交叉，然后向两侧张开",
      "face": "眼睛弯成月牙状，嘴角上扬",
      "speech": "哇！你好呀～很高兴见到你！"
    }
  ]
}
```

## Development

### Adding New Settings

1. Create a new file in `settings/`
2. Export a getter function
3. Add to `settings/index.ts`
4. Use in `prompt-builder.ts`

### Modifying Context Builders

Each context builder in `context/` is independent and can be modified without affecting others. They all follow the same pattern:
- Async function
- Returns formatted markdown string
- Handles errors gracefully

### Testing

The modular structure makes unit testing straightforward:
- Test settings functions in isolation
- Mock context builders
- Test orchestration separately

## Performance Notes

- **System prompt**: Cached after first generation (~540 lines)
- **Parallel fetching**: Memory and chat history fetch simultaneously
- **Efficient imports**: Barrel exports for clean module resolution

## Migration from Monolithic Structure

Previously, all code was in a single ~530 line `prompt-builder.ts`. Now:
- Settings: 3 focused modules (~40 lines each)
- Context: 3 focused modules (~20-50 lines each)
- Orchestrator: 1 clean file (~90 lines)

Total lines are similar, but organization and maintainability are significantly improved.

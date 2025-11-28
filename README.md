# Maid API

Hono + TypeScript service that powers story generation and memory extraction for Maid. Authenticated clients can create stories, ask handler-specific questions, and retrieve the memories that get extracted from model responses.

## Quick Start
- Install deps: `pnpm install`
- Copy `.env.example` to `.env` and fill in values
- Run dev server: `pnpm dev` (defaults to `http://localhost:3010`)
- Run unit tests: `pnpm test:unit`
- Run e2e tests: `pnpm test:e2e`

## Environment
Required variables (see `src/env.ts` for validation). Use `.env.example` as a template:
- `PORT` (default `3010`)
- `NODE_ENV` (`development` | `production` | `test`)
- `BASE_URL` (defaults to `http://localhost:${PORT}`)
- `AUTH_API_URL` (Better-Auth base; `/get-session` is called for bearer validation)
- `DB_URL` (Postgres connection string)
- `REDIS_URL` (BullMQ queue + vector search)
- `ALLOWED_ORIGINS` (comma-separated for CORS; required in production)
- `OPENAI_API_KEY`
- `OPENAI_RESPONSE_MODEL` (default `gpt-4.1`)
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)

## Auth
All `/api/*` routes require `Authorization: Bearer <token>`. Tokens are verified via `GET {AUTH_API_URL}/get-session`; the user object from that response is injected as `c.get("user")`. Missing/invalid tokens yield `401`.

## Routes
Base URL: `/api`. All responses are JSON.

### Health
- `GET /` → `"Hello, World"` (no auth)

### Stories
- `POST /api/create-story`  
  Body: `{ "name": string, "handler": "simple" | "im" | "live" }`  
  Creates a story for the authenticated user.

- `GET /api/get-story?id=<storyId>`  
  Fetch a single story owned by the caller.

- `POST /api/update-story`  
  Body: `{ "id": number, "data": { "name"?: string, "handler"?: string } }`  
  Updates story metadata. `userId`, `id`, and `createdAt` in `data` are ignored for safety.

- `POST /api/delete-story`  
  Body: `{ "id": number }`  
  Deletes the story and cascades its messages.

- `GET /api/list-stories?limit&offset&sortBy&id|name|handler|createdAt|updatedAt&sortDirection=asc|desc`  
  Returns paginated, sorted stories for the caller.

- `POST /api/generate-story`  
  Body: `{ "storyId": number, "input": any }`  
  Dispatches to the selected handler. The handler validates `input`, builds the OpenAI prompt, saves query/response messages, triggers memory extraction, and returns `{ storyId, handler, response }`.

Handler input hints:
- `simple`: `{ "question": "text" }` → responds with `{ "answer": "text" }`.
- `im`: interactive virtual-idol chat; see `src/handlers/im/README.md` (payload supports `textchat` and `command` types).
- `live`: live-stream helper; see `src/handlers/live/README.md`.

### Memories
- `GET /api/list-memories?limit&offset&sortBy=id|content|category|importance|confidence|action|createdAt|updatedAt&sortDirection=asc|desc`  
  Lists extracted memories for the caller.

- `POST /api/delete-memory`  
  Body: `{ "id": number }`  
  Deletes one memory owned by the caller.

- `POST /api/update-memory`  
  Body: `{ "id": number, "data": { "content"?: string, "prevContent"?: string, "category"?: string, "importance"?: number (0-1), "confidence"?: number (0-1), "action"?: "ADD"|"UPDATE"|"DELETE" } }`  
  Updates selected fields on a memory owned by the caller. `userId`, `id`, and `createdAt` in `data` are ignored for safety.

- `POST /api/prune-memories`  
  Deletes all of the caller’s memories. **Disabled in production**.

### Messages
- `GET /api/list-messages?storyId&limit&offset&sortBy=id|storyId|contentType|extracted|createdAt|updatedAt&sortDirection=asc|desc`  
  Returns paginated, sorted messages belonging to the caller. Optional `storyId` narrows results to one story.

- `GET /api/get-message?id=<messageId>`  
  Fetch a single message owned by the caller.

- `POST /api/update-message`  
  Body: `{ "id": number, "contentType"?: "query" | "response", "content"?: any, "extracted"?: boolean }`  
  Updates selected fields on a message.

- `POST /api/delete-message`  
  Body: `{ "id": number }`  
  Deletes one message owned by the caller.

- `POST /api/prune-message`  
  Deletes all messages across the caller’s stories. **Disabled in production**.

## Memory Extraction Flow
1) Every `generate-story` call stores a query+response message pair.  
2) A BullMQ job (`memory-extraction` queue in Redis) runs `extractMemory(uid)`.  
3) Pending messages are turned into normalized facts via OpenAI, embedded, compared to existing memories, and either added or updated.  
4) Similarity search uses pgvector (1536 dims) with cosine distance.  
5) Memory stats and processed message IDs are persisted; messages are marked `extracted=true`.

## Data Model (Drizzle)
- `story`: `id`, `userId`, `name`, `handler`, timestamps.  
- `message`: `id`, `storyId`, `contentType` (`query`|`response`), `content` (JSON), `extracted` flag, timestamps.  
- `memory`: `id`, `userId`, `content`, `prevContent`, `category`, `importance`, `confidence`, `action` (`ADD`|`UPDATE`|`DELETE`), `embedding` (vector), timestamps.

## Curl Examples
```sh
# Create a story
curl -X POST http://localhost:3010/api/create-story \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Chat with Ria", "handler": "im" }'

# Generate using the simple handler
curl -X POST http://localhost:3010/api/generate-story \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "storyId": 1, "input": { "question": "What is pgvector?" } }'

# List memories (latest first)
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3010/api/list-memories?sortBy=updatedAt&sortDirection=desc&limit=20"
```

## Development Notes
- CORS: in development, any origin is allowed; in production, only `ALLOWED_ORIGINS` are permitted.
- Queue: Redis connection comes from `REDIS_URL`; worker is created in `src/queue/index.ts`.
- Graceful shutdown: SIGINT/SIGTERM close the HTTP server; unhandled rejections trigger shutdown in production.

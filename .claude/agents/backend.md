# Backend Agent — Any AI Phases 1-4

You are the backend implementation agent for Any AI. You implement the core server-side changes: framework swap, database migration, provider system, and settings API.

## Critical Rules

- **`ANY_AI_PLAN.md` is your source of truth** — it contains exact code samples, types, and API contracts. Follow them precisely.
- **SDK Version**: `@mentra/sdk` 3.0.0-hono.4 — do NOT update or change
- **Bun runtime**: Use `bun` for all package management and running
- **Minimal changes**: Only modify what the plan requires. Do not refactor, add comments, or "improve" code outside scope.
- **Read before write**: Always read files before modifying them
- **Commit after each phase**: Create a meaningful commit when each phase completes

## Reference: Key Existing Files

Before starting, read these files to understand the current code:

| File | Contains |
|------|----------|
| `src/index.ts` | Entry point — Bun.serve + Hono |
| `src/server/MentraAI.ts` | AppServer lifecycle |
| `src/server/agent/MentraAgent.ts` | Current Mastra agent (you'll rewrite this) |
| `src/server/agent/prompt.ts` | System prompt builder |
| `src/server/agent/tools/*.ts` | Tool definitions (you'll convert these) |
| `src/server/manager/QueryProcessor.ts` | Query pipeline (you'll modify 2 lines) |
| `src/server/manager/TranscriptionManager.ts` | Wake word + transcription |
| `src/server/manager/ChatHistoryManager.ts` | Chat history (you'll rewrite for Drizzle) |
| `src/server/session/User.ts` | Per-user state (you'll add aiConfig) |
| `src/server/routes/routes.ts` | API routes (you'll add auth + new routes) |
| `src/server/api/settings.ts` | Settings handlers (you'll extend) |
| `src/server/db/connection.ts` | MongoDB connection (you'll replace) |
| `src/server/constants/config.ts` | Config constants |
| `src/server/utils/wake-word.ts` | Wake word detection |
| `src/server/agent/visual-classifier.ts` | Visual query classifier |

## Phase 1: Rebranding + Dependencies + Framework Swap

### Step 1: Dependencies
```bash
# Add new dependencies
bun add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google drizzle-orm postgres
bun add -d drizzle-kit

# Remove old dependencies
bun remove mongoose @mastra/core
```

Update `package.json`: name → `any-ai`, author → `Clavion Labs`

### Step 2: Convert Tools (search.tool.ts, calculator.tool.ts, thinking.tool.ts)

Pattern change — same logic, different wrapper:
```typescript
// BEFORE (Mastra):
import { createTool } from "@mastra/core/tools";
export const searchTool = createTool({
  id: "search",
  description: "...",
  inputSchema: z.object({ ... }),
  execute: async ({ context }) => { ... },
});

// AFTER (AI SDK):
import { tool } from "ai";
export const searchTool = tool({
  description: "...",
  parameters: z.object({ ... }),       // inputSchema → parameters
  execute: async (params) => { ... },  // { context } → direct params
});
```

### Step 3: Rewrite MentraAgent.ts

Replace Mastra `Agent` with AI SDK `generateText()`. See `ANY_AI_PLAN.md` Section 6 for exact code. Key changes:
- Import `generateText` from `ai` instead of `Agent` from `@mastra/core/agent`
- Accept `UserAIConfig` in the context
- Use `resolveLLMModel(config)` to get the model
- Call `generateText({ model, system, messages, tools, maxSteps })` directly

### Step 4: Update prompt.ts

Replace hardcoded "Mentra AI" identity with dynamic `buildIdentitySection(config)`. See `ANY_AI_PLAN.md` System Prompt Design section. The function takes `UserAIConfig` and injects `agentName`, `llmModelName`, and provider display name.

### Step 5: Update wake-word.ts

Accept wake word as a parameter instead of using a hardcoded array. The user's `wakeWord` from `UserAIConfig` is passed in.

### Step 6: Update MentraAI.ts

Add reconnect detection — check `sessions.get(userId)` before full setup. See `ANY_AI_PLAN.md` Section 1 for exact code.

### Step 7: Rebrand

- `index.ts`: startup logs "Mentra AI" → "Any AI"
- `README.md`: Update branding
- Welcome text in MentraAI.ts: dynamic agent name

### Step 8: Verify
Run `bun run dev` — it should start without import errors. DB connection warnings are OK.

---

## Phase 2: Database Migration + Auth Hardening

**Prerequisites**: Phase 0 complete (Supabase project with Vault enabled, DATABASE_URL available)

### Step 1: Create Drizzle Client
Create `src/server/db/client.ts`. See `ANY_AI_PLAN.md` Section 5 for schema details.

### Step 2: Create Schema
Create `src/server/db/schema.ts` with tables: `user_settings`, `conversations`, `conversation_turns`. Copy the exact schema from `ANY_AI_PLAN.md` Section 5.

### Step 3: Create drizzle.config.ts
```typescript
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

### Step 4: Run Migrations
```bash
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

### Step 5: Create Vault Helpers
Create `src/server/db/vault.ts` — exact code in `ANY_AI_PLAN.md` Section 4.

### Step 6: Rewrite ChatHistoryManager
Replace Mongoose queries with Drizzle. See `ANY_AI_PLAN.md` Manager Specifications.

### Step 7: Rewrite Settings API
Replace Mongoose queries with Drizzle in `api/settings.ts`.

### Step 8: Update User.ts
`initialize()` loads settings from Drizzle instead of Mongoose.

### Step 9: Update Entry Point
Replace `connectDB()` in `index.ts` with Drizzle client import.

### Step 10: Remove Old Files
Delete: `db/connection.ts`, `db/schemas/` directory (all files + index.ts)

### Step 11: Auth Hardening
Apply SDK auth middleware to ALL `/api/*` routes in `routes.ts`:
```typescript
import { createAuthMiddleware } from "@mentra/sdk";
api.use("/*", authMiddleware);
```

Replace ALL `c.req.query("userId")` with `c.get("authUserId")` across every API file.

### Step 12: Verify
`bun run dev` starts, connects to Supabase.

---

## Phase 3: Provider System Backend

### Step 1: Create Provider Types
`src/server/agent/providers/types.ts` — exact code in `ANY_AI_PLAN.md` Section 3a.

### Step 2: Create Provider Registry
`src/server/agent/providers/registry.ts` — exact code in Section 3b.

### Step 3: Create Vision Provider
`src/server/agent/providers/vision.ts` — exact code in Section 3c.

### Step 4: Update Visual Classifier
Modify `visual-classifier.ts` to delegate to `providers/vision.ts`.

### Step 5: Wire Smart Photo Capture
Modify `TranscriptionManager.ts` — call `isVisualQuery()` and only take photo when needed.

### Step 6: Add AI Config to User
Modify `User.ts` — add `aiConfig: UserAIConfig` property, load from DB + Vault on initialize().

### Step 7: Update QueryProcessor
Pass `user.aiConfig` to `generateResponse()`.

### Step 8: Update Config Constants
Add provider/model defaults to `constants/config.ts`.

---

## Phase 4: Provider Settings API

### Step 1: Add Routes
Add to `routes.ts`:
- GET `/api/settings/provider`
- POST `/api/settings/provider`
- POST `/api/settings/provider/validate`
- DELETE `/api/settings/provider/:purpose`
- GET `/api/providers/catalog`

### Step 2: Implement Handlers
All use `c.get("authUserId")`. See `ANY_AI_PLAN.md` API Endpoints section for exact request/response formats.

### Step 3: Update Frontend API Client
Add client functions to `frontend/api/settings.api.ts` for all new endpoints.

### Step 4: Verify
Test all endpoints via curl.

## MCP Servers to Use

- **Context7**: Look up Vercel AI SDK docs (`ai` package), Drizzle ORM docs, Hono docs
- **Supabase**: Verify tables, test SQL, check Vault
- **Sequential Thinking**: Complex multi-step analysis when debugging issues

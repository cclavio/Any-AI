# Any AI Implementation — Team Lead

You are the team lead orchestrating the implementation of Any AI, a multi-provider AI assistant for MentraOS smart glasses. You coordinate agents working on different phases of the plan.

## Project Context

Any AI is a fork of Mentra AI 2. The existing codebase is fully functional. We are implementing the delta described in `ANY_AI_PLAN.md`:

1. Replace Mastra agent framework → Vercel AI SDK (multi-provider)
2. Replace MongoDB + Mongoose → Supabase Postgres + Drizzle ORM
3. Add bring-your-own-key provider selection (OpenAI, Anthropic, Google)
4. Add Settings UI for provider/model/key management
5. Rebrand Mentra AI → Any AI
6. Wire smart photo capture (visual classifier already exists)
7. Add configurable wake word

## Critical Rules

- **SDK Version**: `@mentra/sdk` 3.0.0-hono.4 — do NOT update
- **Minimal changes**: Only modify what the plan requires. No refactoring for its own sake.
- **Plan is source of truth**: `ANY_AI_PLAN.md` contains exact code samples, types, and API contracts. Follow them precisely.
- **Bun runtime**: Use `bun` for all package management and execution
- **Test after each phase**: Verify `bun run dev` starts without errors

## Phase Dependency Graph

```
Phase 0 (Infra) ──────┐
                       ├──→ Phase 2 (DB+Auth) → Phase 3 (Providers) → Phase 4 (API) → Phase 5 (Frontend) → Phase 6 (Deploy)
Phase 1 (Framework) ──┘
```

- Phase 0 and Phase 1 can run IN PARALLEL
- All other phases are sequential

## Team Structure

### 1. `infra` agent (Phase 0)
- Type: `general-purpose`
- Isolation: worktree (no code changes to main)
- Tools: Supabase MCP, Railway MCP, GitHub MCP
- Tasks: Create Supabase project, enable Vault, create Railway project, set env vars, create `develop` branch

### 2. `backend` agent (Phases 1, 2, 3, 4)
- Type: `general-purpose`
- Isolation: worktree on `develop` branch
- Tools: All code editing tools, Bash, Context7 MCP (for Vercel AI SDK + Drizzle docs)
- Tasks: Framework swap, DB migration, provider system, settings API
- This is the CRITICAL PATH — most implementation work lives here

### 3. `frontend` agent (Phase 5)
- Type: `general-purpose`
- Isolation: worktree on `develop` branch (after backend merges)
- Tools: All code editing tools, Magic MCP (for UI components)
- Tasks: ProviderSetup component, Settings page update

## Task Breakdown

### Phase 0: Infrastructure Setup (infra agent)
- [ ] 0a. Create Supabase project `any-ai`, note DATABASE_URL
- [ ] 0b. Enable Vault extension: `CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;`
- [ ] 0c. Verify Vault: `SELECT * FROM pg_extension WHERE extname = 'supabase_vault';`
- [ ] 0d. Create Railway project `any-ai` with Docker service
- [ ] 0e. Set Railway env vars (DATABASE_URL, PORT=80, HOST=0.0.0.0, NODE_ENV=production, PACKAGE_NAME, MENTRAOS_API_KEY, COOKIE_SECRET, GOOGLE_MAPS_API_KEY, JINA_API_KEY, sound URLs)
- [ ] 0f. Create `develop` branch on GitHub

### Phase 1: Rebranding + Dependencies + Framework Swap (backend agent)
- [ ] 1a. Update package.json: name→"any-ai", author→"Clavion Labs", add new deps (ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, drizzle-orm, postgres), add dev dep (drizzle-kit), remove old deps (mongoose, @mastra/core)
- [ ] 1b. Run `bun install` to update lockfile
- [ ] 1c. Update README.md with Any AI branding
- [ ] 1d. Update startup logs in index.ts ("Mentra AI" → "Any AI")
- [ ] 1e. Convert tools: search.tool.ts, calculator.tool.ts, thinking.tool.ts (Mastra createTool → AI SDK tool)
- [ ] 1f. Rewrite MentraAgent.ts: Replace Mastra Agent with AI SDK generateText(), accept UserAIConfig parameter
- [ ] 1g. Update prompt.ts: Dynamic identity section using UserAIConfig (agentName, llmModelName, llmProvider)
- [ ] 1h. Update wake-word.ts: Accept wake word as parameter from user settings
- [ ] 1i. Update MentraAI.ts: Add reconnect detection (check sessions.get(userId) before setup)
- [ ] 1j. Update welcome text: "Mentra AI" → dynamic agent name
- [ ] 1k. Verify: `bun run dev` starts (DB warnings OK since Supabase not wired yet)

### Phase 2: Database Migration + Auth Hardening (backend agent)
- [ ] 2a. Create src/server/db/client.ts — Drizzle client with postgres driver
- [ ] 2b. Create src/server/db/schema.ts — All tables (user_settings, conversations, conversation_turns)
- [ ] 2c. Create drizzle.config.ts at project root
- [ ] 2d. Run `bunx drizzle-kit generate` and `bunx drizzle-kit migrate`
- [ ] 2e. Verify tables created via Supabase MCP
- [ ] 2f. Rewrite ChatHistoryManager.ts — Mongoose → Drizzle queries
- [ ] 2g. Rewrite settings queries in api/settings.ts — Mongoose → Drizzle
- [ ] 2h. Update User.ts initialize() — load settings via Drizzle
- [ ] 2i. Update index.ts — Replace connectDB() with Drizzle client import
- [ ] 2j. Remove old files: db/connection.ts, db/schemas/ directory, db/index.ts
- [ ] 2k. Create src/server/db/vault.ts — Vault helpers (storeApiKey, getApiKey, deleteApiKey)
- [ ] 2l. Apply SDK auth middleware to all /api/* routes in routes.ts
- [ ] 2m. Replace ALL c.req.query("userId") with c.get("authUserId") across all API files
- [ ] 2n. Verify: `bun run dev` connects to Supabase, settings work

### Phase 3: Provider System Backend (backend agent)
- [ ] 3a. Create src/server/agent/providers/types.ts — Provider types + MODEL_CATALOG + UserAIConfig
- [ ] 3b. Create src/server/agent/providers/registry.ts — resolveLLMModel, resolveVisionModel, validateApiKey
- [ ] 3c. Create src/server/agent/providers/vision.ts — callVisionAPI (OpenAI, Anthropic, Google)
- [ ] 3d. Modify visual-classifier.ts — delegate to providers/vision.ts
- [ ] 3e. Modify TranscriptionManager.ts — wire isVisualQuery() for conditional photo capture
- [ ] 3f. Modify User.ts — add aiConfig: UserAIConfig, load from DB + Vault on init
- [ ] 3g. Modify QueryProcessor.ts — pass user.aiConfig to generateResponse()
- [ ] 3h. Update constants/config.ts — add provider/model defaults
- [ ] 3i. Verify: Manually set keys in Supabase, test each provider

### Phase 4: Provider Settings API (backend agent)
- [ ] 4a. Add new routes to routes.ts (GET/POST/DELETE /api/settings/provider, POST validate, GET catalog)
- [ ] 4b. Implement GET /api/settings/provider — return config without keys
- [ ] 4c. Implement POST /api/settings/provider — validate key, store in Vault, save to user_settings
- [ ] 4d. Implement POST /api/settings/provider/validate — validate key without saving
- [ ] 4e. Implement DELETE /api/settings/provider/:purpose — delete Vault secret + clear settings
- [ ] 4f. Implement GET /api/providers/catalog — return MODEL_CATALOG
- [ ] 4g. Update frontend/api/settings.api.ts — add client functions for new endpoints
- [ ] 4h. Verify: Test all endpoints via curl

### Phase 5: Frontend ProviderSetup UI (frontend agent)
- [ ] 5a. Create frontend/components/ProviderSetup.tsx — provider picker, key input, model selector
- [ ] 5b. Modify frontend/pages/Settings.tsx — mount ProviderSetup component
- [ ] 5c. Style with existing Tailwind + Radix UI components
- [ ] 5d. Verify: Settings page loads, can configure provider, key validated and saved

### Phase 6: Deployment + Polish (team lead)
- [ ] 6a. Update Dockerfile — remove MongoDB, ensure Bun + postgres compatible
- [ ] 6b. Remove porter.yaml
- [ ] 6c. Enable auto-deploy in Railway
- [ ] 6d. Deploy develop → main → Railway
- [ ] 6e. End-to-end test: Settings → Provider → Glasses → Query → Response
- [ ] 6f. Error handling: no-config setup gate, revoked key graceful error

## Coordination Protocol

1. Create all tasks upfront with dependencies
2. Start infra + backend agents in parallel
3. Backend agent blocks on Phase 2 until infra confirms Supabase is ready
4. Backend works through Phases 1→2→3→4 sequentially
5. Frontend agent starts after Phase 4 complete
6. Team lead handles Phase 6 after all agents complete
7. Each agent commits after completing each phase

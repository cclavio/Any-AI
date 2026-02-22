# Any AI — Agent Team Spawn Prompt

Use this prompt to kick off the full implementation. Copy and paste into Claude Code.

---

## Quick Start (paste this)

```
Create a team called "anyai-impl" to implement the Any AI plan from ANY_AI_PLAN.md.

The plan has 7 phases (0-6). Phases 0 and 1 can run in parallel, everything else is sequential.

## Team Members

1. **infra** — Infrastructure setup (Phase 0)
   - Supabase project creation + Vault extension
   - Railway project + env vars
   - GitHub develop branch
   - Use Supabase MCP + Railway MCP
   - See .claude/agents/infra.md for full instructions

2. **backend** — Core implementation (Phases 1→2→3→4)
   - Phase 1: Rebranding + Mastra→AI SDK framework swap + dependency changes
   - Phase 2: MongoDB→Drizzle/Supabase migration + auth hardening (BLOCKED until infra completes)
   - Phase 3: Provider system (types, registry, vision, smart photo capture)
   - Phase 4: Provider settings API endpoints
   - Use Context7 MCP for Vercel AI SDK + Drizzle docs
   - See .claude/agents/backend.md for full instructions
   - This is the CRITICAL PATH

3. **frontend** — UI implementation (Phase 5, BLOCKED until backend Phase 4 completes)
   - ProviderSetup component (provider picker, key input, model selector)
   - Settings page integration
   - See .claude/agents/frontend.md for full instructions

## Execution Order

1. Start `infra` and `backend` in PARALLEL
   - backend begins Phase 1 immediately (no infra dependency)
   - infra sets up Supabase + Railway
2. When infra reports DATABASE_URL → backend starts Phase 2
3. backend works through Phases 2→3→4 sequentially
4. When backend completes Phase 4 → start `frontend` for Phase 5
5. Team lead handles Phase 6 (deploy) after all agents complete

## Key Constraints
- ANY_AI_PLAN.md is the source of truth — agents follow it exactly
- @mentra/sdk 3.0.0-hono.4 is PINNED — do not update
- Use bun for all package management
- Commit after each phase completion
- Test `bun run dev` after each phase
```

---

## Alternative: Phase-by-Phase Manual Execution

If you prefer to run phases manually instead of a full team:

### Phase 0 + 1 (parallel)
```
Run two agents in parallel:

Agent 1 (infra): Follow .claude/agents/infra.md — set up Supabase with Vault + Railway with env vars + create develop branch.

Agent 2 (backend-p1): On the develop branch, execute Phase 1 from .claude/agents/backend.md — update dependencies, convert Mastra→AI SDK, rebrand to Any AI, add reconnect detection.
```

### Phase 2 (after both above complete)
```
On develop branch, execute Phase 2 from .claude/agents/backend.md — create Drizzle schema, run migrations against Supabase, rewrite ChatHistoryManager and settings for Drizzle, create Vault helpers, apply auth middleware, replace all userId query params with verified auth. DATABASE_URL is: <paste from infra agent>
```

### Phase 3
```
On develop branch, execute Phase 3 from .claude/agents/backend.md — create provider types/registry/vision, wire smart photo capture, add aiConfig to User, update QueryProcessor.
```

### Phase 4
```
On develop branch, execute Phase 4 from .claude/agents/backend.md — add provider settings API routes, implement all handlers, update frontend API client.
```

### Phase 5
```
On develop branch, execute Phase 5 from .claude/agents/frontend.md — create ProviderSetup component, integrate into Settings page.
```

### Phase 6
```
Update Dockerfile, remove porter.yaml, deploy to Railway, run end-to-end tests.
```

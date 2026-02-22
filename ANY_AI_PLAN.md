# Any AI - Architecture & Implementation Plan

> **Status:** Planning
> **This is the active plan.** All implementation work follows this document.
> **Base:** Forked from Mentra AI 2 (complete, working app)
> **SDK Version:** `@mentra/sdk` 3.0.0-hono.4 (pinned — do NOT update to 2.x stable)
> **Publisher:** Clavion Labs
> **Date:** February 2026
> **Original reference:** [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md) documents the Mentra AI 2 codebase we forked from (read-only, do not implement from it)

---

## Executive Summary

Any AI is a fork of Mentra AI 2 that transforms the single-provider Gemini assistant into a **multi-provider, bring-your-own-key** AI assistant for MentraOS smart glasses. Users choose their preferred AI provider (OpenAI, Anthropic, or Google), enter their own API key, and select which model to use — for both LLM chat and vision separately.

The existing Mentra AI 2 codebase is **fully functional**. This plan focuses exclusively on the delta: swapping the hardcoded Gemini integration for a provider-agnostic architecture, updating the Settings UI for key/model management, and rebranding to Any AI.

### What We're Building (Delta from Mentra AI 2)
- **Multi-provider LLM support**: OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude Sonnet, Haiku), Google (Gemini 2.5 Flash, Pro)
- **Multi-provider Vision support**: Separate provider/model selection for vision tasks (camera analysis)
- **Bring-your-own-key**: Users enter API keys per provider in the Settings page
- **Model selector**: Users pick their preferred LLM model and vision model independently
- **Provider-agnostic agent layer**: Replace Mastra with Vercel AI SDK directly for multi-provider routing
- **Configurable wake word**: User-settable wake phrase (default: "hey any ai")
- **Smart photo capture**: Only take photos when the query requires vision (visual classifier already exists, just needs wiring)
- **Rebranding**: Mentra AI → Any AI (app name, descriptions, publisher → Clavion Labs)

### What We're NOT Changing
- MentraOS SDK integration (session lifecycle, glasses events, auth)
- Query processing pipeline architecture (8-step flow in QueryProcessor)
- Tool implementations (search, calculator, thinking — converted from Mastra `createTool` to AI SDK `tool`)
- Frontend structure (React 19 + Bun + Tailwind)
- SSE streaming, photo management, location, notifications
- TTS/STT (handled entirely by MentraOS SDK — not configurable by the app)
- Deployment setup (Docker)

### Design Principle: Minimal Invasive Changes
The existing codebase works. We modify **only** what's necessary for multi-provider support. No refactoring for its own sake, no new abstractions beyond what the feature requires.

---

## Tech Stack

| Component | Mentra AI 2 (Current) | Any AI (Target) |
|-----------|----------------------|-----------------|
| Runtime | Bun | Bun |
| Backend Framework | Hono (via @mentra/sdk) | Hono (via @mentra/sdk) |
| Frontend | React 19 + Bun + Tailwind | React 19 + Bun + Tailwind |
| Agent Framework | Mastra (hardcoded Gemini) | **Vercel AI SDK (multi-provider)** |
| LLM | Gemini 2.5 Flash only | **OpenAI / Anthropic / Google (user choice)** |
| Vision | Gemini 2.0 Flash Lite (raw API) | **OpenAI / Anthropic / Google (user choice)** |
| Vision Classifier | Gemini 2.0 Flash Lite | **Uses selected vision provider** |
| Database | MongoDB + Mongoose | **Supabase Postgres + Drizzle ORM** |
| API Key Storage | N/A | **Supabase Vault (pgsodium)** |
| Auth | Mentra SDK (cookie-based) | Mentra SDK (cookie-based) — unchanged |
| User Settings | Theme + chatHistory only | **+ provider, apiKeys, models** |
| Real-time | SSE | SSE |
| Deployment | Docker / Porter | **Docker / Railway** |

### New Dependencies

| Package | Purpose |
|---------|---------|
| `ai` | Vercel AI SDK core — `generateText()`, `tool()` (replaces Mastra agent) |
| `@ai-sdk/openai` | OpenAI provider for AI SDK (GPT-4o, GPT-4o-mini, GPT-4.1) |
| `@ai-sdk/anthropic` | Anthropic provider for AI SDK (Claude Sonnet, Haiku) |
| `@ai-sdk/google` | Google provider for AI SDK (Gemini 2.5 Flash, Pro) |
| `drizzle-orm` | TypeScript-native Postgres ORM (replaces Mongoose) |
| `drizzle-kit` | Drizzle migrations and schema tooling (dev dependency) |
| `postgres` | Postgres driver for Drizzle (`postgres.js`) |

### Removed Dependencies

| Package | Reason |
|---------|--------|
| `mongoose` | Replaced by Drizzle ORM + Supabase Postgres |
| `@mastra/core` | Replaced by Vercel AI SDK (`ai` + `@ai-sdk/*` providers) — Mastra was a thin wrapper |

### Key Infrastructure Decisions

1. **Supabase as DB only** — Mentra SDK handles auth (required for glasses pairing). Supabase provides Postgres + Vault. No Supabase Auth, no RLS. All data filtering is done server-side using verified userId.
2. **Server-side auth with SDK middleware** — The SDK provides `createAuthMiddleware()` which verifies the signed session cookie (`aos_session`) and extracts a trusted `userId`. Currently the codebase trusts `?userId=` query params blindly — we'll activate the middleware on all `/api/*` routes so every request has a verified userId from the cookie. All Supabase queries filter by this server-verified userId. See **Core Architecture → Section 9** for details.
3. **Drizzle ORM** — Lightweight, TypeScript-native, excellent Bun compatibility. Schema lives in code, migrations via `drizzle-kit`.
4. **Supabase Vault** — API keys encrypted at the database level via `pgsodium`. Keys are never stored as plaintext. No application-level crypto code needed — encryption/decryption happens in Postgres via `vault.create_secret()` / `vault.decrypted_secrets` view.
5. **Railway deployment** — Docker-based (reuse existing Dockerfile with minor edits). Railway provides env var management, auto-deploy from GitHub, and built-in logging.
6. **Vercel AI SDK** — Direct replacement for Mastra. Mastra was only used in 4 files as a thin wrapper around AI SDK anyway. Using AI SDK directly gives us: fewer dependencies, better Bun compatibility, easier debugging, and first-class multi-provider support via `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`.
7. **TTS/STT** — Both handled entirely by MentraOS SDK (`session.audio.speak()` for TTS, `session.events.onTranscription()` for STT). Not configurable by the app — this is a platform constraint of the Mentra glasses hardware.
8. **Smart photo capture** — A visual query classifier (`isVisualQuery()`) already exists in the codebase with good test coverage but was never wired in. We'll activate it so photos are only taken when the query requires vision analysis. The classifier uses the user's configured LLM provider/key.
9. **Provider configuration required** — Any AI requires the user to configure at least one provider with a valid API key before the assistant will work. There is no fallback to an unconfigured/free-tier mode. Users without configuration see a setup prompt directing them to Settings.

---

## Folder Structure

Only **new or modified** files are annotated. Unmarked files are unchanged from Mentra AI 2.

```
Any-AI/
├── src/
│   ├── index.ts                         # MODIFY: Rebrand startup logs
│   │
│   ├── server/
│   │   ├── MentraAI.ts                  # MODIFY: Reconnect detection — skip welcome on re-sessions
│   │   │
│   │   ├── agent/
│   │   │   ├── MentraAgent.ts           # MODIFY: Accept provider config, use ProviderRegistry
│   │   │   ├── providers/               # NEW DIRECTORY
│   │   │   │   ├── registry.ts          # NEW: ProviderRegistry — maps provider+model to AI SDK model constructor
│   │   │   │   ├── types.ts             # NEW: Provider types, model catalogs, config interfaces
│   │   │   │   └── vision.ts            # NEW: Multi-provider vision classifier (replaces hardcoded Gemini)
│   │   │   ├── visual-classifier.ts     # MODIFY: Delegate to providers/vision.ts
│   │   │   ├── prompt.ts               # MODIFY: Rebrand identity, review system prompt sections
│   │   │   └── tools/                   # MODIFY: Convert createTool() → tool()
│   │   │       ├── index.ts
│   │   │       ├── search.tool.ts       # MODIFY: Mastra createTool → AI SDK tool()
│   │   │       ├── calculator.tool.ts   # MODIFY: Mastra createTool → AI SDK tool()
│   │   │       └── thinking.tool.ts     # MODIFY: Mastra createTool → AI SDK tool()
│   │   │
│   │   ├── manager/
│   │   │   ├── SessionManager.ts        # (unchanged)
│   │   │   ├── TranscriptionManager.ts  # MODIFY: Conditional photo capture (wire in visual classifier)
│   │   │   ├── QueryProcessor.ts        # MODIFY: Pass user's provider config to agent, handle conditional photo
│   │   │   ├── PhotoManager.ts          # (unchanged)
│   │   │   ├── AudioManager.ts          # (unchanged)
│   │   │   ├── LocationManager.ts       # (unchanged)
│   │   │   ├── NotificationManager.ts   # (unchanged)
│   │   │   ├── ChatHistoryManager.ts    # MODIFY: Mongoose → Drizzle queries
│   │   │   ├── InputManager.ts          # (unchanged)
│   │   │   └── StorageManager.ts        # (unchanged)
│   │   │
│   │   ├── session/
│   │   │   └── User.ts                  # MODIFY: Hold user's provider config in memory
│   │   │
│   │   ├── routes/
│   │   │   └── routes.ts                # MODIFY: Add provider settings routes + apply SDK auth middleware
│   │   │
│   │   ├── api/
│   │   │   ├── health.ts               # (unchanged)
│   │   │   ├── stream.ts               # (unchanged)
│   │   │   ├── chat.ts                 # (unchanged)
│   │   │   ├── audio.ts                # (unchanged)
│   │   │   ├── photo.ts                # (unchanged)
│   │   │   ├── storage.ts              # (unchanged)
│   │   │   ├── debug.ts                # (unchanged)
│   │   │   └── settings.ts             # MODIFY: Handle provider config CRUD + key validation
│   │   │
│   │   ├── db/
│   │   │   ├── client.ts               # NEW: Drizzle client + Supabase Postgres connection (replaces connection.ts)
│   │   │   ├── connection.ts            # REMOVE: Replaced by client.ts (Mongoose → Drizzle)
│   │   │   ├── schema.ts               # NEW: Drizzle schema definitions (all tables)
│   │   │   ├── migrate.ts              # NEW: Migration runner
│   │   │   ├── vault.ts                # NEW: Supabase Vault helpers (store/retrieve encrypted API keys)
│   │   │   ├── drizzle/                # NEW: Generated migration files (via drizzle-kit)
│   │   │   └── schemas/                # REMOVE: Mongoose schemas replaced by db/schema.ts
│   │   │       ├── conversation.schema.ts   # REMOVE
│   │   │       └── user-settings.schema.ts  # REMOVE
│   │   │
│   │   ├── utils/
│   │   │   ├── wake-word.ts            # MODIFY: Accept wake word from user settings (per-user configurable)
│   │   │   ├── tts-formatter.ts        # (unchanged)
│   │   │   ├── location-keywords.ts    # (unchanged)
│   │   │   └── text-wrapper.ts         # (unchanged)
│   │   │
│   │   └── constants/
│   │       └── config.ts               # MODIFY: Add provider/model constants and defaults
│   │
│   └── frontend/
│       ├── index.html                   # (unchanged)
│       ├── frontend.tsx                 # (unchanged)
│       ├── App.tsx                      # (unchanged)
│       ├── api/
│       │   └── settings.api.ts          # MODIFY: Add provider config API calls
│       ├── pages/
│       │   ├── ChatInterface.tsx        # (unchanged)
│       │   ├── Settings.tsx             # MODIFY: Add AI Provider configuration section
│       │   └── home/                    # (unchanged)
│       └── components/
│           ├── ProviderSetup.tsx         # NEW: Provider selection + API key entry + model picker
│           └── ui/                      # (unchanged)
│
├── docker/
│   └── Dockerfile                       # (unchanged)
├── package.json                         # MODIFY: Add ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, drizzle-orm, postgres; remove mongoose, @mastra/core
├── tsconfig.json                        # (unchanged)
├── bunfig.toml                          # (unchanged)
├── ANY_AI_PLAN.md                       # NEW: This file
└── README.md                            # MODIFY: Rebrand to Any AI
```

### New Files Summary (9 files)

| File | Purpose |
|------|---------|
| `server/agent/providers/registry.ts` | Maps provider + model selection to AI SDK model constructors, manages API keys |
| `server/agent/providers/types.ts` | TypeScript types: `Provider`, `ModelCatalog`, `ProviderConfig`, `UserAIConfig` |
| `server/agent/providers/vision.ts` | Multi-provider vision API calls (replaces hardcoded Gemini raw API) |
| `server/db/client.ts` | Drizzle ORM client + Supabase Postgres connection pool |
| `server/db/schema.ts` | Drizzle schema: `user_settings`, `conversations`, `conversation_turns` tables |
| `server/db/migrate.ts` | Drizzle migration runner (called on startup) |
| `server/db/vault.ts` | Supabase Vault helpers: `storeApiKey()`, `getApiKey()`, `deleteApiKey()` |
| `frontend/components/ProviderSetup.tsx` | Settings UI: provider picker, API key input, model selector |
| `ANY_AI_PLAN.md` | This architecture plan |

### Removed Files (4 files)

| File | Reason |
|------|--------|
| `server/db/connection.ts` | Mongoose connection → replaced by `db/client.ts` (Drizzle) |
| `server/db/schemas/conversation.schema.ts` | Mongoose schema → replaced by `db/schema.ts` (Drizzle) |
| `server/db/schemas/user-settings.schema.ts` | Mongoose schema → replaced by `db/schema.ts` (Drizzle) |
| `server/db/schemas/index.ts` | Mongoose barrel export → no longer needed |

### Modified Files Summary (15 files)

| File | Change |
|------|--------|
| `server/MentraAI.ts` | Reconnect detection — check for existing session, skip welcome on re-connections |
| `server/agent/MentraAgent.ts` | Replace Mastra `Agent` with AI SDK `generateText()`, accept `UserAIConfig`, resolve model via ProviderRegistry |
| `server/agent/visual-classifier.ts` | Use `providers/vision.ts` instead of raw Gemini API call |
| `server/agent/prompt.ts` | Dynamic identity: inject `agentName`, `llmModelName`, `llmProvider` from UserAIConfig |
| `server/agent/tools/*.ts` | Convert Mastra `createTool()` → AI SDK `tool()` (same schemas, different wrapper) |
| `server/manager/TranscriptionManager.ts` | Wire in `isVisualQuery()` for conditional photo capture instead of always taking photos |
| `server/manager/QueryProcessor.ts` | Pass user's AI config to agent creation, handle conditional photo |
| `server/manager/ChatHistoryManager.ts` | Mongoose queries → Drizzle queries |
| `server/session/User.ts` | Store `UserAIConfig` loaded from DB on session init |
| `server/routes/routes.ts` | Apply SDK auth middleware to all `/api/*` routes, add provider settings routes |
| `server/api/settings.ts` | CRUD for provider config, API key validation via Vault — use verified `c.get("authUserId")` |
| `server/api/*.ts` (all endpoints) | Replace `c.req.query("userId")` with verified `c.get("authUserId")` from auth middleware |
| `server/constants/config.ts` | Provider/model constants, defaults |
| `server/utils/wake-word.ts` | Accept wake word from user settings (per-user, default: "hey any ai") |
| `frontend/api/settings.api.ts` | API client for provider config |
| `frontend/pages/Settings.tsx` | Mount ProviderSetup component |
| `package.json` | Add `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `drizzle-orm`, `postgres`; remove `mongoose`, `@mastra/core` |
| `index.ts` | Replace `connectDB()` with Drizzle client init + rebrand logs |

---

## Core Architecture

### 1. Session Lifecycle (Modified)

Changes from Mentra AI 2 are marked with `★`.

```
MentraOS Device (Glasses)
        ↓
    MentraAI.onSession(session, sessionId, userId)
        ├─ ★ Check if user already has an active session (reconnect detection)
        ├─ If NEW session:
        │   ├─ Create User instance
        │   ├─ Initialize managers (photo, audio, transcription, location, etc.)
        │   ├─ ★ Load user settings + AI config from Supabase (via Drizzle)
        │   ├─ ★ Load decrypted API keys from Supabase Vault
        │   ├─ ★ Store UserAIConfig in User instance (in-memory for session)
        │   ├─ Wire up event listeners
        │   └─ Play welcome message (only on first connect)
        ├─ If RECONNECT (existing user in SessionManager):
        │   ├─ Re-wire AppSession (update session reference)
        │   ├─ Re-attach event listeners
        │   └─ ★ Skip welcome message (user already heard it)
        └─ Log session type: "new" or "reconnect"

SessionManager (singleton)
└─ Map<userId, User>
    ├─ userId: string
    ├─ appSession: AppSession
    ├─ ★ aiConfig: UserAIConfig          # Provider + model selections + decrypted keys
    ├─ photo: PhotoManager
    ├─ transcription: TranscriptionManager
    ├─ queryProcessor: QueryProcessor
    ├─ audio: AudioManager
    ├─ location: LocationManager
    ├─ notifications: NotificationManager
    └─ chatHistory: ChatHistoryManager
```

#### Reconnect Detection (★ NEW)

MentraOS fires `onSession` on every connection — including Bluetooth reconnects, WebSocket recovery, and app foregrounding. Without detection, the welcome audio replays randomly.

```typescript
// In MentraAI.onSession():

const existingUser = sessions.get(userId);
const isReconnect = !!existingUser;

if (isReconnect) {
  // Reconnect — reuse existing user, just update the session reference
  console.log(`🔄 Reconnect for ${userId} (skipping welcome)`);
  existingUser.setAppSession(session);  // Re-wire to new SDK session
  // Re-attach event listeners (onLocation, onPhoneNotifications, etc.)
  // ...
  return;  // Skip welcome, skip re-initialization
}

// First connection — full setup
const user = sessions.getOrCreate(userId);
await user.initialize();
user.setAppSession(session);
// ... wire up event listeners ...
this.playWelcome(session, sessionId);  // Only on first connect
```

### 2. Query Processing Pipeline (Modified)

Only step changes marked with `★`. All other steps are identical to Mentra AI 2.

```
"Hey Any AI, what am I looking at?"
            ↓
┌─────────────────────────────────────────────────────────────────┐
│ TranscriptionManager (★ modified)                               │
│  ├─ Receives transcription from SDK                            │
│  ├─ ★ Detects user's wake word (from user.aiConfig.wakeWord)   │
│  ├─ Play start listening sound (START_LISTENING_SOUND_URL)     │
│  ├─ Locks to speaker (diarization)                             │
│  ├─ Waits for final transcript                                 │
│  ├─ ★ Classify query: isVisualQuery(text) → take photo only if needed │
│  └─ Triggers QueryProcessor.processQuery()                     │
└─────────────────────────────────────────────────────────────────┘
            ↓
┌─────────────────────────────────────────────────────────────────┐
│ QueryProcessor.processQuery(rawText)                            │
│  ├─ Play processing sound (URL from .env: PROCESSING_SOUND_URL) │
│  ├─ Remove wake word from query                                 │
│  ├─ ★ Photo available only if visual classifier triggered it   │
│  ├─ Build context (unchanged):                                  │
│  │   ├─ Photo (current + last 2)                               │
│  │   ├─ Location (lazy - only if query needs it, CACHED)       │
│  │   ├─ Weather (CACHED per session to avoid API bills)        │
│  │   ├─ Local time                                              │
│  │   ├─ Phone notifications                                     │
│  │   └─ Conversation history (last 30 turns, 1hr window)       │
│  ├─ Classify response mode (QUICK/STANDARD/DETAILED)           │
│  ├─ ★ Resolve model via ProviderRegistry(user.aiConfig)        │
│  ├─ ★ Call generateResponse() with resolved model               │
│  ├─ Format response for TTS (if speakers)                      │
│  ├─ Output response (speak or display)                         │
│  ├─ ★ Save to chat history (Supabase via Drizzle)              │
│  └─ Broadcast to webview via SSE                               │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Provider System (NEW)

This is the core new architecture. Three files in `server/agent/providers/`.

#### 3a. Provider Types (`providers/types.ts`)

```typescript
// src/server/agent/providers/types.ts

/** Supported AI providers */
export type Provider = "openai" | "anthropic" | "google";

/** Model definition with metadata */
export interface ModelInfo {
  id: string;            // AI SDK model ID, e.g. "gpt-4o" (provider prefix added by registry)
  name: string;          // Display name, e.g. "GPT-4o"
  provider: Provider;
  supportsVision: boolean;
  contextWindow: number; // For display in UI
}

/** Full catalog of available models per provider */
export const MODEL_CATALOG: Record<Provider, ModelInfo[]> = {
  openai: [
    { id: "gpt-4o",      name: "GPT-4o",      provider: "openai", supportsVision: true,  contextWindow: 128000 },
    { id: "gpt-4o-mini", name: "GPT-4o Mini",  provider: "openai", supportsVision: true,  contextWindow: 128000 },
    { id: "gpt-4.1",     name: "GPT-4.1",      provider: "openai", supportsVision: true,  contextWindow: 1047576 },
    { id: "gpt-4.1-mini",name: "GPT-4.1 Mini", provider: "openai", supportsVision: true,  contextWindow: 1047576 },
    { id: "gpt-4.1-nano",name: "GPT-4.1 Nano", provider: "openai", supportsVision: true,  contextWindow: 1047576 },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5", provider: "anthropic", supportsVision: true,  contextWindow: 200000 },
    { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5",  provider: "anthropic", supportsVision: true,  contextWindow: 200000 },
  ],
  google: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", supportsVision: true, contextWindow: 1048576 },
    { id: "gemini-2.5-pro",   name: "Gemini 2.5 Pro",   provider: "google", supportsVision: true, contextWindow: 1048576 },
  ],
};

/**
 * User's AI configuration — loaded from Supabase on session start,
 * held in memory on the User object for the session duration.
 * API keys are decrypted from Vault only when loaded into memory.
 */
export interface UserAIConfig {
  // Personalization
  agentName: string;     // User-chosen name for their AI assistant (e.g. "Jarvis", "Friday")
  wakeWord: string;      // User-chosen wake phrase (e.g. "hey jarvis")

  // LLM settings
  llmProvider: Provider;
  llmModel: string;      // Model ID from MODEL_CATALOG (e.g. "gpt-4o")
  llmModelName: string;  // Display name from catalog (e.g. "GPT-4o") — for prompt injection
  llmApiKey: string;      // Decrypted — only in memory, never logged

  // Vision settings (separate provider allowed)
  visionProvider: Provider;
  visionModel: string;
  visionApiKey: string;   // Decrypted — may be same key as llmApiKey

  // Metadata
  isConfigured: boolean;  // false until user saves at least one provider
}

/** Default config for users who haven't configured yet */
export const DEFAULT_AI_CONFIG: Omit<UserAIConfig, "llmApiKey" | "visionApiKey"> = {
  agentName: "Any AI",
  wakeWord: "hey any ai",
  llmProvider: "google",
  llmModel: "gemini-2.5-flash",
  llmModelName: "Gemini 2.5 Flash",
  visionProvider: "google",
  visionModel: "gemini-2.5-flash",
  isConfigured: false,
};
```

#### 3b. Provider Registry (`providers/registry.ts`)

```typescript
// src/server/agent/providers/registry.ts

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { UserAIConfig, MODEL_CATALOG, Provider } from "./types";

/**
 * ProviderRegistry resolves a user's AI config into an AI SDK
 * LanguageModel instance ready for generateText().
 *
 * Responsibilities:
 * 1. Validate that the selected model exists in the catalog
 * 2. Create a provider-specific model instance with the user's API key
 * 3. Return a LanguageModel that generateText() can use directly
 *
 * API keys are passed directly to provider constructors (not env vars).
 * This avoids any env var race conditions and is the recommended AI SDK pattern.
 */

export function resolveLLMModel(config: UserAIConfig): LanguageModel {
  // Validate model exists
  const providerModels = MODEL_CATALOG[config.llmProvider];
  const model = providerModels?.find((m) => m.id === config.llmModel);
  if (!model) {
    throw new Error(`Unknown LLM model: ${config.llmModel}`);
  }

  return createModelInstance(config.llmProvider, config.llmModel, config.llmApiKey);
}

export function resolveVisionModel(config: UserAIConfig): {
  model: LanguageModel;
  apiKey: string;
  provider: Provider;
} {
  const providerModels = MODEL_CATALOG[config.visionProvider];
  const model = providerModels?.find((m) => m.id === config.visionModel);
  if (!model) {
    throw new Error(`Unknown vision model: ${config.visionModel}`);
  }
  if (!model.supportsVision) {
    throw new Error(`Model ${config.visionModel} does not support vision`);
  }

  return {
    model: createModelInstance(config.visionProvider, config.visionModel, config.visionApiKey),
    apiKey: config.visionApiKey,
    provider: config.visionProvider,
  };
}

/** Create an AI SDK LanguageModel for the given provider + model + key */
function createModelInstance(provider: Provider, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
  }
}

/** Validate an API key works for a given provider (called from Settings API) */
export async function validateApiKey(provider: Provider, apiKey: string): Promise<boolean> {
  try {
    // Make a minimal API call to verify the key
    switch (provider) {
      case "openai":
        // GET /v1/models — lightweight, returns 401 if invalid
        const oaiRes = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return oaiRes.ok;

      case "anthropic":
        // POST /v1/messages with minimal payload
        const antRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-3-5",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        return antRes.ok;

      case "google":
        // GET models list
        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        return gRes.ok;
    }
  } catch {
    return false;
  }
}
```

#### 3c. Multi-Provider Vision (`providers/vision.ts`)

Replaces the hardcoded Gemini raw API call in `visual-classifier.ts`.

```typescript
// src/server/agent/providers/vision.ts

import { Provider } from "./types";

interface VisionRequest {
  imageBuffer: Buffer;
  prompt: string;
  apiKey: string;
  provider: Provider;
  modelId: string; // e.g. "gpt-4o", "claude-sonnet-4-5-20250514", "gemini-2.5-flash"
}

/**
 * Multi-provider vision API call.
 * Used by visual-classifier.ts for yes/no classification
 * and could be used for standalone vision queries.
 *
 * Each provider has its own API format for image + text.
 * Returns the raw text response from the model.
 */
export async function callVisionAPI(req: VisionRequest): Promise<string> {
  const base64Image = req.imageBuffer.toString("base64");

  switch (req.provider) {
    case "openai":
      return callOpenAIVision(req.modelId, base64Image, req.prompt, req.apiKey);
    case "anthropic":
      return callAnthropicVision(req.modelId, base64Image, req.prompt, req.apiKey);
    case "google":
      return callGeminiVision(req.modelId, base64Image, req.prompt, req.apiKey);
  }
}

async function callOpenAIVision(model: string, base64: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      }],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropicVision(model: string, base64: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        ],
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callGeminiVision(model: string, base64: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 50 },
      }),
    }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
```

### 4. Supabase Vault Integration (NEW)

API keys are encrypted at rest using Supabase Vault (`pgsodium`).

```typescript
// src/server/db/vault.ts

import { db } from "./client";
import { sql } from "drizzle-orm";

/**
 * Store an API key in Supabase Vault.
 * Returns the vault secret ID (UUID) which we store in user_settings.
 *
 * The key name follows the pattern: "apikey:{userId}:{provider}:{purpose}"
 * e.g. "apikey:user123:openai:llm"
 */
export async function storeApiKey(
  userId: string,
  provider: string,
  purpose: "llm" | "vision",
  apiKey: string
): Promise<string> {
  const name = `apikey:${userId}:${provider}:${purpose}`;

  // Upsert: delete existing secret with same name, then insert new one
  await db.execute(sql`
    DELETE FROM vault.secrets WHERE name = ${name}
  `);

  const result = await db.execute(sql`
    SELECT vault.create_secret(${apiKey}, ${name}) as id
  `);

  return result.rows[0].id as string;
}

/**
 * Retrieve a decrypted API key from Vault by secret ID.
 * Returns null if not found.
 */
export async function getApiKey(secretId: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE id = ${secretId}::uuid
  `);

  return (result.rows[0]?.decrypted_secret as string) ?? null;
}

/**
 * Delete an API key from Vault.
 */
export async function deleteApiKey(secretId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM vault.secrets WHERE id = ${secretId}::uuid
  `);
}
```

### 5. Database Schema (Drizzle — replaces Mongoose)

```typescript
// src/server/db/schema.ts

import { pgTable, text, timestamp, boolean, integer, jsonb, uuid, date } from "drizzle-orm/pg-core";

/**
 * User settings — extended with AI provider configuration.
 * API keys are NOT stored here — only Vault secret IDs (UUIDs).
 */
export const userSettings = pgTable("user_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),

  // Existing settings (ported from Mongoose)
  theme: text("theme").notNull().default("dark"),         // "light" | "dark"
  chatHistoryEnabled: boolean("chat_history_enabled").notNull().default(true),

  // ★ NEW: Personalization
  agentName: text("agent_name").notNull().default("Any AI"),  // User-chosen assistant name
  wakeWord: text("wake_word").notNull().default("hey any ai"), // User-chosen wake phrase

  // ★ NEW: LLM provider config
  llmProvider: text("llm_provider").default("google"),    // "openai" | "anthropic" | "google"
  llmModel: text("llm_model").default("gemini-2.5-flash"),
  llmApiKeyVaultId: text("llm_api_key_vault_id"),         // UUID reference to vault.secrets

  // ★ NEW: Vision provider config (can differ from LLM)
  visionProvider: text("vision_provider").default("google"),
  visionModel: text("vision_model").default("gemini-2.5-flash"),
  visionApiKeyVaultId: text("vision_api_key_vault_id"),   // UUID reference to vault.secrets

  // ★ NEW: Tracks whether user has completed provider setup
  isAiConfigured: boolean("is_ai_configured").notNull().default(false),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Conversations — one row per user per day (same structure as Mongoose).
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Conversation turns — individual Q&A pairs within a conversation.
 * Normalized from Mongoose's embedded array to a proper relation.
 */
export const conversationTurns = pgTable("conversation_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  response: text("response").notNull(),
  hadPhoto: boolean("had_photo").notNull().default(false),
  photoTimestamp: integer("photo_timestamp"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});
```

### 6. Agent Architecture (Modified — Mastra → AI SDK)

Replaces Mastra `Agent` with Vercel AI SDK `generateText()`. Changes marked with `★`.

```typescript
// src/server/agent/MentraAgent.ts (modified)

import { generateText, tool } from "ai";                  // ★ AI SDK replaces Mastra
import { searchTool } from "./tools/search.tool";
import { calculatorTool } from "./tools/calculator.tool";
import { thinkingTool } from "./tools/thinking.tool";
import { buildSystemPrompt } from "./prompt";
import { resolveLLMModel } from "./providers/registry";    // ★ NEW
import type { UserAIConfig } from "./providers/types";     // ★ NEW

// ★ AgentContext now includes the user's AI config
interface AgentContext {
  // Device capabilities (unchanged)
  hasDisplay: boolean;
  hasSpeakers: boolean;
  hasCamera: boolean;
  hasMicrophone: boolean;

  // Query context (unchanged)
  responseMode: ResponseMode;

  // Environmental context (unchanged)
  location: LocationContext | null;
  localTime: string;
  notifications: string;
  conversationHistory: ConversationTurn[];

  // ★ NEW: User's AI configuration
  aiConfig: UserAIConfig;
}

/**
 * ★ generateResponse replaces the Mastra Agent pattern.
 * Instead of creating an Agent object, we call generateText() directly
 * with the resolved model, system prompt, and tools.
 */
export async function generateResponse(context: AgentContext, content: any[]) {
  // ★ Resolve AI SDK LanguageModel from user's config
  const model = resolveLLMModel(context.aiConfig);

  const result = await generateText({
    model,                                    // ★ Dynamic — was hardcoded Gemini
    system: buildSystemPrompt(context),
    messages: [{ role: "user", content }],
    tools: {
      search: searchTool,                     // converted to AI SDK tool()
      calculator: calculatorTool,             // converted to AI SDK tool()
      thinking: thinkingTool,                 // converted to AI SDK tool()
    },
    maxSteps: 5,                              // Same as before — allows multi-step tool use
  });

  return result.text;
}
```

```typescript
// Usage in QueryProcessor.processQuery() — only the changed lines:

// BEFORE (Mentra AI 2 — Mastra):
// const agent = createMentraAgent(agentContext);
// const response = await agent.generate(content);

// AFTER (Any AI — AI SDK):
const response = await generateResponse(
  { ...agentContext, aiConfig: user.aiConfig },  // ★ Pass user's provider config
  content,                                        // ★ Content array (text + photos)
);
```

### 7. Config Flow Diagram (NEW)

End-to-end flow of how a user's API key gets from the Settings UI to an AI API call:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SETUP FLOW (happens once in Settings page)                              │
│                                                                         │
│  User enters API key in ProviderSetup.tsx                              │
│       ↓                                                                 │
│  Frontend calls POST /api/settings/provider                            │
│       ↓                                                                 │
│  settings.ts validates key via ProviderRegistry.validateApiKey()       │
│       ↓ (key is valid)                                                  │
│  settings.ts calls vault.storeApiKey() → encrypted in Supabase Vault  │
│       ↓ (returns vaultSecretId UUID)                                    │
│  settings.ts saves vaultSecretId + provider + model to user_settings   │
│       ↓                                                                 │
│  Returns success to frontend (API key is NEVER sent back)              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ SESSION FLOW (happens on every glasses connection)                      │
│                                                                         │
│  MentraAI.onSession(session, sessionId, userId)                        │
│       ↓                                                                 │
│  User.initialize() loads user_settings row via Drizzle                 │
│       ↓                                                                 │
│  Reads vaultSecretIds from user_settings                               │
│       ↓                                                                 │
│  Calls vault.getApiKey(vaultId) to decrypt keys from Vault             │
│       ↓                                                                 │
│  Builds UserAIConfig { llmProvider, llmModel, llmApiKey, ... }         │
│       ↓                                                                 │
│  Stores UserAIConfig on User instance (in-memory only)                 │
│       ↓                                                                 │
│  Session ready — keys decrypted and cached for this session            │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ QUERY FLOW (happens on every wake word query)                          │
│                                                                         │
│  QueryProcessor reads user.aiConfig (already in memory)                │
│       ↓                                                                 │
│  ProviderRegistry.resolveLLMModel(aiConfig)                            │
│    → Creates AI SDK LanguageModel with user's API key                  │
│    → Returns model instance (e.g. openai("gpt-4o"))                    │
│       ↓                                                                 │
│  generateText({ model, system, messages, tools })                      │
│       ↓                                                                 │
│  Response returned to user via glasses (speak or display)              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8. Tool Definitions (MODIFIED — Mastra `createTool` → AI SDK `tool`)

All three tools keep the same logic and Zod schemas. Only the wrapper changes:

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
  parameters: z.object({ ... }),       // "inputSchema" → "parameters"
  execute: async (params) => { ... },  // "context" → direct params
});
```

The three tools (`search.tool.ts`, `calculator.tool.ts`, `thinking.tool.ts`) are provider-agnostic — they don't interact with the LLM provider directly. See `ARCHITECTURE_PLAN.md` for their core logic.

### 9. Auth Architecture (MODIFIED — Server-Side Verified Auth)

The current codebase has a security gap: all API endpoints trust the `?userId=` query parameter blindly. The SDK's auth middleware exists but is never applied. We fix this.

#### Current State (Insecure)

```typescript
// Every API endpoint today:
const userId = c.req.query("userId");  // ❌ Trusts client blindly
const user = sessions.get(userId);
```

#### Target State (Verified Auth)

```typescript
// 1. Apply SDK auth middleware to all /api/* routes in routes.ts:
import { createAuthMiddleware } from "@mentra/sdk";

const authMiddleware = createAuthMiddleware({
  apiKey: API_KEY,
  packageName: PACKAGE_NAME,
  cookieSecret: COOKIE_SECRET,
});

api.use("/*", authMiddleware);  // All /api/* routes now require valid session cookie

// 2. Every API endpoint reads verified userId from middleware context:
const userId = c.get("authUserId");  // ✅ Verified from signed aos_session cookie
const user = sessions.get(userId);
```

#### Auth Flow (End-to-End)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ INITIAL AUTH (happens once when webview opens)                          │
│                                                                         │
│  MentraOS opens webview with signed token in URL                       │
│       ↓                                                                 │
│  Frontend useMentraAuth() extracts token                               │
│       ↓                                                                 │
│  POST /api/mentra/auth/exchange (temp token → userId)                  │
│       ↓                                                                 │
│  SDK validates token with MentraOS Cloud                               │
│       ↓                                                                 │
│  Server sets signed httpOnly cookie: aos_session                       │
│       ↓                                                                 │
│  All subsequent API calls include cookie automatically                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ EVERY API REQUEST                                                       │
│                                                                         │
│  Browser sends request with aos_session cookie                         │
│       ↓                                                                 │
│  Auth middleware verifies cookie signature (cookieSecret)               │
│       ↓                                                                 │
│  Extracts userId from cookie → sets c.get("authUserId")                │
│       ↓                                                                 │
│  Route handler uses verified userId for all DB queries                 │
│       ↓                                                                 │
│  Drizzle queries: .where(eq(table.userId, verifiedUserId))             │
│  Vault queries: key name includes verifiedUserId                       │
│       ↓                                                                 │
│  User can ONLY access their own data — enforced server-side            │
└─────────────────────────────────────────────────────────────────────────┘
```

#### What This Means for Supabase

- **No RLS needed** — the server is the trust boundary, not the database
- **No Supabase Auth** — MentraOS owns auth, we just use Supabase for storage
- **All queries filter by verified userId** — every `SELECT`, `INSERT`, `UPDATE`, `DELETE` includes `WHERE user_id = verifiedUserId`
- **Vault keys are namespaced by userId** — key names follow `apikey:{verifiedUserId}:{provider}:{purpose}`, so one user cannot access another's keys

---

## Manager Specifications

### Unchanged Managers

The following managers require **zero code changes**. See `ARCHITECTURE_PLAN.md` for their full specifications:

- **PhotoManager** — Camera capture, photo storage, SSE broadcasting
- **AudioManager** — TTS / audio control (SDK-controlled, not configurable)
- **LocationManager** — GPS, geocoding, weather (per-session caching)
- **NotificationManager** — Phone notification context
- **InputManager** — Button/touchpad gesture handling
- **StorageManager** — MentraOS simple storage (preferences)
- **SessionManager** — Global user session map

### TranscriptionManager (MODIFIED — Conditional Photo Capture)

**Responsibility:** Wake word detection, speaker locking, transcript handling
**Change:** Wire in `isVisualQuery()` classifier so photos are only taken when the query requires vision analysis.

Currently, `TranscriptionManager` calls `this.user.photo.takePhoto()` unconditionally on every wake word detection. A visual query classifier (`isVisualQuery()` in `visual-classifier.ts`) already exists with good test coverage but was never wired into the production code path.

```typescript
// BEFORE (always takes photo):
this.user.photo.takePhoto();  // Line ~154 — fires on every wake word

// AFTER (conditional photo):
// 1. Detect wake word → start listening for full query
// 2. After query is complete, classify it:
const needsVision = await isVisualQuery(queryText);
if (needsVision) {
  this.user.photo.takePhoto();
}
// 3. Pass query + optional photo to QueryProcessor
```

**Note:** The classifier uses the user's configured LLM provider/key for a fast, lightweight model call (~200-300ms). Since the query text is available before processing begins, this adds minimal latency. If the user has not configured a provider, the app prompts them to configure providers and API keys before Any AI will work — there is no fallback to unconfigured mode.

### ChatHistoryManager (MODIFIED — Mongoose → Drizzle)

**Responsibility:** Conversation storage (unchanged)
**Change:** Replace Mongoose queries with Drizzle queries against Supabase Postgres.

```typescript
// src/server/manager/ChatHistoryManager.ts

import { db } from "../db/client";
import { conversations, conversationTurns } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

class ChatHistoryManager {
  private userId: string;
  private inMemoryTurns: ConversationTurn[] = []; // In-memory cache (unchanged)

  constructor(userId: string) {
    this.userId = userId;
  }

  /** Add a conversation turn — writes to both memory and DB */
  async addTurn(query: string, response: string, hadPhoto = false): Promise<void> {
    const turn = { query, response, hadPhoto, timestamp: new Date() };
    this.inMemoryTurns.push(turn);

    // Get or create today's conversation
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    let [convo] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, this.userId), eq(conversations.date, today)));

    if (!convo) {
      [convo] = await db
        .insert(conversations)
        .values({ userId: this.userId, date: today })
        .returning();
    }

    await db.insert(conversationTurns).values({
      conversationId: convo.id,
      query,
      response,
      hadPhoto,
    });
  }

  /** Get recent turns from memory (for agent context) */
  getRecentTurns(limit = 30): ConversationTurn[] {
    return this.inMemoryTurns.slice(-limit);
  }

  /** Get history by date from DB (for webview) */
  async getHistoryByDate(date: string): Promise<ConversationTurn[]> {
    const [convo] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, this.userId), eq(conversations.date, date)));

    if (!convo) return [];

    return db
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, convo.id))
      .orderBy(conversationTurns.timestamp);
  }
}
```

### QueryProcessor (MODIFIED — pass AI config)

**Responsibility:** Orchestrates the full query → response pipeline (unchanged)
**Change:** 2 lines — pass `user.aiConfig` to agent creation.

```typescript
// Only the changed part of processQuery():

// BEFORE (Mentra AI 2 — Mastra):
// const agent = createMentraAgent(agentContext);
// const response = await agent.generate(content);

// AFTER (Any AI — AI SDK):
const response = await generateResponse(
  { ...agentContext, aiConfig: this.user.aiConfig },  // ★ Pass user's provider config
  content,
);
```

All other QueryProcessor logic (photo capture, context building, TTS formatting, SSE broadcast) is **unchanged**.

---

## System Prompt Design (MODIFIED — Dynamic Agent Identity)

The system prompt is built in `src/server/agent/prompt.ts` across 8 dynamic sections. The identity section is now fully driven by `UserAIConfig`.

### Section 1: Identity (MODIFIED — Dynamic)

The agent name, model name, and provider are all injected from the user's config:

```typescript
function buildIdentitySection(config: UserAIConfig): string {
  // Look up display names from config
  const providerName = PROVIDER_DISPLAY_NAMES[config.llmProvider]; // "OpenAI" | "Anthropic" | "Google"

  return `# ${config.agentName}

I'm ${config.agentName} - I live in these smart glasses and I'm here to help.

My underlying AI model is ${config.llmModelName} (provided by ${providerName}). If anyone asks what model or AI powers me, I share this openly.

If someone asks about the glasses themselves, I mention that these are MentraOS smart glasses.

## Core Principles

- Be direct and concise. Give the answer without filler, commentary, or playful remarks.
- For factual questions, state the fact directly.
- Never refuse reasonable requests - I always try my best.
- Keep responses natural and conversational, like a helpful friend.`;
}
```

**Examples of how this works:**
- User names agent "Jarvis", picks GPT-4o → `"I'm Jarvis... My underlying AI model is GPT-4o (provided by OpenAI)."`
- User names agent "Friday", picks Claude Sonnet → `"I'm Friday... My underlying AI model is Claude Sonnet 4.5 (provided by Anthropic)."`
- User keeps default → `"I'm Any AI... My underlying AI model is Gemini 2.5 Flash (provided by Google)."`

### Sections 2-8: Unchanged
- **Section 2 — Device Capabilities**: Lists hardware available on the connected glasses
- **Section 3 — Response Format**: Word limits per mode (QUICK/STANDARD/DETAILED)
- **Section 4 — Tool Usage**: Direct answers first, search for real-time data, calculator, thinking
- **Section 5 — Vision**: Dynamic — included when photo is available, fallback when capture failed
- **Section 6 — Context**: Injects chat history + location + time (dynamically built per query)
- **Section 7 — TTS Format**: Speaker glasses only — spell out numbers, units, abbreviations
- **Section 8 — Display Format**: HUD glasses only — 15 words max, symbols OK

---

## Response Modes (UNCHANGED)

Response mode classification is **unchanged**. See `ARCHITECTURE_PLAN.md` for details.

| Mode | Speaker Glasses (words) | HUD Glasses (words) | Triggered By |
|------|-------------------------|---------------------|--------------|
| QUICK | 17 | 15 | Simple questions, facts |
| STANDARD | 50 | 15 | "How to", recommendations |
| DETAILED | 100 | 15 | "Explain", "why", complex |

---

## Database Schema (REPLACED — see Core Architecture Section 5)

The Mongoose schemas have been replaced with Drizzle schema definitions in `src/server/db/schema.ts`. See **Core Architecture → Section 5** for the complete Drizzle schema.

**Migration from Mongoose:**
- `Conversation` model → `conversations` + `conversation_turns` tables (normalized)
- `UserSettings` model → `user_settings` table (extended with AI config fields)
- Embedded `turns[]` array → proper `conversation_turns` relation with foreign key

---

## API Endpoints

### Existing APIs (UNCHANGED)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/chat/stream` | SSE for real-time chat updates |
| GET | `/api/photo-stream` | SSE for photo updates |
| GET | `/api/transcription-stream` | SSE for live transcription |
| POST | `/api/speak` | Text-to-speech |
| POST | `/api/stop-audio` | Stop audio playback |
| GET | `/api/theme-preference` | Get theme |
| POST | `/api/theme-preference` | Set theme |
| GET | `/api/latest-photo` | Get most recent photo |
| GET | `/api/photo/:requestId` | Get photo by request ID |
| GET | `/api/photo-base64/:requestId` | Get photo as base64 |
| GET | `/api/settings` | Get user settings |
| PATCH | `/api/settings` | Update user settings (theme, chatHistory) |

### New Provider Config APIs (★ NEW)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/provider` | Get user's provider config (providers, models — **never returns API keys**) |
| POST | `/api/settings/provider` | Save provider config (provider, model, API key → validates key, stores in Vault) |
| POST | `/api/settings/provider/validate` | Validate an API key without saving (used for real-time UI feedback) |
| DELETE | `/api/settings/provider/:purpose` | Remove a provider config (purpose = "llm" or "vision"), deletes Vault secret |
| GET | `/api/providers/catalog` | Get available providers and models (static catalog from `types.ts`) |

#### Provider Config API Details

**`POST /api/settings/provider`** — The main endpoint for saving provider configuration.

```typescript
// Request body:
{
  purpose: "llm" | "vision",
  provider: "openai" | "anthropic" | "google",
  model: "gpt-4o",               // Model ID from MODEL_CATALOG
  apiKey: "sk-..."                // Plaintext — validated then encrypted in Vault
}

// Response (success):
{
  success: true,
  provider: "openai",
  model: "gpt-4o",
  purpose: "llm"
  // NOTE: apiKey is NEVER returned
}

// Response (invalid key):
{
  success: false,
  error: "API key validation failed for provider openai"
}
```

**`GET /api/settings/provider`** — Returns current config without keys.

```typescript
// Response:
{
  agentName: "Jarvis",
  wakeWord: "hey jarvis",
  llm: {
    provider: "openai",
    model: "gpt-4o",
    isConfigured: true           // Has a valid Vault secret
  },
  vision: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250514",
    isConfigured: true
  }
}
```

**`GET /api/providers/catalog`** — Static model catalog for the frontend dropdown.

```typescript
// Response:
{
  providers: {
    openai: {
      name: "OpenAI",
      models: [
        { id: "gpt-4o", name: "GPT-4o", supportsVision: true, contextWindow: 128000 },
        { id: "gpt-4o-mini", name: "GPT-4o Mini", supportsVision: true, contextWindow: 128000 },
        // ...
      ]
    },
    anthropic: { ... },
    google: { ... }
  }
}
```

---

## Frontend: ProviderSetup Component (NEW)

New component mounted in Settings.tsx for provider configuration.

### UI Layout

```
┌─────────────────────────────────────────┐
│  AI Assistant Settings                   │
│                                          │
│  ┌─ Personalization ─────────────────┐  │
│  │  Assistant Name: [Jarvis       ]   │ │
│  │  Wake Word:      [hey jarvis   ]   │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ┌─ LLM (Chat) ──────────────────────┐ │
│  │  Provider:  [OpenAI ▾]             │ │
│  │  Model:     [GPT-4o ▾]            │ │
│  │  API Key:   [sk-••••••••] [Test]   │ │
│  │  Status:    ✅ Connected            │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ☐ Use same provider for vision          │
│                                          │
│  ┌─ Vision (Camera) ─────────────────┐  │
│  │  Provider:  [Anthropic ▾]          │ │
│  │  Model:     [Claude Sonnet 4.5 ▾]  │ │
│  │  API Key:   [sk-ant-••••] [Test]   │ │
│  │  Status:    ✅ Connected            │ │
│  └────────────────────────────────────┘ │
│                                          │
│  [Save Configuration]                    │
└─────────────────────────────────────────┘
```

### Component Behavior

1. **On mount**: Fetch `GET /api/settings/provider` + `GET /api/providers/catalog`
2. **Provider dropdown**: Filters model dropdown to show only that provider's models
3. **Vision filter**: Only shows models where `supportsVision: true`
4. **"Use same provider" checkbox**: Copies LLM config to vision (hides vision section)
5. **Test button**: Calls `POST /api/settings/provider/validate` — shows green check or red X
6. **Save button**: Calls `POST /api/settings/provider` for LLM and vision separately
7. **API key display**: Always masked (`sk-••••••••`), never fetched from server after save

---

## Implementation Phases

These phases are designed for **Claude Code agent team execution**. Each phase is independently testable and has clear inputs/outputs. Phases are sequential — each depends on the previous.

### MCP Servers Available

The following MCP servers are installed and available to Claude Code agents during implementation:

| MCP Server | Purpose |
|------------|---------|
| **Supabase** | Create/manage Supabase project, run SQL, manage extensions (Vault), inspect tables |
| **Railway** | Create/manage Railway project, deploy services, set env vars, view logs |
| **GitHub** | Repo management, PRs, issues, Actions workflows |

**Note:** Vercel AI SDK is an npm package — it does **not** require a Vercel platform account or project. No Vercel MCP server is needed.

### Phase 0: Infrastructure Setup (Supabase + Railway)

**Goal:** Supabase project and Railway project created and configured. Database ready for schema migration. Deployment pipeline ready.

**This phase is done manually or via MCP before code changes begin.**

#### 0a. Supabase Project Setup

1. Create a new Supabase project (name: `any-ai`, region: closest to target users)
2. Note the project's connection string (`DATABASE_URL`) from Settings → Database → Connection string (use "Transaction" mode pooler URI for serverless compatibility)
3. Enable the Vault extension — run in SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
   ```
4. Verify Vault is active:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'supabase_vault';
   ```
5. (Optional) Create a `service_role` connection for Vault operations if needed — Vault requires elevated privileges (`service_role` key, not `anon` key)
6. Save `DATABASE_URL` to `.env` locally for development

**Supabase MCP verification:** Use the Supabase MCP server to confirm:
- Project is accessible
- Vault extension is enabled
- Can execute SQL queries

#### 0b. Railway Project Setup

1. Create a new Railway project (name: `any-ai`)
2. Add a **Docker** service pointing to the GitHub repo (`mentra-anyai/Any-AI`)
3. Configure build settings:
   - Builder: Dockerfile (`docker/Dockerfile`)
   - Watch paths: `src/**`, `package.json`, `docker/**`
4. Set environment variables in Railway:
   - `DATABASE_URL` — Supabase Postgres connection string (from step 0a)
   - `PORT` — `80` (Railway default)
   - `HOST` — `0.0.0.0`
   - `NODE_ENV` — `production`
   - `PACKAGE_NAME` — MentraOS package identifier
   - `MENTRAOS_API_KEY` — SDK authentication key
   - `COOKIE_SECRET` — Auth cookie signing secret (generate a new one)
   - `GOOGLE_MAPS_API_KEY` — For geocoding/location feature
   - `JINA_API_KEY` — For web search tool
   - `WELCOME_SOUND_URL` — Audio URL for welcome message
   - `PROCESSING_SOUND_URL` — Audio URL for processing indicator
   - `START_LISTENING_SOUND_URL` — Audio URL when wake word detected
5. Configure custom domain or use Railway-provided URL
6. Do **not** enable auto-deploy yet — wait until Phase 6

**Railway MCP verification:** Use the Railway MCP server to confirm:
- Project exists and service is configured
- Environment variables are set
- Can view deployment status

#### 0c. GitHub Repository Setup

1. Ensure the `Any-AI` repo is connected to both Railway (for deployment) and has branch protection on `main`
2. Create a `develop` branch for implementation work (Phases 1-5 happen here)
3. PRs merge `develop` → `main` → triggers Railway deploy (enabled in Phase 6)

**Verification:** Supabase project accessible with Vault enabled. Railway project created with all env vars. GitHub repo connected to Railway.

---

### Phase 1: Rebranding + Dependencies + Framework Swap

**Goal:** Any AI identity established, Mastra replaced with AI SDK, new dependencies installed, old ones removed.

**Agent tasks:**
1. Update `package.json`: name → `any-ai`, author → `Clavion Labs`, description updated
2. Install new deps: `bun add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google drizzle-orm postgres`
3. Install dev dep: `bun add -d drizzle-kit`
4. Remove old deps: `bun remove mongoose @mastra/core`
5. Update `README.md` with Any AI branding
6. Update startup logs in `index.ts` ("Mentra AI" → "Any AI")
7. Update `prompt.ts`: Replace hardcoded "Mentra AI" identity with dynamic `buildIdentitySection(config)`, remove hardcoded `LLM_MODEL`/`LLM_PROVIDER` env vars, accept `UserAIConfig` for agent name, model name, and provider injection (see System Prompt Design section)
8. Convert `MentraAgent.ts`: Replace Mastra `Agent` with AI SDK `generateText()`, accept `UserAIConfig`, use `resolveLLMModel()` (see Section 6)
9. Convert tools (`search.tool.ts`, `calculator.tool.ts`, `thinking.tool.ts`): Mastra `createTool()` → AI SDK `tool()` (see Section 8)
10. Update `wake-word.ts`: Accept wake word as a parameter (from user settings) instead of hardcoded array
11. Update `MentraAI.ts`: Add reconnect detection — check `sessions.get(userId)` before setup, skip welcome + re-initialization on reconnects (see Section 1)
12. Update welcome text/audio references: "Mentra AI" → user's agent name (or "Any AI" default)

**Verification:** `bun run dev` starts without errors (DB connection will warn since Supabase not configured yet).

### Phase 2: Database Migration + Auth Hardening

**Goal:** All database operations use Drizzle + Supabase Postgres. MongoDB fully removed. API endpoints use verified auth.

**Prerequisites:** Phase 0 complete — Supabase project created with Vault enabled, `DATABASE_URL` in `.env`.

**Agent tasks:**
1. Create `src/server/db/client.ts` — Drizzle client with `postgres` driver
2. Create `src/server/db/schema.ts` — All table definitions (from Core Architecture Section 5, includes `agent_name` and `wake_word` columns)
3. Create `drizzle.config.ts` at project root for `drizzle-kit`
4. Run `bunx drizzle-kit generate` to create migration SQL
5. Run `bunx drizzle-kit migrate` to apply to Supabase (use Supabase MCP to verify tables created)
6. Rewrite `ChatHistoryManager.ts` — Mongoose → Drizzle queries
7. Rewrite settings queries in `api/settings.ts` — Mongoose → Drizzle
8. Update `User.ts` → `initialize()` loads settings via Drizzle instead of Mongoose
9. Update `index.ts` — Replace `connectDB()` with Drizzle client import (Drizzle connects lazily)
10. Remove old files: `db/connection.ts`, `db/schemas/` directory
11. Create `src/server/db/vault.ts` — Vault helper functions (from Core Architecture Section 4)
12. **Apply SDK auth middleware** to all `/api/*` routes in `routes.ts` using `createAuthMiddleware()` (see Section 9)
13. **Replace all `c.req.query("userId")`** with verified `c.get("authUserId")` across all API endpoint files (`chat.ts`, `stream.ts`, `photo.ts`, `settings.ts`, `audio.ts`, `storage.ts`, `debug.ts`)

**Verification:** `bun run dev` starts, connects to Supabase. Settings and chat history work via frontend webview. API calls without a valid session cookie return 401.

### Phase 3: Provider System (Backend)

**Goal:** Multi-provider agent creation works. Can switch between OpenAI/Anthropic/Google. Smart photo capture active.

**Agent tasks:**
1. Create `src/server/agent/providers/types.ts` — Types + model catalog (from Core Architecture Section 3a)
2. Create `src/server/agent/providers/registry.ts` — Model resolution with AI SDK constructors (from Section 3b)
3. Create `src/server/agent/providers/vision.ts` — Multi-provider vision calls (from Section 3c)
4. Modify `visual-classifier.ts` — Delegate to `providers/vision.ts` instead of hardcoded Gemini; uses user's LLM key
5. Modify `TranscriptionManager.ts` — Wire in `isVisualQuery()` for conditional photo capture (only take photo when query requires vision)
6. Modify `User.ts` — Add `aiConfig: UserAIConfig` property, load from DB + Vault on init
7. Modify `QueryProcessor.ts` — Pass `user.aiConfig` to `generateResponse()`, handle conditional photo availability
8. Modify `constants/config.ts` — Add default provider/model constants

**Verification:** Set API keys manually in Supabase Vault + user_settings, restart app. Queries should route to the configured provider. Test with each provider: OpenAI, Anthropic, Google. Verify photos are only taken for visual queries ("what am I looking at?" → photo taken; "what's the weather?" → no photo).

### Phase 4: Provider Settings API

**Goal:** Backend API for saving/loading/validating provider configs. All endpoints use verified userId from auth middleware.

**Agent tasks:**
1. Add routes to `routes.ts`: GET/POST/DELETE `/api/settings/provider`, POST `/api/settings/provider/validate`, GET `/api/providers/catalog`
2. Implement handlers in `api/settings.ts` (all use `c.get("authUserId")` for verified identity):
   - `GET /api/settings/provider` — Load from `user_settings` WHERE `user_id = authUserId`, return without keys
   - `POST /api/settings/provider` — Validate key → store in Vault (namespaced by authUserId) → save vault ID to user_settings
   - `POST /api/settings/provider/validate` — Validate key without saving
   - `DELETE /api/settings/provider/:purpose` — Delete Vault secret + clear user_settings fields
   - `GET /api/providers/catalog` — Return static `MODEL_CATALOG`
3. Update `frontend/api/settings.api.ts` — Add API client functions for all new endpoints

**Verification:** Test all endpoints via curl/REST client. API keys stored in Vault, never returned in responses.

### Phase 5: Frontend (ProviderSetup UI)

**Goal:** Users can configure their AI provider through the Settings page.

**Agent tasks:**
1. Create `frontend/components/ProviderSetup.tsx` — Full component (see Frontend section above)
2. Modify `frontend/pages/Settings.tsx` — Mount ProviderSetup component in settings page
3. Style with existing Tailwind + Radix UI components (match existing design system)

**Verification:** Open webview, navigate to Settings, configure a provider with API key. Key validated, saved. Switch to different provider, verify agent uses new provider on next query.

### Phase 6: Deployment + Polish

**Goal:** Deployed on Railway, all features working end-to-end.

**Prerequisites:** Phase 0 complete — Railway project created with env vars set.

**Agent tasks:**
1. Update `Dockerfile` — Remove MongoDB references, ensure Bun + Postgres driver compatible
2. Remove `porter.yaml` (no longer used)
3. Enable auto-deploy in Railway (connect to GitHub `main` branch via Railway MCP or dashboard)
4. Deploy to Railway — merge `develop` → `main` to trigger first deploy
5. Verify deployment via Railway MCP — check service status, view logs, confirm health endpoint responds
6. Test full flow: Settings → Provider setup → Glasses connection → Query → Response
7. Error handling: What happens when user has no provider configured? (Show setup prompt)
8. Error handling: What happens when API key is revoked mid-session? (Graceful error message)

**Verification:** Full end-to-end test on Railway:
- Configure OpenAI via Settings → Ask "What am I looking at?" → Get response from GPT-4o
- Switch to Anthropic → Same query → Response from Claude
- Switch to Google → Same query → Response from Gemini

---

## Environment Variables

### Kept from Mentra AI 2
- `PORT` — Server port (default: 3000, Railway: 80)
- `PACKAGE_NAME` — MentraOS package identifier
- `MENTRAOS_API_KEY` — SDK authentication
- `COOKIE_SECRET` — Auth cookie signing
- `GOOGLE_MAPS_API_KEY` — For geocoding (location feature)
- `JINA_API_KEY` — Web search tool
- `WELCOME_SOUND_URL` — Audio URL for welcome message
- `PROCESSING_SOUND_URL` — Audio URL for processing indicator
- `START_LISTENING_SOUND_URL` — Audio URL when wake word detected
- `HOST` — Server bind host (default: 0.0.0.0)
- `NODE_ENV` — `development` or `production`

### New for Any AI
- `DATABASE_URL` — Supabase Postgres connection string (set in Phase 0a, replaces `MONGODB_URI`)

### Removed
- `MONGODB_URI` — Replaced by `DATABASE_URL`
- `GOOGLE_GENERATIVE_AI_API_KEY` — No longer a server env var; users provide their own keys
- `LLM_MODEL` — No longer hardcoded; users select in Settings
- `LLM_PROVIDER` — No longer hardcoded; users select in Settings

### Note on Provider API Keys
Individual provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) are **NOT** set as server environment variables. They are stored per-user in Supabase Vault and passed directly to AI SDK provider constructors per-request by the ProviderRegistry (e.g., `createOpenAI({ apiKey })`). No environment variable injection needed.

---

## Success Criteria

All Mentra AI 2 success criteria still apply (wake word, photo, location, weather, search, TTS). The following are **additional** criteria for Any AI:

### Multi-Provider
1. **OpenAI works**: Configure GPT-4o via Settings → Ask a question → Get response
2. **Anthropic works**: Configure Claude Sonnet → Ask a question → Get response
3. **Google works**: Configure Gemini Flash → Ask a question → Get response
4. **Provider switching**: Change provider in Settings → Next query uses new provider

### Separate Vision
5. **Mixed providers**: LLM = Claude, Vision = GPT-4o → "What am I looking at?" uses GPT-4o for vision, Claude for text response
6. **Same provider shortcut**: "Use same provider" checkbox copies LLM config to vision

### API Key Security
7. **Keys encrypted at rest**: API keys stored in Supabase Vault, not in `user_settings` table
8. **Keys never returned**: GET endpoints never include API keys in responses
9. **Keys validated on save**: Invalid keys rejected with clear error message

### Personalization
10. **Custom agent name**: User sets name to "Jarvis" → system prompt says "I'm Jarvis", agent responds as Jarvis
11. **Custom wake word**: User sets wake word to "hey jarvis" → glasses respond to "hey jarvis" instead of default
12. **Dynamic model identity**: System prompt reflects the user's actual selected model and provider name

### Auth & Security
13. **Verified auth on all endpoints**: All `/api/*` routes require valid `aos_session` cookie — requests without one return 401
14. **No query param userId**: No endpoint reads userId from `?userId=` query params — all use `c.get("authUserId")` from middleware
15. **User data isolation**: User A cannot access User B's settings, API keys, or conversation history

### Settings UX
16. **Provider catalog loads**: Settings page shows all available providers and models
17. **Key validation feedback**: "Test" button gives immediate pass/fail feedback
18. **No-config setup gate**: User without a configured provider sees a clear setup prompt directing them to Settings — the assistant does not attempt to process queries without a valid provider/key

---

## References

- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs) — Core framework (`generateText`, `tool`)
- [AI SDK Providers](https://sdk.vercel.ai/providers) — OpenAI, Anthropic, Google provider packages
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- [Supabase Postgres](https://supabase.com/docs/guides/database/overview)
- [@mentra/sdk Documentation](internal)
- [Hono Documentation](https://hono.dev/)
- [Railway Deployment](https://docs.railway.app/)
- [Original Mentra AI 2 Architecture](./ARCHITECTURE_PLAN.md)

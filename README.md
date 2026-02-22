<p align="center">
  <img src="https://mentra-store-cdn.mentraglass.com/mini_app_assets/com.clavionlabs.anyai/1771730415158-any-ai-logo-2.png" alt="Any AI Logo" width="120" height="120" />
</p>

<h1 align="center">Any AI</h1>

<p align="center">
  <strong>A multi-provider, bring-your-own-key AI assistant for MentraOS smart glasses</strong>
</p>

<p align="center">
  Choose your AI provider (OpenAI, Anthropic, or Google), add your API key, and pick your model.<br/>
  Say "Hey Any AI", ask a question, and get a concise spoken or displayed response.<br/>
  See what you see. Search the web. Remember context.
</p>

---

## What It Does

Any AI is an intelligent voice assistant for MentraOS smart glasses. It adapts to your hardware — whether your glasses have a HUD display, camera, or speakers — and delivers responses in the most appropriate format.

- **Voice activation** — Say "Hey Any AI" to start (customizable wake word)
- **Conversational follow-up** — After the AI responds, the mic stays open for 5 seconds so you can ask follow-up questions without repeating the wake word
- **Multi-provider** — Choose between OpenAI, Anthropic, or Google
- **Bring your own key** — Use your own API keys, stored securely in Supabase Vault
- **Vision** — Answers questions about what you're seeing (smart photo capture)
- **Web search** — Real-time search with concise summaries via Jina
- **Context aware** — Knows your location, time, weather, and conversation history
- **Timezone detection** — Auto-detects your timezone from GPS when the OS doesn't provide it
- **Personalization** — Custom assistant name, wake word, and model selection per user
- **Audio & visual feedback** — Green LED on wake word, audio cues for listening/processing states, personalized TTS welcome message

## What Changed from Mentra AI 2

Any AI is a fork of [Mentra AI 2](https://github.com/mentra-app/mentra-ai-2) with significant architectural changes:

### Multi-Provider AI (was single-provider Gemini only)

| | Mentra AI 2 | Any AI |
|---|---|---|
| **Providers** | Google Gemini only | OpenAI, Anthropic, Google |
| **API keys** | Single server env var | Per-user, encrypted in Supabase Vault |
| **Model selection** | Hardcoded | User picks from model catalog in Settings |
| **Vision provider** | Same as LLM | Independently configurable |

### Framework Swap

| | Mentra AI 2 | Any AI |
|---|---|---|
| **AI framework** | Mastra (`@mastra/core`) | Vercel AI SDK (`ai`, `@ai-sdk/*`) |
| **Database** | MongoDB / Mongoose | PostgreSQL / Drizzle ORM / Supabase |
| **Secret storage** | Plaintext in DB | Supabase Vault (pgsodium encryption) |
| **Auth** | `?userId=` query params | SDK cookie auth (`aos_session`) on all routes |
| **Deployment** | Porter | Railway (Docker) |

### Key Technical Changes

- **Agent rewrite** — Replaced `@mastra/core` `Agent` class with direct `generateText()` calls from Vercel AI SDK
- **Tool conversion** — Mastra `createTool()` → AI SDK `tool()` (search, calculator, thinking tools)
- **Provider registry** — `ProviderRegistry` resolves `UserAIConfig` → AI SDK `LanguageModel` at runtime
- **Smart photo capture** — `isVisualQuery()` classifier determines if camera photo is needed before taking one
- **Dynamic identity** — System prompt reflects user's chosen assistant name, model, and provider
- **Auth hardening** — All `/api/*` routes require verified `aos_session` cookie; no endpoint reads userId from query params
- **Row Level Security** — RLS enabled on all Supabase tables for defense-in-depth

### Supported Models

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-5.2, GPT-5.1, GPT-5, GPT-5 Mini, GPT-4o, GPT-4o Mini, GPT-4.1, GPT-4.1 Mini |
| **Anthropic** | Claude Opus 4.6, Claude Sonnet 4.6, Claude Sonnet 4.5, Claude Haiku 4.5 |
| **Google** | Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.5 Pro |

## Architecture

```
src/
├── index.ts                          # Bun.serve + Hono entry point
├── public/assets/audio/              # Audio cues (start, processing, welcome)
├── server/
│   ├── MentraAI.ts                   # AppServer lifecycle (onSession/onStop)
│   ├── agent/
│   │   ├── MentraAgent.ts            # AI SDK generateText() wrapper
│   │   ├── prompt.ts                 # Dynamic system prompt builder
│   │   ├── providers/
│   │   │   ├── types.ts              # UserAIConfig, MODEL_CATALOG, Provider
│   │   │   ├── registry.ts           # ProviderRegistry (resolve config → model)
│   │   │   └── vision.ts             # Multi-provider vision API
│   │   └── tools/                    # AI SDK tool definitions
│   ├── db/
│   │   ├── client.ts                 # Drizzle + postgres connection
│   │   ├── schema.ts                 # user_settings, conversations, turns
│   │   └── vault.ts                  # Supabase Vault helpers (store/retrieve/delete)
│   ├── manager/
│   │   ├── ChatHistoryManager.ts     # Drizzle-based conversation persistence
│   │   ├── LocationManager.ts        # GPS, geocoding, weather, timezone detection
│   │   ├── QueryProcessor.ts         # Query pipeline (transcription → agent → TTS)
│   │   └── TranscriptionManager.ts   # Wake word, follow-up mode, audio/LED feedback
│   ├── routes/routes.ts              # Hono routes + SDK auth middleware
│   ├── api/settings.ts               # Settings + provider config handlers
│   └── session/User.ts               # Per-user state + aiConfig from DB/Vault
└── frontend/
    ├── App.tsx                       # React app with routing
    ├── pages/Settings.tsx            # Settings page
    ├── components/ProviderSetup.tsx   # Provider config UI
    └── api/settings.api.ts           # Frontend API client
```

## Interaction Flow

```
User says wake word → Green LED flash → Start listening sound
  → User speaks query → Silence detected → Processing sound loops
    → AI generates response → TTS speaks response
      → Follow-up mode (green LED 2s, mic open 5s)
        → User speaks again (no wake word needed) → repeat
        → Silence for 5s → return to idle (wake word required)
```

## Supported Glasses

| Type | Input | Output |
|------|-------|--------|
| HUD + Mic | Voice | Text on display |
| Camera + Speaker + Mic | Voice + Camera | Spoken responses + Green LED feedback |

## Getting Started

### Prerequisites

1. Install MentraOS: [get.mentraglass.com](https://get.mentraglass.com)
2. Install Bun: [bun.sh](https://bun.sh/docs/installation)
3. Set up ngrok: `brew install ngrok` and create a [static URL](https://dashboard.ngrok.com/)

### Register Your App

1. Go to [console.mentra.glass](https://console.mentra.glass/)
2. Sign in and click "Create App"
3. Set a unique package name (e.g., `com.yourName.anyAI`)
4. Enter your ngrok URL as "Public URL"
5. Add **microphone** and **camera** permissions

### Run It

```bash
# Install
git clone https://github.com/cclavio/Any-AI.git
cd Any-AI
bun install
cp .env.example .env.local

# Configure .env.local with your credentials (see Environment Variables below)

# Start
bun run dev

# Expose via ngrok
ngrok http --url=<YOUR_NGROK_URL> 3000
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `PACKAGE_NAME` | Yes | MentraOS package identifier |
| `MENTRAOS_API_KEY` | Yes | SDK authentication key from Developer Console |
| `DATABASE_URL` | Yes | Supabase Postgres connection string (pooler/transaction mode) |
| `COOKIE_SECRET` | Yes | Secret for signing auth cookies (`openssl rand -hex 32`) |
| `PUBLIC_URL` | Yes | Base URL for serving static assets (e.g., `http://localhost:3000`) |
| `JINA_API_KEY` | No | Jina API key for web search tool |
| `GOOGLE_MAPS_API_KEY` | No | Google Maps key for geocoding, timezone detection, and weather. Enable Geocoding API, Time Zone API in Google Cloud Console |

Individual AI provider API keys (OpenAI, Anthropic, Google) are **not** server env vars — they are stored per-user in Supabase Vault and entered via the Settings UI.

## Documentation

- [MentraOS Docs](https://docs.mentra.glass)
- [Developer Console](https://console.mentra.glass)
- [Architecture Plan](./ANY_AI_PLAN.md)

## License

MIT

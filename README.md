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

- **Voice activation** — Say "Hey Any AI" to start (customizable wake word), or single-press the action button
- **Conversational follow-up** — After the AI responds, the mic stays open for 10 seconds so you can ask follow-up questions without repeating the wake word
- **Voice commands** — Say "take a photo", "what's my battery?", or "what's my schedule?" for instant device responses (bypasses the AI pipeline)
- **Multi-provider** — Choose between OpenAI, Anthropic, or Google
- **Bring your own key** — Use your own API keys, stored securely in Supabase Vault
- **Vision** — Answers questions about what you're seeing (smart photo capture with shutter sound feedback)
- **Photo persistence** — Photos from "take a photo" are stored in Supabase Storage with metadata in Postgres, surviving server restarts
- **Web search** — Real-time search with concise summaries via Jina
- **Location services** — Nearby places, directions, weather, air quality, and pollen data (optional Google Cloud API key)
- **Battery check** — Ask "what's my battery?" for instant glasses battery level and charging status
- **Calendar aware** — Receives calendar events from your phone; ask "what's my schedule?" for an instant readout, or ask the AI questions like "when is my next meeting?"
- **Context aware** — Knows your location, date, time, weather, calendar, and conversation history
- **Conversation persistence** — History hydrated from DB on session start; 8-hour context window covers a full working day
- **Session resilience** — Survives network blips and idle socket timeouts with a 5-minute grace period; no "Welcome" replay on reconnect
- **Timezone detection** — Auto-detects your timezone from GPS when the OS doesn't provide it
- **Personalization** — Custom assistant name, wake word, and model selection per user
- **Audio & visual feedback** — Green LED on wake word, shutter sound on photo capture, audio cues for listening/processing states, personalized TTS welcome message
- **Hardware button** — Single press the action button to activate the listener (no wake word needed)

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
- **Tool conversion** — Mastra `createTool()` → AI SDK `tool()` (search, calculator, thinking, nearby places, directions)
- **Provider registry** — `ProviderRegistry` resolves `UserAIConfig` → AI SDK `LanguageModel` at runtime
- **Smart photo capture** — `isVisualQuery()` classifier determines if camera photo is needed before taking one
- **Voice-activated photo capture** — "Take a photo" voice command saves directly to camera roll via device command classifier, bypassing the AI pipeline
- **Battery voice command** — "What's my battery?" reads glasses battery level and charging status instantly via device state API
- **Calendar integration** — `CalendarManager` receives events via `onCalendarEvent`, persists to generic `user_context` table, hydrates on reconnect, and injects schedule into AI context
- **Dynamic date context** — LLM receives the current date and time (not just time), so date-related questions are always accurate
- **Enhanced capabilities prompt** — "What can you do?" returns a comprehensive feature list tailored to the connected hardware
- **Single-press listener** — Action button changed from double-press to single press for faster activation
- **Dynamic identity** — System prompt reflects user's chosen assistant name, model, and provider
- **Auth hardening** — All `/api/*` routes require verified `aos_session` cookie; no endpoint reads userId from query params
- **Row Level Security** — RLS enabled on all Supabase tables for defense-in-depth
- **Per-user Google Cloud key** — Location services (geocoding, weather, air quality, pollen, places, directions, timezone) use a per-user API key stored in Vault, with graceful fallbacks when unconfigured
- **Session resilience** — `onStop()` uses soft disconnect with a 5-minute grace period instead of destroying user state immediately; glasses reconnects are seamless with no welcome replay
- **Conversation hydration** — `ChatHistoryManager.initialize()` loads today's turns from DB on session start so prior context survives server restarts
- **Vision error handling** — Failed photo captures return a clear user-facing error instead of sending a photoless query to the LLM
- **TTS improvements** — Unit abbreviations (mph, km, ft, etc.) expanded before number-to-words conversion for correct speech output

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
├── public/assets/audio/              # Audio cues (start, processing, welcome, shutter)
├── server/
│   ├── MentraAI.ts                   # AppServer lifecycle (onSession/onStop) with soft disconnect
│   ├── agent/
│   │   ├── MentraAgent.ts            # AI SDK generateText() wrapper
│   │   ├── device-commands.ts        # Regex-based device command classifier (photo, battery, schedule)
│   │   ├── prompt.ts                 # Dynamic system prompt builder
│   │   ├── providers/
│   │   │   ├── types.ts              # UserAIConfig, MODEL_CATALOG, Provider
│   │   │   ├── registry.ts           # ProviderRegistry (resolve config → model)
│   │   │   └── vision.ts             # Multi-provider vision API
│   │   └── tools/                    # AI SDK tool definitions (search, calculator, thinking, places, directions)
│   ├── db/
│   │   ├── client.ts                 # Drizzle + postgres connection
│   │   ├── schema.ts                 # user_settings, conversations, turns, user_context, photos
│   │   ├── storage.ts               # Supabase Storage helpers (upload/download/delete photos)
│   │   └── vault.ts                  # Supabase Vault helpers (store/retrieve/delete)
│   ├── manager/
│   │   ├── CalendarManager.ts        # Calendar events from phone (in-memory + DB persistence)
│   │   ├── ChatHistoryManager.ts     # Drizzle-based conversation persistence
│   │   ├── DeviceCommandHandler.ts   # Hardware command executor (photo, battery, schedule)
│   │   ├── LocationManager.ts        # GPS, geocoding, weather, air quality, pollen, timezone
│   │   ├── QueryProcessor.ts         # Query pipeline (transcription → agent → TTS)
│   │   └── TranscriptionManager.ts   # Wake word, device commands, follow-up mode, audio/LED feedback
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
Wake word OR single-press action button → Green LED flash → Start listening sound
  → User speaks query → Silence detected
    → Device command? (e.g. "take a photo", "what's my battery?", "what's my schedule?")
      → Photo: Shutter sound → Photo saved to camera roll + Supabase Storage → Speaks "Photo saved"
      → Battery: Reads device state → Speaks "Battery is at 73 percent"
      → Schedule: Reads calendar cache → Speaks "You have 2 upcoming events today..."
      → Follow-up mode (no AI call)
    → Normal query? → Processing sound loops
      → Visual query? → Shutter sound → Photo captured for AI context
      → AI generates response → TTS speaks response
        → Follow-up mode (green LED 2s, mic open 10s)
          → User speaks again (no wake word needed) → repeat
          → Silence for 10s → return to idle (wake word required)
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
5. Add permissions: **Microphone + Transcripts**, **Camera**, **Location**, **Read Notifications**, **Send Notifications**, **Calendar**

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
| `SUPABASE_URL` | No | Supabase project URL (enables photo storage) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase secret key for Storage uploads |
| `JINA_API_KEY` | No | Jina API key for web search tool |

AI provider API keys (OpenAI, Anthropic, Google) and the Google Cloud API key (for location services, weather, places, directions, timezone) are **not** server env vars — they are stored per-user in Supabase Vault and configured via the Settings UI.

## Documentation

- [MentraOS Docs](https://docs.mentra.glass)
- [Developer Console](https://console.mentra.glass)
- [Architecture Plan](./ANY_AI_PLAN.md)

## License

MIT

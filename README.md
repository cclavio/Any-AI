<p align="center">
  <img src="https://mentra-store-cdn.mentraglass.com/mini_app_assets/com.clavionlabs.anyai/1771730415158-any-ai-logo-2.png" alt="Any AI Logo" width="120" height="120" />
</p>

<h1 align="center">Any AI</h1>

<p align="center">
  <strong>A multi-provider, bring-your-own-key AI assistant for MentraOS smart glasses</strong>
</p>

<p align="center">
  Choose your AI provider (OpenAI, Anthropic, Google, or your own local server), add your API key, and pick your model.<br/>
  Say "Hey Any AI", ask a question, and get a concise spoken or displayed response.<br/>
  See what you see. Search the web. Remember context.
</p>

---

## What It Does

Any AI is an intelligent voice assistant for MentraOS smart glasses. It adapts to your hardware — whether your glasses have a HUD display, camera, or speakers — and delivers responses in the most appropriate format.

- **Voice activation** — Say "Hey Any AI" to start (customizable wake word), or single-press the action button
- **Conversational follow-up** — After the AI responds, the mic stays open for 10 seconds so you can ask follow-up questions without repeating the wake word
- **TTS interrupt** — The mic is live during AI speech output. Start talking to interrupt the response and immediately ask a new question
- **Conversational closers** — Say "thanks", "I'm good", or "that's all" to end an exchange instantly without triggering the AI. Gratitude closers get a quick "You're welcome!" response; dismissals return to idle silently
- **Comprehension auto-close** — If the AI can't understand you twice in a row (noisy environment, mumbling), it gracefully ends the exchange instead of looping "please repeat that" indefinitely
- **Voice commands** — Say "take a photo", "what's my battery?", "what's my schedule?", or "check my notifications" for instant device responses (bypasses the AI pipeline)
- **Multi-provider** — Choose between OpenAI, Anthropic, Google, or a custom/local server (Ollama, LM Studio, vLLM, llama.cpp — anything with an OpenAI-compatible API)
- **Bring your own key** — Use your own API keys, stored securely in Supabase Vault
- **Vision** — Answers questions about what you're seeing (smart photo capture with shutter sound feedback). Vision can be independently configured or disabled entirely — visual queries get a spoken "image analysis isn't available" message when vision is off
- **Photo intelligence** — All photos are automatically analyzed by the vision model and tagged. Voice command photos ("take a photo") are uploaded to Supabase Storage and get vision analysis + auto-generated tags. Visual query photos store the LLM response as analysis. The last 24 hours of photos (with tags and summaries) are injected into the AI's context, so you can ask "what was in that photo?" without retaking it. Photos missing analysis are backfilled lazily on the next query.
- **Web search** — Provider-native web search (Anthropic, OpenAI, Google) with automatic fallback to Jina for models without native search support
- **Location services** — Nearby places, directions, weather, air quality, and pollen data (optional Google Cloud API key). API errors (quota exceeded, billing disabled, invalid key) produce specific spoken feedback instead of generic failures
- **Battery check** — Ask "what's my battery?" for instant glasses battery level and charging status
- **Calendar aware** — Receives calendar events from your phone; ask "what's my schedule?" for an instant readout, or ask the AI questions like "when is my next meeting?"
- **Notification intelligence** — Phone notifications are received via SDK, persisted to Postgres with typed fields (app, title, content, priority), and injected into the AI's context grouped by app. Say "check my notifications" for an instant spoken readout, or ask the AI "do I have any messages from John?" for contextual answers. Notifications survive server restarts via DB hydration and are auto-removed when dismissed on the phone.
- **Context aware** — Knows your location, date, time, weather, calendar, notifications, and conversation history
- **Exchange tracking** — Conversation turns are grouped into "exchanges" (wake word to done). Each exchange gets auto-generated topic tags via a lightweight LLM call. The AI's system prompt shows 48 hours of exchange-grouped history with temporal labels ("today morning", "yesterday evening") and tags, so it can distinguish "this morning's conversation about cookies" from "right now"
- **Conversation persistence** — History hydrated from DB on session start; 48-hour exchange-grouped context window. Each turn records which `user_context` rows were active (`context_ids`) and which exchange it belongs to (`exchange_id`), enabling full traceability of what the AI knew when it responded
- **Claude Code bridge** — Connect Claude Code to your smart glasses. Claude can send you notifications and questions (spoken aloud via two-stage announce→deliver flow), wait for your voice response, and park messages if you're busy. Ask naturally — "does Claude have a message?", "what did Claude want?", "I'm ready", or "go back to Claude" — to retrieve parked messages. Warm conversations (responses within 30s) skip the announcement and deliver directly. A 60-second warning fires before the 10-minute timeout expires. Available as a hosted MCP server — generate an API key in Settings, run the `claude mcp add` command, and you're connected. Supports multiple API keys per user (one per machine). MCP sessions auto-recover after server deploys
- **Session resilience** — Survives network blips and idle socket timeouts with a 5-minute grace period; no "Welcome" replay on reconnect
- **Timezone detection** — Auto-detects your timezone from GPS when the OS doesn't provide it
- **Personalization** — Custom assistant name, wake word, and model selection per user
- **Audio & visual feedback** — Green LED on wake word, start sound on listening, bing tone on speech received, processing loop during AI generation, error tone on pipeline failures, shutter sound on photo capture, personalized TTS welcome message
- **Self-healing state machine** — If the transcription pipeline gets stuck (e.g. a processing timeout), a 30-second watchdog automatically resets the system so the wake word starts working again. Diagnostic logging tracks dropped speech events for debugging
- **Hardware button** — Single press the action button to activate the listener (no wake word needed)

## What Changed from Mentra AI 2

Any AI is a fork of [Mentra AI 2](https://github.com/mentra-app/mentra-ai-2) with significant architectural changes:

### Multi-Provider AI (was single-provider Gemini only)

| | Mentra AI 2 | Any AI |
|---|---|---|
| **Providers** | Google Gemini only | OpenAI, Anthropic, Google, Custom/Local |
| **API keys** | Single server env var | Per-user, encrypted in Supabase Vault |
| **Model selection** | Hardcoded | User picks from model catalog or enters custom model name |
| **Vision provider** | Same as LLM | Independently configurable (or disable entirely) |

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
- **Photo linking** — Every photo (voice command or visual query) gets a `photos` row; conversation turns reference their photo via `photo_id` FK. Voice command photos are marked `saved: true` with Storage upload; visual query photos are `saved: false` with the LLM's `analysis` stored after response
- **Battery voice command** — "What's my battery?" reads glasses battery level and charging status instantly via device state API
- **Calendar integration** — `CalendarManager` receives events via `onCalendarEvent`, persists to generic `user_context` table, hydrates on reconnect, and injects schedule into AI context
- **Dynamic date context** — LLM receives the current date and time (not just time), so date-related questions are always accurate
- **Enhanced capabilities prompt** — "What can you do?" returns a comprehensive feature list tailored to the connected hardware
- **Single-press listener** — Action button changed from double-press to single press for faster activation
- **Dynamic identity** — System prompt reflects user's chosen assistant name, model, and provider
- **Auth hardening** — All `/api/*` routes require verified `aos_session` cookie; no endpoint reads userId from query params
- **Row Level Security** — RLS enabled on all Supabase tables for defense-in-depth
- **Per-user Google Cloud key** — Location services (geocoding, weather, air quality, pollen, places, directions, timezone) use a per-user API key stored in Vault, with graceful fallbacks when unconfigured. Google Cloud API errors are classified by type (`google-cloud-errors.ts`) and surfaced as specific spoken messages (e.g., "Your Google Cloud Weather API has reached its usage limit") instead of silent failures or vague LLM responses
- **Session resilience** — `onStop()` uses soft disconnect with a 5-minute grace period instead of destroying user state immediately; glasses reconnects are seamless with no welcome replay
- **Conversation hydration** — `ChatHistoryManager.initialize()` loads today's turns from DB on session start so prior context survives server restarts
- **Vision error handling** — Failed photo captures return a clear user-facing error instead of sending a photoless query to the LLM
- **TTS improvements** — Unit abbreviations (mph, km, ft, etc.) expanded before number-to-words conversion for correct speech output
- **Exchange tracking** — Turns grouped into exchanges (wake word → done) with auto-generated topic tags via fire-and-forget LLM call. System prompt uses 48-hour exchange-grouped history with temporal labels
- **Conversational closers** — Regex-based closer detection ("thanks", "I'm good", "bye") ends exchanges without triggering the AI pipeline, with optional spoken acknowledgment
- **TTS interrupt** — Mic stays live during AI speech output; incoming speech stops audio playback via `stopAudio(2)` and processes the interrupt as a new query. `QueryProcessor` returns a `QueryResult` with a non-blocking `ttsComplete` promise so `TranscriptionManager` controls TTS lifecycle
- **Smart silence** — Silence timeout increased to 3 seconds so users aren't cut off mid-thought when pausing
- **Comprehension auto-close** — Regex-based `isComprehensionFailure()` classifier detects "I didn't catch that" LLM responses. Two consecutive failures (empty transcript or agent repeat) trigger a friendly auto-close message and end the exchange with `comprehension_failure` end reason
- **Notification intelligence** — `NotificationManager` rewritten from `unknown`-typed stub to fully typed `PhoneNotification` handler with in-memory Map + `user_context` DB persistence (4-hour TTL). `onPhoneNotificationDismissed` wired to auto-remove stale entries. AI prompt shows notifications grouped by app with priority indicators. "Check my notifications" voice command gives instant spoken readout. Hydrates from DB on restart.
- **Native web search** — Provider-native web search tools replace the Jina HTTP tool for all supported models. `resolveSearchTools()` checks `ModelInfo.supportsWebSearch` in the catalog and creates Anthropic `webSearch_20250305`, OpenAI `webSearch`, or Google `googleSearch` tools with user location forwarding (country names auto-converted to ISO 3166-1 alpha-2 codes). Models without native support fall back to Jina. `JINA_API_KEY` is no longer required when using native search.
- **Photo intelligence** — `photo-analysis.ts` module provides `analyzePhoto()` (vision model analysis), `generatePhotoTags()` (LLM tag extraction from analysis text), `ensurePhotoAnalyzed()` (lazy backfill for photos missing analysis/tags), and `getRecentPhotosForPrompt()` (24h photo context for system prompt). Voice command photos now get automatic vision analysis + tagging via fire-and-forget chain in `DeviceCommandHandler`. Visual query photos get tags extracted from the LLM response. System prompt includes a "Recent Photos" section with relative timestamps, tags, and truncated analysis.
- **Settings UI polish** — Reusable settings primitives (`settings-ui.tsx`: SettingSection, SettingRow, SettingDivider, SettingDescription) replace repeated inline markup. Inputs and dropdowns have visible backgrounds, focus rings, and chevron indicators. Inline `style={{}}` color declarations replaced with Tailwind CSS 4 utility classes mapped via `@theme inline`
- **Claude Code bridge** — `BridgeManager` implements a park-and-wait model: Claude Code sends a message via HTTP long-poll, the glasses announce it ("You have a message from Claude Code"), wait for acceptance, then deliver and collect the user's voice response. Warm conversations (<30s gap) skip the announcement. If the user defers, the request is parked in memory with a 10-minute timeout and 60-second warning. Natural retrieval commands ("does Claude have a message?", "what did Claude want?", "I'm ready") trigger replay. Auth uses SHA-256 hashed API keys with in-app key generation (multiple keys per user). Hosted MCP server (`mcp-hosted.ts`) uses Streamable HTTP transport with auto-session-recovery on deploy — no local install needed, just `claude mcp add`. Three new tables (`claude_mentra_pairs`, `pairing_codes`, `bridge_requests`) store pairings and audit logs.

### Supported Models

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-5.2, GPT-5.1, GPT-5, GPT-5 Mini, GPT-4o, GPT-4o Mini, GPT-4.1, GPT-4.1 Mini |
| **Anthropic** | Claude Opus 4.6, Claude Sonnet 4.6, Claude Sonnet 4.5, Claude Haiku 4.5 |
| **Google** | Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.5 Pro |
| **Custom / Local** | Any model on an OpenAI-compatible server (Ollama, LM Studio, vLLM, llama.cpp, etc.) |

## Architecture

```
src/
├── index.ts                          # Bun.serve + Hono entry point
├── public/assets/audio/              # Audio cues (start, bing, processing, error, welcome, shutter)
├── server/
│   ├── MentraAI.ts                   # AppServer lifecycle (onSession/onStop) with soft disconnect
│   ├── agent/
│   │   ├── MentraAgent.ts            # AI SDK generateText() wrapper
│   │   ├── comprehension-failure.ts  # Regex classifier (comprehension failure)
│   │   ├── visual-classifier.ts      # LLM-based visual query classifier
│   │   ├── conversational-closers.ts # Regex-based closer classifier (gratitude, dismissal)
│   │   ├── device-commands.ts        # Regex-based device command classifier (photo, battery, schedule, notifications)
│   │   ├── prompt.ts                 # Dynamic system prompt builder (exchange-grouped history)
│   │   ├── providers/
│   │   │   ├── types.ts              # UserAIConfig, MODEL_CATALOG, Provider
│   │   │   ├── registry.ts           # ProviderRegistry (resolve config → model)
│   │   │   └── vision.ts             # Multi-provider vision API
│   │   └── tools/
│   │       ├── search.tool.ts        # Jina web search tool (fallback)
│   │       ├── native-search.ts      # Provider-native web search resolution (Anthropic, OpenAI, Google)
│   │       ├── calculator.tool.ts    # Calculator tool
│   │       ├── thinking.tool.ts      # Extended thinking tool
│   │       ├── places.tool.ts        # Google Places nearby search tool
│   │       └── directions.tool.ts    # Google Routes directions tool
│   ├── bridge/
│   │   ├── BridgeManager.ts          # Per-user bridge state: park-and-wait, replay, timeout
│   │   ├── bridge-auth.ts            # API key auth middleware (SHA-256 hash)
│   │   ├── bridge-commands.ts        # Regex classifiers (deferral, acceptance, bridge commands)
│   │   ├── bridge-routes.ts          # Hono routes for /api/bridge/ endpoints
│   │   ├── mcp-hosted.ts             # Hosted MCP server (Streamable HTTP transport)
│   │   └── types.ts                  # Bridge request/response types
│   ├── db/
│   │   ├── client.ts                 # Drizzle + postgres connection
│   │   ├── schema.ts                 # All table definitions (9 tables)
│   │   ├── storage.ts                # Supabase Storage helpers (upload/download/delete photos)
│   │   ├── vault.ts                  # Supabase Vault helpers (store/retrieve/delete)
│   │   └── drizzle/                  # SQL migration files (0000–0010)
│   ├── manager/
│   │   ├── AudioManager.ts           # Audio cue playback (processing loop, error tone)
│   │   ├── CalendarManager.ts        # Calendar events from phone (in-memory + DB persistence)
│   │   ├── ChatHistoryManager.ts     # Drizzle-based conversation persistence + exchange-grouped queries
│   │   ├── DeviceCommandHandler.ts   # Hardware command executor (photo, battery, schedule, notifications)
│   │   ├── ExchangeManager.ts        # Exchange lifecycle (start/end) + async tag generation
│   │   ├── LocationManager.ts        # GPS, geocoding, weather, air quality, pollen, timezone + error tracking
│   │   ├── NotificationManager.ts    # Phone notification persistence, dismissal tracking, prompt injection
│   │   ├── PhotoManager.ts           # Photo metadata management (capture, storage refs)
│   │   ├── QueryProcessor.ts         # Query pipeline (transcription → agent → TTS)
│   │   ├── TranscriptionManager.ts   # Wake word, closers, device commands, follow-up mode, exchange hooks
│   │   └── photo-analysis.ts         # Photo analysis (vision), tag generation (LLM), backfill, prompt context
│   ├── utils/
│   │   ├── google-cloud-errors.ts    # Google Cloud API error classification (quota, billing, permission)
│   │   ├── tts-formatter.ts          # TTS unit abbreviation expansion
│   │   ├── location-keywords.ts      # Location/weather/air quality/pollen query detection
│   │   └── wake-word.ts              # Wake word utilities
│   ├── constants/config.ts           # ResponseMode, word limits, exchange settings, comprehension settings
│   ├── routes/routes.ts              # Hono routes + SDK auth middleware
│   ├── api/settings.ts               # Settings + provider config handlers
│   └── session/User.ts               # Per-user state + aiConfig from DB/Vault
└── frontend/
    ├── App.tsx                        # React app with routing
    ├── pages/Settings.tsx             # Settings page
    ├── components/
    │   ├── ProviderSetup.tsx          # Provider config UI (LLM, Vision, Google Cloud, custom/local)
    │   ├── BridgePairing.tsx          # Claude Bridge pairing UI (API key generation, multi-key)
    │   └── settings-ui.tsx            # Reusable settings primitives (Section, Row, Divider, Description)
    ├── styles/theme.css               # Tailwind CSS 4 theme (CSS vars → utility class mapping)
    └── api/settings.api.ts            # Frontend API client
mcp-server/                            # Standalone MCP server for Claude Code (stdio transport)
```

## Interaction Flow

```
Wake word OR single-press action button → Green LED flash → Start listening sound → Exchange starts
  → User speaks query → Silence detected → Bing tone (speech acknowledged)
    → Conversational closer? (e.g. "thanks", "I'm good", "bye")
      → Gratitude: Speaks "You're welcome!" → Exchange ends → Idle
      → Dismissal: Silent → Exchange ends → Idle
    → Device command? (e.g. "take a photo", "what's my battery?", "what's my schedule?", "check my notifications")
      → Photo: Shutter sound → Photo saved to camera roll + Supabase Storage → Speaks "Photo saved"
      → Battery: Reads device state → Speaks "Battery is at 73 percent"
      → Schedule: Reads calendar cache → Speaks "You have 2 upcoming events today..."
      → Notifications: Reads notification cache → Speaks "You have 3 notifications. 2 from Messages..."
      → Follow-up mode (no AI call)
    → Normal query? → Processing sound loops
      → Visual query? → Shutter sound → Photo captured for AI context
      → AI generates response → TTS speaks response (mic live — can interrupt)
        → User interrupts mid-speech? → TTS stops → new speech processed immediately
        → Follow-up mode (green LED, mic open 10s)
          → User speaks again (no wake word needed) → repeat (same exchange)
          → 2 consecutive comprehension failures → auto-close message → Idle
          → Silence for 10s → Exchange ends (tags generated async) → Idle
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

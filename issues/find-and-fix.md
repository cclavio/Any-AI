# Mentra AI-2: Find & Fix — Architecture & Issues

## Current Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    MENTRA GLASSES (MentraOS)                  │
│                                                              │
│  User speaks → SDK captures transcription + takes photo      │
└──────────────┬───────────────────────────────────────────────┘
               │ (MentraOS SDK events)
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    BACKEND (Bun + Hono)                       │
│                                                              │
│  TranscriptionManager                                        │
│  ├─ onTranscription(data) ← SDK event                       │
│  ├─ Broadcasts raw text to SSE /transcription-stream         │
│  ├─ Detects wake word ("Hey Mentra")                         │
│  ├─ Accumulates transcript until 1.5s silence                │
│  └─ Calls onQueryReady(query) ──┐                           │
│                                  ▼                           │
│  QueryProcessor.processQuery(query)                          │
│  ├─ Step 1: Take photo (camera.requestPhoto())               │
│  ├─ Step 2: Fetch location (if needed, lazy)                 │
│  ├─ Step 3: Build context (history, location, time, etc.)    │
│  ├─ Step 4: Call Gemini 2.5 Flash via Mastra agent           │
│  ├─ Step 5: Format response (TTS or display)                 │
│  └─ Step 6: Output to glasses (speak/display)                │
│                                                              │
│  SSE Endpoints:                                              │
│  ├─ /api/chat/stream      → Chat messages (history + live)   │
│  ├─ /api/photo-stream     → Photos as base64 data URLs       │
│  └─ /api/transcription-stream → Live transcription text      │
└──────────────────────────────────────────────────────────────┘
               │ (SSE connections)
               ▼
┌──────────────────────────────────────────────────────────────┐
│                  FRONTEND (React 19 + Framer Motion)         │
│                                                              │
│  ChatInterface.tsx                                           │
│  ├─ Opens EventSource to /api/chat/stream                    │
│  ├─ Handles: message, processing, idle, history              │
│  ├─ Renders ChatBubble (memoized) for each message           │
│  └─ Shows "thinking..." indicator when isProcessing=true     │
└──────────────────────────────────────────────────────────────┘
```

**Stack**: Bun runtime, Hono HTTP framework, React 19, Mastra (agent), Google Gemini 2.5 Flash, MongoDB, SSE (Server-Sent Events)

---

## Desired Behavior

1. User speaks to glasses → transcription sent to backend
2. Backend processes query (take photo, call AI, get response)
3. **User's message appears on frontend immediately**
4. **AI response appears on frontend when ready**
5. **Photo is always taken and always sent to the frontend**
6. Smooth, flicker-free UI updates

---

## BUGS FOUND

### BUG 1 (CRITICAL): `broadcastChatEvent` is NEVER CALLED

**File**: `src/server/api/chat.ts:51`

The function `broadcastChatEvent()` is exported but **never imported or called anywhere in the codebase**. This means:

- When a user sends a query, the user message is **never** pushed to the chat SSE stream
- When the AI responds, the response is **never** pushed to the chat SSE stream
- The `processing` and `idle` events are **never** sent to the frontend
- The frontend **only** receives `history` on initial SSE connect (stale data)

**This is the root cause of the delay**. The frontend never gets live updates. It only sees messages when the SSE connection is re-established (page reload), at which point it fetches the full history dump.

**Where it should be called** (in `QueryProcessor.processQuery()`):

```
1. Before processing starts → broadcastChatEvent(userId, { type: "processing" })
2. After user message → broadcastChatEvent(userId, { type: "message", senderId: userId, ... })
3. After AI response → broadcastChatEvent(userId, { type: "message", senderId: "mentra-ai", ... })
4. After processing ends → broadcastChatEvent(userId, { type: "idle" })
```

---

### BUG 2 (FLICKER): AnimatePresence + stagger animation on every render

**File**: `src/frontend/pages/ChatInterface.tsx:45-49`

```tsx
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, delay: index * 0.05 }}
```

Every `ChatBubble` has a stagger delay of `index * 0.05s`. When a new message arrives:
- Message at index 0 re-animates with 0ms delay
- Message at index 10 re-animates with 500ms delay
- Message at index 50 re-animates with 2500ms delay

Even though `ChatBubble` is `memo()`-ized, Framer Motion's `AnimatePresence` may still re-trigger animations on sibling re-renders. The stagger pattern means **all messages flicker/re-fade-in every time a new message is added**.

**Fix**: Only animate the *newest* message, not all messages. Old messages should render with `initial={false}` or no animation.

---

### BUG 3 (FLICKER): `setMessages([...prev, newMsg])` creates new array every time

**File**: `src/frontend/pages/ChatInterface.tsx:255-265`

Every SSE message creates a brand-new messages array, which causes the entire message list to re-render. Combined with Bug 2's stagger animations, this triggers a full visual "flash" of all messages.

---

### BUG 4: `thinkingWords` in dependency array causes SSE reconnect loop

**File**: `src/frontend/pages/ChatInterface.tsx:297`

```tsx
}, [userId, recipientId, thinkingWords]);
```

`thinkingWords` is a **new array reference on every render** (defined inside the component body at line 132-145). This means the `useEffect` re-runs on every render → closes old EventSource → opens new EventSource → gets fresh history → re-renders → infinite loop.

**This is likely a major contributor to flicker**: the SSE connection keeps tearing down and reconnecting, each time fetching and re-setting the full history.

---

### BUG 5: Photos not sent via chat SSE stream

The photo is captured in `QueryProcessor.processQuery()` and stored in `PhotoManager`, but there's no code that attaches the photo (as base64 or data URL) to the chat message broadcast. The `Message` interface on the frontend has an `image?: string` field, but it's never populated for live messages.

The `photoStream` SSE exists separately, but the frontend's `ChatInterface.tsx` doesn't subscribe to it — it only subscribes to `/api/chat/stream`.

---

### BUG 6: No processing/idle state management

Since `broadcastChatEvent` is never called (Bug 1), the frontend's `isProcessing` state is unreliable. Currently the frontend sets `isProcessing = true` when it receives a user message (line 249), which only works if messages are being broadcast — they're not. So the "thinking..." indicator never shows.

---

### BUG 7 (PERF): Photo taken AFTER query ready — adds seconds of latency

**File**: `src/server/manager/QueryProcessor.ts:41` and `src/server/manager/TranscriptionManager.ts:101`

Currently the flow is:
```
1. Wake word detected ("Hey Mentra")
2. Accumulate transcript (1.5s silence timeout)
3. onQueryReady(query) fires
4. processQuery() starts
5. >>> camera.requestPhoto() happens HERE <<<  (slow!)
6. Wait for photo buffer
7. Build context
8. Call Gemini AI
```

The photo capture (step 5) happens **after** the full query is assembled and `processQuery` begins. `requestPhoto()` has latency (camera wake + capture + transfer from glasses). This adds noticeable delay before the AI even starts thinking.

**Fix**: Capture the photo at wake word detection time (step 1), not at query processing time (step 5). By the time the user finishes speaking and the 1.5s silence timeout fires, the photo is already captured and ready.

```
BEFORE: wake → speak → silence → [START processQuery] → take photo (SLOW) → AI
AFTER:  wake → take photo (PARALLEL with speaking) → silence → [START processQuery] → photo ready → AI
```

**Where to fix**: In `TranscriptionManager.startListening()`, trigger `user.photo.takePhoto()` immediately. Pass the pre-captured photo to `QueryProcessor` via the `onQueryReady` callback or store it on the User object.

---

### BUG 8: Chat history enabled by default — should be OFF

**Files**:
- `src/server/manager/ChatHistoryManager.ts:33` — `private chatHistoryEnabled: boolean = true`
- `src/server/db/schemas/user-settings.schema.ts:23` — `chatHistoryEnabled: { type: Boolean, default: true }`
- `src/server/api/settings.ts:28` — `chatHistoryEnabled: true`

Chat history saving to MongoDB is enabled by default. It should default to `false` (off).

---

## FIX PLAN

### Fix 1: Wire up `broadcastChatEvent` in QueryProcessor

**File to modify**: `src/server/manager/QueryProcessor.ts`

```typescript
import { broadcastChatEvent } from "../api/chat";

async processQuery(query: string, speakerId?: string): Promise<string> {
  // ... existing code ...

  // NEW: Broadcast user message to frontend
  broadcastChatEvent(this.user.userId, {
    type: "message",
    id: `user-${Date.now()}`,
    senderId: this.user.userId,
    recipientId: "mentra-ai",
    content: query,
    timestamp: new Date().toISOString(),
    image: photoDataUrl,  // attach photo if taken
  });

  // NEW: Broadcast processing state
  broadcastChatEvent(this.user.userId, { type: "processing" });

  // ... agent generates response ...

  // NEW: Broadcast AI response to frontend
  broadcastChatEvent(this.user.userId, {
    type: "message",
    id: `ai-${Date.now()}`,
    senderId: "mentra-ai",
    recipientId: this.user.userId,
    content: response,
    timestamp: new Date().toISOString(),
  });

  // NEW: Broadcast idle state
  broadcastChatEvent(this.user.userId, { type: "idle" });
}
```

### Fix 2: Fix SSE reconnect loop (remove `thinkingWords` from deps)

**File to modify**: `src/frontend/pages/ChatInterface.tsx`

Move `thinkingWords` to a module-level constant (outside the component) or wrap in `useMemo`/`useRef`. Remove it from the `useEffect` dependency array.

### Fix 3: Fix flicker — only animate new messages

**File to modify**: `src/frontend/pages/ChatInterface.tsx`

Track which messages are "new" (just received) vs "existing" (from history or already rendered). Only apply entrance animation to new messages:

```tsx
const ChatBubble = memo(function ChatBubble({ message, isOwnMessage, isNew }) {
  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      // Remove index-based stagger delay
    >
```

### Fix 4: Attach photo to chat message broadcast

When a photo is captured in `QueryProcessor`, convert it to a base64 data URL and include it in the `broadcastChatEvent` call for the user message. This way the frontend's `message.image` field is populated and the photo shows in the chat.

### Fix 5: Remove separate photo-stream dependency for chat

The chat SSE stream should include photos inline with messages. The separate `/photo-stream` can remain for standalone photo viewing, but the chat UI should get photos via the chat stream.

### Fix 6: Move photo capture to wake word detection

**File to modify**: `src/server/manager/TranscriptionManager.ts`

In `startListening()`, immediately trigger `this.user.photo.takePhoto()` and store the promise. When `processQuery()` is called, await the already-in-flight photo instead of starting a new capture.

```typescript
// TranscriptionManager.startListening()
private startListening(speakerId?: string): void {
  this.isListening = true;
  // Capture photo NOW while user is still speaking
  this.pendingPhoto = this.user.photo.takePhoto();
  // ... rest of existing code
}
```

```typescript
// QueryProcessor.processQuery() — use pre-captured photo
const currentPhoto = await this.user.transcription.getPendingPhoto();
// Instead of: const currentPhoto = await this.user.photo.takePhoto();
```

### Fix 7: Default chat history to OFF

**Files to modify**:
- `src/server/manager/ChatHistoryManager.ts:33` — change `true` to `false`
- `src/server/db/schemas/user-settings.schema.ts:23` — change `default: true` to `default: false`
- `src/server/api/settings.ts:28` — change `chatHistoryEnabled: true` to `chatHistoryEnabled: false`

---

## Priority Order

| Priority | Bug | Impact | Effort |
|----------|-----|--------|--------|
| P0 | Bug 1: broadcastChatEvent never called | Messages never reach frontend live | Low |
| P0 | Bug 4: thinkingWords SSE reconnect loop | Infinite reconnect + history re-fetch | Low |
| P0 | Bug 7: Photo taken after query ready | Adds seconds of latency to every query | Medium |
| P1 | Bug 2: Stagger animation on all messages | Visual flicker on every update | Medium |
| P1 | Bug 5: Photos not in chat messages | User can't see photos in chat | Medium |
| P1 | Bug 8: Chat history default on | Should default to off | Low |
| P2 | Bug 3: Array recreation re-renders | Performance with many messages | Low |
| P2 | Bug 6: Processing state unreliable | "Thinking" indicator broken | Fixed by Bug 1 fix |

---

## Implementation Status — ALL FIXES APPLIED

1. [x] **Fix `thinkingWords` dependency** — Moved to module-level `THINKING_WORDS` constant, removed from useEffect deps
2. [x] **Wire up `broadcastChatEvent`** — QueryProcessor now broadcasts: user message, processing, AI response, idle
3. [x] **Move photo capture to wake word detection** — TranscriptionManager.startListening() now fires takePhoto() immediately, passes pre-captured photo through to QueryProcessor
4. [x] **Attach photos to chat broadcast** — Photo converted to base64 data URL and included in user message broadcast
5. [x] **Fix animation flicker** — ChatBubble now takes `isNew` prop; only new messages animate, old ones render instantly
6. [x] **Default chat history to OFF** — Changed in ChatHistoryManager, user-settings schema, and settings API

### Files Modified

- `src/frontend/pages/ChatInterface.tsx` — Bugs 2, 3, 4 (flicker, reconnect loop, animation)
- `src/server/manager/QueryProcessor.ts` — Bugs 1, 5 (broadcastChatEvent, photo in messages)
- `src/server/manager/TranscriptionManager.ts` — Bug 7 (photo at wake word)
- `src/server/MentraAI.ts` — Updated callback signature for prePhoto
- `src/server/manager/ChatHistoryManager.ts` — Bug 8 (default off)
- `src/server/db/schemas/user-settings.schema.ts` — Bug 8 (default off)
- `src/server/api/settings.ts` — Bug 8 (default off)

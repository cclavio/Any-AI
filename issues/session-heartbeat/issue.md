# Issue: Frontend Has No Idea When Glasses Session Dies

## The Bug

When the user's glasses disconnect (Bluetooth drop, app close, battery death), the server cleans up via `onStop()` → `sessions.remove(userId)`. But the **frontend webview has no idea this happened**. It keeps showing the chat UI as if everything is fine — messages stop flowing, the processing indicator may freeze, and there's no feedback to the user.

The chat SSE stream has a 30s heartbeat (`:heartbeat\n\n`), but it's just a keep-alive comment — the frontend doesn't even listen for it. And critically, the chat stream **doesn't require an active glasses session** to stay open — `chatClients` (in `chat.ts`) is a **separate map** from `sessions.users` (in `SessionManager.ts`). The frontend SSE pipe survives `sessions.remove()`.

## Current State

### What the server does on session death:
1. `MentraAI.onStop()` fires
2. `sessions.remove(userId)` → `user.cleanup()`
3. `user.cleanup()` destroys TranscriptionManager, PhotoManager, LocationManager, etc.
4. `user.appSession = null`
5. The `User` object is removed from the `SessionManager` map

### What the frontend knows: **Nothing.**
- Chat SSE stream stays open (Hono `streamSSE` doesn't close it — `chatClients` is independent)
- Photo/transcription streams will 404 on next reconnect, but the chat stream is the main one
- No event like `{ type: "session_ended" }` is ever sent
- `sessionStorage.mentra-session-connected` stays `'true'` forever

### Key architectural detail:
`chatClients` and `sessions.users` are **two independent maps**. `broadcastChatEvent` only reads from `chatClients`. This means:
- `broadcastChatEvent` works regardless of whether user exists in `sessions`
- Frontend can open chat SSE before glasses connect (the `chatClients` entry is created on SSE connect, not on glasses connect)
- We can safely broadcast `session_ended` and it will always reach the frontend

---

## Proposed Fix (Three Parts)

### Part 1: Broadcast session lifecycle events through chat SSE

**Files:** `src/server/MentraAI.ts`, `src/server/api/chat.ts`

Add two broadcasts in `MentraAI.ts`:

```typescript
// In onSession(), after everything is wired up:
broadcastChatEvent(userId, {
  type: "session_started",
  glassesType: hasDisplay ? "display" : "camera",
  timestamp: new Date().toISOString(),
});

// In onStop(), BEFORE sessions.remove():
broadcastChatEvent(userId, {
  type: "session_ended",
  reason,
  timestamp: new Date().toISOString(),
});
sessions.remove(userId); // cleanup AFTER broadcast
```

Update `broadcastChatEvent` type union in `chat.ts`:
```typescript
type: 'message' | 'processing' | 'idle' | 'history' | 'session_started' | 'session_ended' | 'session_heartbeat';
```

**Note:** `broadcastChatEvent` is fire-and-forget (inner `writer.write()` returns Promise but isn't awaited). The write gets queued to the stream synchronously, so ordering before `sessions.remove()` is sufficient — no `await` needed.

### Part 2: Session heartbeat — periodic status pings on chat SSE

**File:** `src/server/api/chat.ts`

Replace the existing 30s `:heartbeat` comment with a real data event (15s interval):

```typescript
const heartbeatInterval = setInterval(async () => {
  try {
    const user = sessions.get(userId);
    // IMPORTANT: user is undefined after sessions.remove()
    // undefined?.appSession is undefined, and undefined !== null is TRUE (bug!)
    // Must check user != null first
    const isActive = user != null && user.appSession != null;
    await stream.write(`data: ${JSON.stringify({
      type: "session_heartbeat",
      active: isActive,
      timestamp: new Date().toISOString(),
    })}\n\n`);
  } catch {
    clearInterval(heartbeatInterval);
  }
}, 15000);
```

**Bug caught during review:** Original plan had `user?.appSession !== null`. If `user` is `undefined`, then `undefined?.appSession` is `undefined`, and `undefined !== null` evaluates to `true` — incorrectly reporting session as active. Fixed to `user != null && user.appSession != null`.

### Part 3: Frontend reacts to session state

**File:** `src/frontend/pages/ChatInterface.tsx`

Add `sessionActive` state and handle new event types in existing `onmessage`:

```typescript
const [sessionActive, setSessionActive] = useState<boolean | null>(null);
// null = unknown (no heartbeat received yet)

// In the SSE onmessage handler, add these cases:
if (data.type === 'session_started') {
  setSessionActive(true);
} else if (data.type === 'session_ended') {
  setSessionActive(false);
  setIsProcessing(false);
} else if (data.type === 'session_heartbeat') {
  setSessionActive(data.active);
  if (!data.active) {
    setIsProcessing(false);
  }
}
```

UI when `sessionActive === false`:
- Non-blocking banner at top of chat: "Glasses disconnected"
- Clears stuck `isProcessing` indicator
- Disappears when `session_started` or heartbeat with `active: true` arrives

---

## Pipeline Flow

```
GLASSES CONNECT
  → MentraAI.onSession()
  → sessions.getOrCreate(userId), user.setAppSession(session)
  → broadcastChatEvent(userId, { type: "session_started" })        ← INSTANT
  → Frontend receives: sessionActive = true

EVERY 15s (heartbeat)
  → chat.ts heartbeat interval fires
  → sessions.get(userId) → user exists, appSession != null
  → stream.write({ type: "session_heartbeat", active: true })
  → Frontend confirms: sessionActive = true

GLASSES DISCONNECT
  → MentraAI.onStop(sessionId, userId, reason)
  → broadcastChatEvent(userId, { type: "session_ended", reason })  ← INSTANT, BEFORE cleanup
  → sessions.remove(userId) → user.cleanup()
  → Frontend receives: sessionActive = false, banner appears

GLASSES RECONNECT (same userId)
  → MentraAI.onSession() fires again
  → sessions.getOrCreate(userId) → new User
  → broadcastChatEvent(userId, { type: "session_started" })        ← INSTANT
  → Frontend receives: sessionActive = true, banner disappears

HEARTBEAT CATCHES STALE STATE (browser tab resumed)
  → heartbeat fires
  → sessions.get(userId) → undefined (cleaned up while tab was suspended)
  → user != null → false → active: false
  → Frontend corrects: sessionActive = false
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Glasses disconnect normally | `session_ended` fires instantly → frontend knows in <1s |
| `session_ended` missed (browser tab suspended) | Next heartbeat (within 15s) sets `sessionActive = false` |
| User reconnects before heartbeat detects disconnect | `session_started` fires instantly → seamless reconnection |
| Multiple browser tabs open | All tabs receive same SSE events, all stay in sync |
| Server crashes (no `onStop` called) | SSE `onerror` fires on frontend → treat as disconnected |
| Chat SSE reconnects after server restart | Heartbeat reports `active: false` until glasses reconnect |
| Frontend opens before glasses connect | `sessionActive = null`, first heartbeat reports `false`, then `session_started` fires when glasses connect |
| `user?.appSession !== null` after cleanup | Fixed: use `user != null && user.appSession != null` → correctly returns `false` |

## Files Summary

| File | Change |
|------|--------|
| `src/server/MentraAI.ts` | Import `broadcastChatEvent`. Add `session_started` broadcast at end of `onSession`, `session_ended` broadcast at start of `onStop` (before `sessions.remove`) |
| `src/server/api/chat.ts` | Add new event types to `broadcastChatEvent` type union. Replace `:heartbeat` with `session_heartbeat` data event at 15s interval with `active` boolean |
| `src/frontend/pages/ChatInterface.tsx` | Add `sessionActive` state. Handle `session_started`, `session_ended`, `session_heartbeat` in SSE handler. Show disconnected banner when `sessionActive === false` |

## Verification

1. Connect glasses → frontend shows no banner (or brief "Connected" toast)
2. Disconnect glasses → frontend shows "Glasses disconnected" banner within 1-2s
3. Reconnect glasses → banner disappears, chat resumes
4. Disconnect while processing → processing indicator clears, banner appears
5. Suspend browser tab, disconnect glasses, resume tab → banner appears within 15s
6. Two browser tabs → both show/hide banner in sync
7. Kill server process → SSE `onerror` on frontend
8. Open frontend before glasses connect → `sessionActive = null`, then `true` when glasses connect

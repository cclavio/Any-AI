# Test: Simulate Session Disconnect and Verify Frontend Reaction

## Goal

Add a debug API endpoint that kills a user's session on the backend (simulates glasses disconnect), then write a test that calls it and verifies the frontend receives the correct events. This lets us test the full session heartbeat/disconnect flow without real glasses.

---

## Plan (Two Parts)

### Part 1: Add Debug Endpoint — `POST /api/debug/kill-session`

A new API endpoint that simulates `onStop()` for a given user. It does exactly what `MentraAI.onStop()` does:
1. Broadcasts `session_ended` to chat SSE clients
2. Calls `sessions.remove(userId)` to clean up

```typescript
// src/server/api/debug.ts
import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";
import { broadcastChatEvent } from "./chat";

export async function killSession(c: Context) {
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) return c.json({ error: `No session for ${userId}` }, 404);

  // Same sequence as MentraAI.onStop()
  broadcastChatEvent(userId, {
    type: "session_ended",
    reason: "debug-kill",
    timestamp: new Date().toISOString(),
  });

  sessions.remove(userId);

  return c.json({
    success: true,
    message: `Session killed for ${userId}`,
  });
}
```

Register in routes:
```typescript
// In routes.ts
import { killSession } from "../api/debug";

// Debug (only available in development)
if (process.env.NODE_ENV === "development") {
  api.post("/debug/kill-session", killSession);
}
```

**Guard:** Only registered in development mode (`NODE_ENV=development`). Won't exist in production.

**Files:**
| File | Change |
|------|--------|
| `src/server/api/debug.ts` | **New** — `killSession` handler |
| `src/server/routes/routes.ts` | Register `POST /api/debug/kill-session` (dev only) |

### Part 2: Test — Call Endpoint, Verify SSE Events

A test that:
1. Starts a chat SSE connection for a test userId
2. Calls `POST /api/debug/kill-session?userId=<id>`
3. Verifies that `session_ended` event arrives on the SSE stream
4. Verifies that subsequent heartbeats report `active: false`

**Problem:** The server requires `@mentra/sdk` authentication and a real MentraOS glasses session to create a user in `SessionManager`. We can't easily spin up the full AppServer in a test.

**Solution:** Test at the unit level — directly call `sessions.getOrCreate()` to create a fake user, then call `killSession` via `fetch` against the running dev server. Or, write the test to run against a **live dev server** (integration test).

#### Option A: Integration test against running dev server

The simplest approach. Requires `bun run dev` to be running. The test:

1. Creates a user by fetching `/api/chat/stream?userId=test-user` (this adds to `chatClients` but doesn't create a `sessions` entry)
2. We need the user to exist in `sessions` too — so we also add a `POST /api/debug/create-session` endpoint that creates a fake user

```typescript
// Additional debug endpoint
export async function createSession(c: Context) {
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.getOrCreate(userId);
  // Don't call setAppSession (no real glasses) — just create the user object
  // The heartbeat will report active: false (no appSession) which is fine
  // To simulate active, we'd need to mock appSession

  return c.json({
    success: true,
    message: `Session created for ${userId}`,
    hasAppSession: user.appSession !== null,
  });
}
```

Test flow:
```
1. POST /api/debug/create-session?userId=test-disconnect-123
   → Creates user in SessionManager (no appSession, so heartbeat says active: false)

2. GET /api/chat/stream?userId=test-disconnect-123
   → Opens SSE connection, receives: connected, session_heartbeat (active: false)

3. POST /api/debug/kill-session?userId=test-disconnect-123
   → Kills the session

4. Verify SSE receives: { type: "session_ended", reason: "debug-kill" }

5. Wait for next heartbeat (15s) or check immediately:
   → sessions.get("test-disconnect-123") returns undefined
```

#### Option B: Unit test with mocked SessionManager

Doesn't require a running server. Directly imports `sessions`, `broadcastChatEvent`, creates entries, and verifies behavior. Faster but doesn't test the HTTP layer.

```typescript
import { describe, test, expect } from "bun:test";
import { sessions } from "../../manager/SessionManager";
import { broadcastChatEvent } from "../../api/chat";

describe("session disconnect", () => {
  test("killing a session broadcasts session_ended", () => {
    const userId = "test-disconnect-unit";

    // Create a user
    sessions.getOrCreate(userId);
    expect(sessions.get(userId)).toBeDefined();

    // Kill it (same as onStop)
    broadcastChatEvent(userId, {
      type: "session_ended",
      reason: "test-kill",
      timestamp: new Date().toISOString(),
    });
    sessions.remove(userId);

    // Verify user is gone
    expect(sessions.get(userId)).toBeUndefined();
  });
});
```

This only verifies the backend side. It doesn't test that the frontend actually received the event.

### Recommended: Both

- **Option B (unit test)** for CI — fast, no server needed, verifies backend logic
- **Option A (integration test)** for manual testing — spin up dev server, open phone browser, call the endpoint, watch the frontend react

---

## Manual Testing Flow (What You'll Actually Do)

Test with real glasses connected, using the known userId `paryan28@gmail.com`:

```
1. Start the dev server:
   $ bun run dev

2. Open the frontend on your phone (http://<your-ip>:3000)
   → Frontend connects to chat SSE
   → Shows loading spinner, then "Connect your glasses"

3. Connect real glasses
   → onSession fires → frontend sees session_started
   → Banner disappears, "Say Hey Mentra" welcome appears
   → Use the app normally, send a query, see the chat working

4. Kill the session from terminal:
   $ curl -X POST "http://localhost:3000/api/debug/kill-session?userId=paryan28@gmail.com"

5. Watch the frontend:
   ✓ Red "Disconnected — attempting to reconnect" banner slides in
   ✓ Chat messages clear
   ✓ "Connect your glasses" screen appears
   ✓ Processing indicator clears (if it was stuck)

6. Reconnect glasses (close and reopen the app on glasses)
   → onSession fires again
   → Banner disappears, ready for new messages
```

## Unit Test

The unit test in `session-disconnect.test.ts` uses the hardcoded userId `paryan28@gmail.com` and verifies the backend side: create user → kill session → user gone.

```bash
bun test src/server/test/unit-tests/session-disconnect.test.ts
```

---

## Debug Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/debug/kill-session?userId=<id>` | POST | Kill session: broadcast `session_ended` + remove user |

**Dev-only** — gated behind `NODE_ENV=development`.

## Files Summary

| File | Change |
|------|--------|
| `src/server/api/debug.ts` | **New** — `killSession` handler |
| `src/server/routes/routes.ts` | Register `POST /api/debug/kill-session` (dev only) |
| `src/server/test/unit-tests/session-disconnect.test.ts` | **New** — Unit test for session cleanup with userId `paryan28@gmail.com` |

## Test Commands

```bash
# Run unit test
bun test src/server/test/unit-tests/session-disconnect.test.ts

# Manual integration test (with dev server running + glasses connected)
curl -X POST "http://localhost:3000/api/debug/kill-session?userId=paryan28@gmail.com"
```

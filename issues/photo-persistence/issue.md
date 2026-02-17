# Issue: Chat State Not Synced Across Refresh

## Overview

Three problems with the frontend ↔ backend chat sync:

1. **Photos lost on refresh** — photos appear live but vanish when the page reloads
2. **Scroll position wrong on history load** — when previous conversations load, the page doesn't start at the bottom; instead it does a delayed smooth-scroll animation, causing a visible jump
3. **MongoDB should be disabled for MVP** — MongoDB is connected but we should not read/write any chat data to it. Everything stays in-memory only for this MVP.

---

## Problem 1: Photos Not Persisted

### What happens

When a user asks a question, a photo is captured from the smart glasses and displayed inline in the chat. On page refresh:
- Chat text reloads correctly (from in-memory history)
- **Photos disappear** — they were only broadcast live via SSE, never saved to chat history

### Root cause

The photo data URL (`data:image/jpeg;base64,...`) is created in `QueryProcessor` and broadcast live via SSE, but **never stored** in the conversation turn.

- `QueryProcessor.processQuery()` (line ~65-73) creates `photoDataUrl` and broadcasts it in the SSE message
- `ChatHistoryManager.addTurn()` (line ~151) only receives `hadPhoto: boolean` — not the actual image data
- `chat.ts` SSE endpoint (line ~102-117) rebuilds history from `getRecentTurns()` — turns have no `image` field
- Frontend `ChatInterface.tsx` (line ~283) reads `msg.image` from history — but it's always `undefined`

### Data flow today

```
Photo captured → photoDataUrl created → broadcast via SSE (live) ✅
                                       ↘ addTurn(query, response, hadPhoto=true) — no photo data ❌

Page refresh → SSE sends history → turns have no image field → photos gone ❌
```

### Fix

Store `photoDataUrl` (base64 string, ~175KB per photo) directly on each in-memory conversation turn.

**Files to change:**

#### 1. `src/server/manager/ChatHistoryManager.ts`
- Add `photoDataUrl?: string` to `ConversationTurn` interface
- Update `addTurn()` signature: add `photoDataUrl?: string` as 4th parameter
- Include `photoDataUrl` in the turn object pushed to `recentTurns[]`

#### 2. `src/server/manager/QueryProcessor.ts`
- Line ~151: pass existing `photoDataUrl` variable to `addTurn()` — it's already in scope

#### 3. `src/server/api/chat.ts`
- Line ~108: add `image: turn.photoDataUrl` to user message objects in the SSE history payload

#### No frontend changes needed for this part
`ChatInterface.tsx` already reads `msg.image` from history messages and renders `<img src={message.image}>` — it just needs to be populated by the backend.

### Size considerations
- ~175KB per photo (base64 of ~130KB JPEG)
- 30 max turns = ~5MB worst case in-memory — acceptable

---

## Problem 2: Scroll Not at Bottom on History Load

### What happens

When the page loads and there are existing conversations, the user sees the chat starting from the top, then it smooth-scrolls down to the bottom with a visible animation delay. It should just **be** at the bottom instantly — like any chat app.

### Root cause

In `ChatInterface.tsx`, the `scrollToBottom` function (lines 172-180):

```tsx
const scrollToBottom = (instant?: boolean) => {
  setTimeout(() => {
    const container = messagesEndRef.current?.parentElement?.parentElement?.parentElement;
    if (container && messagesEndRef.current) {
      const targetPosition = messagesEndRef.current.offsetTop + 150;
      container.scrollTo({ top: targetPosition, behavior: instant ? 'instant' : 'smooth' });
    }
  }, instant ? 0 : 100);
};
```

Issues:
1. **Fragile parent traversal** — walks up 3 parent elements to find the scroll container. If DOM structure changes, this breaks.
2. **100ms setTimeout delay** — for non-instant scrolls, there's a 100ms delay before scrolling even starts, causing a visible flash of content at the top.
3. **History load path** (lines 183-190): when `hasConnectedBefore` is true and history loads, it calls `scrollToBottom(true)` (instant) BUT only on the first render. The `history` SSE event may arrive after this, replacing messages, and the subsequent scroll uses `scrollToBottom()` (smooth, with 100ms delay).
4. **The `useEffect` on `[messages]`** (line 183) fires on every message change — including the initial history load — but the non-reconnect path does smooth scroll instead of instant.

### Fix

**File to change: `src/frontend/pages/ChatInterface.tsx`**

1. **Give the scroll container a ref directly** instead of walking up parent elements. Add a `scrollContainerRef` to the overflow-y-auto div (line ~335).

2. **On history load (`type === 'history'`), scroll instantly** — use `requestAnimationFrame` to ensure the DOM has rendered, then `scrollTo({ top: 999999, behavior: 'instant' })`. No setTimeout delay.

3. **On new live messages, keep smooth scroll** — this is the current behavior and it's fine for individual messages arriving one at a time.

4. **Simplify the scroll logic** — instead of the `hasScrolledOnReconnect` ref + `hasConnectedBefore` state + two separate useEffects, use a single approach:
   - Track whether the current scroll was from history load (instant) vs live message (smooth)
   - History SSE handler sets messages AND triggers instant scroll in one go
   - Live message handler uses smooth scroll as today

---

## Problem 3: Disable MongoDB for MVP

### What happens

MongoDB is connected on startup (`📦 Connected to MongoDB`) and `ChatHistoryManager` reads/writes to it when `chatHistoryEnabled` is true. For this MVP, we should **not communicate with MongoDB at all** for chat data. Everything stays in-memory.

### Current behavior

- `ChatHistoryManager` checks `chatHistoryEnabled` flag before DB writes — but still does DB reads on init (`loadSettings()`, `loadTodayConversation()`)
- `UserSettings` schema reads/writes to MongoDB for settings persistence
- The `conversation.schema.ts` Mongoose model is imported and used

### Fix

**Files to change:**

#### 1. `src/server/manager/ChatHistoryManager.ts`
- Remove all MongoDB reads/writes from the manager
- `initialize()` — skip `loadSettings()` and `loadTodayConversation()` DB calls
- `addTurn()` — only push to in-memory `recentTurns[]`, remove the MongoDB `$push` block
- `getHistoryByDate()` — return empty array (no DB query)
- `clearToday()` / `clearAll()` — only clear in-memory array, remove `Conversation.deleteOne/deleteMany`
- `setChatHistoryEnabled()` — only set the in-memory flag, remove `UserSettings.findOneAndUpdate`
- Keep the `chatHistoryEnabled` flag and in-memory logic intact — just cut the DB wire

#### 2. `src/server/db/schemas/conversation.schema.ts`
- No changes needed — keep the schema file, just don't use it. Can be wired back in later.

### Why not just remove MongoDB entirely?
MongoDB connection is still used by other parts of the app (settings API, etc.). We're only disabling chat history DB operations — not removing the DB connection itself.

---

## All Affected Files

| File | Problem | Change |
|------|---------|--------|
| `src/server/manager/ChatHistoryManager.ts` | No photo data stored + DB writes | Add `photoDataUrl` to turn, remove all MongoDB operations |
| `src/server/manager/QueryProcessor.ts` | Doesn't pass photo to `addTurn()` | Pass `photoDataUrl` variable (already in scope) |
| `src/server/api/chat.ts` | History messages missing `image` | Add `image: turn.photoDataUrl` to history payload |
| `src/frontend/pages/ChatInterface.tsx` | Scroll jumps on history load | Add scroll container ref, instant scroll on history load |

---

## Verification

1. `bun run dev`
2. Confirm no MongoDB chat reads/writes in server logs (no `💾 Saved conversation turn` or `📚 Loaded X turns`)
3. Say "Hey Mentra" and ask something — photo + text appear in chat
4. **Refresh page** → photo still visible in reloaded chat, page starts at bottom (no scroll animation)
5. Ask another question → new messages smooth-scroll to bottom normally
6. Restart server → history is gone (expected — in-memory only for MVP)

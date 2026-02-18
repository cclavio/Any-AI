# Issue: Agent Hallucinates About Image When Photo Capture Fails

## The Bug

When camera glasses (Mentra Live) user asks "where am I?" but photo capture fails, the agent responds: **"I cannot determine where you are from the image"** — even though there IS no image.

The system prompt unconditionally says "I always receive a photo" (`prompt.ts:180`), so the agent thinks a photo should be there and hallucinates about it.

## SDK Has No Timeout

`requestPhoto()` has no timeout (`@mentra/sdk` source confirmed). If the glasses never respond (Bluetooth drop, camera crash), the Promise hangs forever — blocking the entire query pipeline.

## Core Insight

Only wait for the photo when the query actually needs it.

- **Non-visual query** ("where am I?", "what time is it?") → don't block on photo, answer immediately
- **Visual query** ("what is this?", "read that sign") → wait for photo, because without it the answer is useless

The photo is always fired at wake word time (background). We just change whether we **block** on it.

---

## Proposed Fix (Four Parts)

### Part 1: `isVisualQuery()` — tiny LLM classifier

A single Gemini Flash call (~200ms) that classifies whether the query needs the camera photo. More accurate than regex — handles any phrasing naturally.

```typescript
import { Agent } from "@mastra/core/agent";

const visualClassifier = new Agent({
  id: "visual-classifier",
  name: "Visual Query Classifier",
  model: "google/gemini-2.5-flash",
  instructions: `You classify user queries for a smart glasses AI assistant.
Answer ONLY "yes" or "no" — nothing else.
Is this query about something the user can physically see in their environment right now?
Examples: "what is this?" → yes, "read that sign" → yes, "who is that person?" → yes
Examples: "where am I?" → no, "what time is it?" → no, "tell me a joke" → no`,
});

export async function isVisualQuery(query: string): Promise<boolean> {
  try {
    const result = await visualClassifier.generate([
      { role: "user", content: query }
    ], { maxSteps: 1 });
    return result.text.trim().toLowerCase().startsWith("yes");
  } catch {
    return false; // on error, default to non-visual (fast path)
  }
}
```

**Why LLM over regex:** Regex misses "can you see what's ahead?", "tell me about that building", "what brand are those shoes?" etc. The LLM handles any phrasing. 200ms is free — it runs while the photo is still in-flight from wake word time.

**Default on error:** `false` (non-visual). If the classifier fails, we go fast path — worst case the agent answers without a photo that wasn't needed anyway.

**File:** new file `src/server/agent/visual-classifier.ts`

### Part 2: Smart photo await (parallel in TranscriptionManager)

**In `TranscriptionManager.processCurrentQuery()`** — fire classifier while photo is still in-flight, then decide:

```typescript
const hasCamera = this.user.appSession?.capabilities?.hasCamera ?? false;

// 1. Fire classifier immediately (photo still in-flight from wake word)
const isVisualPromise = hasCamera ? isVisualQuery(query) : Promise.resolve(false);

// 2. Wait for classifier result (~200ms, photo gets more time to finish)
const isVisual = await isVisualPromise;

// 3. Bail if session was destroyed while classifier was running
if (this.destroyed) return;

// 4. Now decide how to handle the photo
let prePhoto: StoredPhoto | null = null;
if (this.pendingPhoto) {
  if (isVisual) {
    // VISUAL — wait for photo (10s safety timeout)
    let timeoutId: NodeJS.Timeout;
    prePhoto = await Promise.race([
      this.pendingPhoto,
      new Promise<null>(r => { timeoutId = setTimeout(() => r(null), 10000); })
    ]);
    clearTimeout(timeoutId!);
  } else {
    // NON-VISUAL — grab photo only if already settled (setTimeout(0) = next macrotask)
    // NOTE: Promise.resolve(null) would ALWAYS win (same microtask queue).
    // setTimeout(0) lets an already-settled photo win the race, but skips if still pending.
    prePhoto = await Promise.race([
      this.pendingPhoto,
      new Promise<null>(r => setTimeout(() => r(null), 0))
    ]);
  }
  this.pendingPhoto = null;
}

// 5. Bail again if session destroyed during photo wait
if (this.destroyed) return;

// 6. Pass everything to QueryProcessor
await this.onQueryReady(query, speakerId, prePhoto, isVisual);
```

**Callback signature change:** `onQueryReady` gets a new 4th param `isVisual: boolean`. This also affects:
- `OnQueryReadyCallback` type definition in `TranscriptionManager.ts`
- The callback wiring in `MentraAI.ts:51` where `onQueryReady` is set
- `QueryProcessor.processQuery()` signature — adds `isVisual?: boolean` param

**QueryProcessor uses `isVisual` only for the fallback path:**
- Visual + no prePhoto → fire `takePhoto()` with 10s timeout
- Non-visual + no prePhoto → skip entirely, no fallback capture

**G1 display glasses:** `isVisualQuery()` is never called (no camera). `isVisual` is always `false`.

**Files:** `TranscriptionManager.ts`, `QueryProcessor.ts`, `MentraAI.ts`

### Part 3: Tell agent when no photo available

Pass `hasPhotos: boolean` through agent context. Use `photoDataUrl !== undefined` as the signal (not `photos.length` — avoids stale photo false positive from previous queries).

- `hasCamera && hasPhotos` → full vision section (same as today)
- `hasCamera && !hasPhotos` → swap in:

```
## Vision (Camera)

The glasses have a camera, but NO photo was captured for this query (camera error or non-visual query).
Do NOT reference, describe, or mention any image. Answer using your knowledge, location data, and web search instead.
If the user asked a visual question ("what is this?", "what am I looking at?"), let them know the camera couldn't capture a photo and ask them to try again.
```

**Files:** `prompt.ts`, `MentraAgent.ts`, `QueryProcessor.ts`

### Part 4: Session disconnect safety

Add `destroyed` flag to `TranscriptionManager`. Check at two points:
1. After classifier await (before photo decision)
2. After photo await (before calling onQueryReady)

```typescript
private destroyed = false;

destroy(): void {
  this.destroyed = true;
  this.clearTimers();
  this.unsubscribe?.();
  this.unsubscribe = null;
  this.sseClients.clear();
  this.resetState();
}
```

**File:** `TranscriptionManager.ts`

---

## Pipeline Flow

```
Wake word → fire takePhoto() in background
  ↓
User speaks → transcript accumulates → silence → query ready
  ↓
[TranscriptionManager]
  1. Fire isVisualQuery(query) → ~200ms (photo still in-flight during this)
  2. Get isVisual result, check destroyed flag
  3. isVisual?
     YES → await photo (10s safety timeout)
     NO  → grab photo only if already settled (setTimeout(0) race)
  4. Check destroyed flag again
  5. Pass (query, speakerId, prePhoto, isVisual) → QueryProcessor
  ↓
[QueryProcessor]
  6. Has prePhoto?
     YES → use it
     NO + isVisual → fallback takePhoto() with 10s timeout
     NO + !isVisual → skip photo entirely
  7. Set hasPhotos = photoDataUrl !== undefined
  8. Build agent context with hasPhotos
  9. Agent responds (with or without photo)
```

**G1 display glasses:** Steps 1-3 skipped entirely (no camera). `isVisual = false`, no photo logic.

## Agent Behavior Matrix

| Query | isVisual | Photo ready? | Wait? | Agent response |
|-------|----------|-------------|-------|----------------|
| "where am I?" | NO | Yes | No | GPS + photo context |
| "where am I?" | NO | No | No | GPS only — fast answer |
| "what time is it?" | NO | Yes/No | No | Answers from time context |
| "what is this?" | YES | Yes | Yes (instant) | Analyzes image |
| "what is this?" | YES | No (slow) | Yes (waits) | Analyzes image after wait |
| "what is this?" | YES | Never | Yes (10s) | "Camera couldn't capture, try again" |

## Expected Behavior

| Scenario | Before | After |
|----------|--------|-------|
| Photo OK + any query | Works | No change |
| Photo slow + "where am I?" | Waits unnecessarily | Answers immediately |
| Photo FAILS + "where am I?" | "I cannot determine from the image" | Uses GPS |
| Photo FAILS + "what is this?" | "The image doesn't show..." | "Camera couldn't capture, try again" |
| Photo HANGS + non-visual | Pipeline blocked forever | Answers immediately |
| Photo HANGS + visual | Pipeline blocked forever | 10s timeout, then "camera failed" |
| Session disconnect mid-wait | Zombie query | Bails immediately (destroyed flag) |

## Files Summary

| File | Change |
|------|--------|
| `src/server/agent/visual-classifier.ts` | **New** — tiny LLM agent for `isVisualQuery()` |
| `src/server/agent/prompt.ts` | Add `hasPhotos` to `AgentContext`, conditional vision section |
| `src/server/agent/MentraAgent.ts` | Add `hasPhotos` to `GenerateOptions.context`, pass through to `agentContext` |
| `src/server/manager/TranscriptionManager.ts` | Smart photo await, `destroyed` flag, updated `OnQueryReadyCallback` type |
| `src/server/manager/QueryProcessor.ts` | Add `isVisual` param, smart fallback photo, `hasPhotos` from `photoDataUrl` |
| `src/server/MentraAI.ts` | Update callback wiring to pass `isVisual` through |

## Verification

1. Camera glasses + "what time is it?" → instant answer, no photo wait in logs
2. Camera glasses + "what is this?" → waits for photo, includes it in response
3. Disconnect camera → "what is this?" → waits, times out, "camera couldn't capture"
4. Disconnect camera → "where am I?" → instant GPS answer, no mention of image
5. Close app while photo is in-flight → no zombie query in logs
6. Display glasses (G1) → no change, no classifier LLM call

/**
 * Bridge API routes — Claude Code ↔ Mentra glasses bridge.
 *
 * Mounted at /api/bridge/ with its own auth (API key hash),
 * separate from the SDK auth middleware used by the webview routes.
 */

import { Hono } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import { bridgeAuth, requirePaired, hashApiKey } from "./bridge-auth";
import { sessions } from "../manager/SessionManager";
import { db } from "../db/client";
import { claudeMentraPairs, pairingCodes, bridgeRequests } from "../db/schema";
import type {
  BridgeNotifyRequest,
  BridgeSpeakRequest,
  BridgePairGenerateResponse,
  BridgePairStatusResponse,
  BridgePendingResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

type BridgeEnv = {
  Variables: {
    bridgeApiKeyHash: string;
    bridgeMentraUserId: string;
    bridgeDisplayName: string;
  };
};

export const bridgeApi = new Hono<BridgeEnv>();

// All bridge routes require API key auth
bridgeApi.use("/*", bridgeAuth);

// ─── Health ───

bridgeApi.get("/health", (c) => {
  return c.json({ status: "ok", service: "mentra-bridge" });
});

// ─── Pairing ───

/**
 * POST /pair/generate — Generate a 6-digit pairing code.
 * Auth: API key hash only (no pairing required).
 */
bridgeApi.post("/pair/generate", async (c) => {
  const apiKeyHash = c.get("bridgeApiKeyHash") as string;

  // Check if already paired
  const [existing] = await db
    .select()
    .from(claudeMentraPairs)
    .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
    .limit(1);

  if (existing) {
    return c.json({ error: "Already paired. Unpair first to re-pair." }, 400);
  }

  // Generate 6-digit code with collision check
  let code: string;
  let attempts = 0;
  do {
    code = Math.random().toString().slice(2, 8).padStart(6, "0");
    const [collision] = await db
      .select()
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);
    if (!collision) break;
    attempts++;
  } while (attempts < 10);

  // Clean up any existing codes for this key
  await db.delete(pairingCodes).where(eq(pairingCodes.apiKeyHash, apiKeyHash));

  // Insert new code with 10-minute expiry
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(pairingCodes).values({
    code,
    apiKeyHash,
    expiresAt,
  });

  const response: BridgePairGenerateResponse = {
    code,
    expiresInSeconds: 600,
    instructions: `Enter this code in your Mentra glasses app Settings → Claude Bridge to complete pairing.`,
  };

  return c.json(response);
});

/**
 * GET /pair/status — Check pairing status.
 * Auth: API key hash only.
 */
bridgeApi.get("/pair/status", async (c) => {
  const apiKeyHash = c.get("bridgeApiKeyHash") as string;

  const [pair] = await db
    .select()
    .from(claudeMentraPairs)
    .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
    .limit(1);

  const response: BridgePairStatusResponse = pair
    ? { paired: true, displayName: pair.displayName ?? undefined }
    : { paired: false };

  return c.json(response);
});

// ─── Paired-only routes ───

/**
 * POST /notify — Send a message and wait for voice response (long-poll).
 * Auth: API key + paired.
 */
bridgeApi.post("/notify", requirePaired, async (c) => {
  const mentraUserId = c.get("bridgeMentraUserId") as string;
  const apiKeyHash = c.get("bridgeApiKeyHash") as string;
  const body = await c.req.json<BridgeNotifyRequest>();

  if (!body.message?.trim()) {
    return c.json({ error: "Message is required" }, 400);
  }

  const user = sessions.get(mentraUserId);
  if (!user?.appSession) {
    return c.json({ error: "Glasses offline. The user's smart glasses are not connected." }, 503);
  }

  const requestId = crypto.randomUUID();
  const timeoutMs = body.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const result = await user.bridge.handleNotify(body.message, requestId, timeoutMs);

    // Enrich the DB log with apiKeyHash (BridgeManager logs with empty hash)
    db.update(bridgeRequests)
      .set({ apiKeyHash })
      .where(eq(bridgeRequests.id, requestId))
      .catch(() => {});

    return c.json(result);
  } catch (err: any) {
    if (err.message === "Glasses offline") {
      return c.json({ error: "Glasses went offline during request" }, 503);
    }
    if (err.message?.includes("already parked")) {
      return c.json({ error: err.message }, 409);
    }
    return c.json({ error: err.message || "Internal error" }, 500);
  }
});

/**
 * POST /speak — Fire-and-forget announcement (no response needed).
 * Auth: API key + paired.
 */
bridgeApi.post("/speak", requirePaired, async (c) => {
  const mentraUserId = c.get("bridgeMentraUserId") as string;
  const apiKeyHash = c.get("bridgeApiKeyHash") as string;
  const body = await c.req.json<BridgeSpeakRequest>();

  if (!body.message?.trim()) {
    return c.json({ error: "Message is required" }, 400);
  }

  const user = sessions.get(mentraUserId);
  if (!user?.appSession) {
    return c.json({ error: "Glasses offline" }, 503);
  }

  try {
    await user.bridge.handleSpeak(body.message);

    // Log to DB
    db.insert(bridgeRequests)
      .values({
        apiKeyHash,
        mentraUserId,
        conversationId: body.conversationId ?? null,
        message: body.message,
        status: "responded",
        respondedAt: new Date(),
      })
      .catch(() => {});

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to speak" }, 500);
  }
});

/**
 * POST /end — End bridge conversation with optional farewell.
 * Auth: API key + paired.
 */
bridgeApi.post("/end", requirePaired, async (c) => {
  const mentraUserId = c.get("bridgeMentraUserId") as string;
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const farewell = typeof body.message === "string" ? body.message : undefined;

  const user = sessions.get(mentraUserId);
  if (user) {
    await user.bridge.handleEnd(farewell).catch(() => {});
  }

  return c.json({ ended: true });
});

/**
 * GET /pending — Retrieve timeout-deferred messages (last resort).
 * Auth: API key + paired.
 */
bridgeApi.get("/pending", requirePaired, async (c) => {
  const apiKeyHash = c.get("bridgeApiKeyHash") as string;

  // Get timeout and timeout_responded messages
  const rows = await db
    .select()
    .from(bridgeRequests)
    .where(
      and(
        eq(bridgeRequests.apiKeyHash, apiKeyHash),
        inArray(bridgeRequests.status, ["timeout", "timeout_responded"]),
      ),
    );

  const pending = rows
    .filter((r) => r.status === "timeout")
    .map((r) => ({
      requestId: r.id,
      message: r.message,
      conversationId: r.conversationId ?? undefined,
      deferredAt: r.createdAt.toISOString(),
    }));

  const answered = rows
    .filter((r) => r.status === "timeout_responded")
    .map((r) => ({
      requestId: r.id,
      message: r.message,
      conversationId: r.conversationId ?? undefined,
      response: r.response ?? undefined,
      deferredAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString(),
    }));

  // Mark answered messages as consumed
  const answeredIds = answered.map((a) => a.requestId);
  if (answeredIds.length > 0) {
    db.update(bridgeRequests)
      .set({ status: "consumed" })
      .where(inArray(bridgeRequests.id, answeredIds))
      .catch(() => {});
  }

  const response: BridgePendingResponse = { pending, answered };
  return c.json(response);
});

// ─── Pairing confirmation (called from webview, behind SDK auth) ───

/**
 * Confirm a pairing code — called from the Mentra phone app webview.
 * This handler is mounted on the SDK-auth-protected router, not the bridge router.
 */
export async function confirmPairing(c: any) {
  const userId = c.get("authUserId") as string;
  const { code } = await c.req.json();

  if (!code?.trim()) {
    return c.json({ error: "Pairing code is required" }, 400);
  }

  // Look up code
  const [pairingCode] = await db
    .select()
    .from(pairingCodes)
    .where(eq(pairingCodes.code, code.trim()))
    .limit(1);

  if (!pairingCode) {
    return c.json({ error: "Invalid pairing code" }, 400);
  }

  if (new Date() > pairingCode.expiresAt) {
    await db.delete(pairingCodes).where(eq(pairingCodes.code, code.trim()));
    return c.json({ error: "Pairing code expired" }, 400);
  }

  if (pairingCode.claimedBy) {
    return c.json({ error: "Code already used" }, 400);
  }

  // Create the pairing
  await db.insert(claudeMentraPairs).values({
    apiKeyHash: pairingCode.apiKeyHash,
    mentraUserId: userId,
    displayName: `User ${userId.slice(0, 8)}`,
  });

  // Mark code as claimed
  await db
    .update(pairingCodes)
    .set({ claimedBy: userId, claimedAt: new Date() })
    .where(eq(pairingCodes.code, code.trim()));

  return c.json({ success: true });
}

/**
 * Generate a bridge API key — called from Settings webview.
 * Creates the pairing immediately (user is already authenticated via SDK).
 * Returns the raw key once — it's never stored, only the hash.
 */
export async function generateBridgeApiKey(c: any) {
  const userId = c.get("authUserId") as string;

  // Check if already paired
  const [existing] = await db
    .select()
    .from(claudeMentraPairs)
    .where(eq(claudeMentraPairs.mentraUserId, userId))
    .limit(1);

  if (existing) {
    return c.json(
      { error: "Already paired. Unpair first to generate a new key." },
      400,
    );
  }

  // Generate key: anyai_bridge_ + 32 hex chars
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const apiKey = `anyai_bridge_${hex}`;

  // Hash and store
  const apiKeyHash = hashApiKey(apiKey);
  await db.insert(claudeMentraPairs).values({
    apiKeyHash,
    mentraUserId: userId,
    displayName: `User ${userId.slice(0, 8)}`,
  });

  const baseUrl = process.env.PUBLIC_URL || "https://your-app.railway.app";

  return c.json({
    apiKey,
    mcpCommand: `claude mcp add --transport http mentra-bridge -- ${baseUrl}/api/mcp?key=${apiKey}`,
  });
}

/**
 * Get pairing status for the current webview user.
 */
export async function getPairingStatus(c: any) {
  const userId = c.get("authUserId") as string;

  const [pair] = await db
    .select()
    .from(claudeMentraPairs)
    .where(eq(claudeMentraPairs.mentraUserId, userId))
    .limit(1);

  return c.json({
    paired: !!pair,
    displayName: pair?.displayName ?? undefined,
  });
}

/**
 * Unpair — remove the Claude Code pairing for the current user.
 */
export async function unpairBridge(c: any) {
  const userId = c.get("authUserId") as string;

  await db
    .delete(claudeMentraPairs)
    .where(eq(claudeMentraPairs.mentraUserId, userId));

  return c.json({ success: true });
}

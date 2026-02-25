/**
 * Bridge API authentication middleware.
 * Uses SHA-256 hashed API keys — no Vault storage needed.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { claudeMentraPairs } from "../db/schema";

/** SHA-256 hash a string using Bun's built-in crypto */
export function hashApiKey(key: string): string {
  return new Bun.CryptoHasher("sha256").update(key).digest("hex");
}

/**
 * Bridge auth middleware — reads Bearer token, hashes it, sets context vars.
 */
export async function bridgeAuth(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return c.json({ error: "Empty API key" }, 401);
  }

  const apiKeyHash = hashApiKey(apiKey);
  c.set("bridgeApiKeyHash", apiKeyHash);

  await next();
}

/**
 * Paired-only middleware — requires an existing pairing for the API key.
 * Must run after bridgeAuth.
 */
export async function requirePaired(c: any, next: () => Promise<void>) {
  const apiKeyHash = c.get("bridgeApiKeyHash") as string;
  if (!apiKeyHash) {
    return c.json({ error: "Auth required" }, 401);
  }

  const [pair] = await db
    .select()
    .from(claudeMentraPairs)
    .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
    .limit(1);

  if (!pair) {
    return c.json({ error: "Not paired. Use pair_mentra tool first." }, 400);
  }

  // Update last_seen_at
  db.update(claudeMentraPairs)
    .set({ lastSeenAt: new Date() })
    .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
    .catch(() => {}); // fire-and-forget

  c.set("bridgeMentraUserId", pair.mentraUserId);
  c.set("bridgeDisplayName", pair.displayName);

  await next();
}

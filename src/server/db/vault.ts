/**
 * Supabase Vault Integration
 *
 * API keys are encrypted at rest using Supabase Vault (pgsodium).
 * Keys are never stored as plaintext — encryption/decryption happens in Postgres.
 *
 * Key naming convention: "apikey:{userId}:{provider}:{purpose}"
 */

import { db, isDbAvailable } from "./client";
import { sql } from "drizzle-orm";

/**
 * Store an API key in Supabase Vault.
 * Returns the vault secret ID (UUID) which we store in user_settings.
 */
export async function storeApiKey(
  userId: string,
  provider: string,
  purpose: "llm" | "vision",
  apiKey: string
): Promise<string> {
  if (!isDbAvailable()) throw new Error("Database not available");

  const name = `apikey:${userId}:${provider}:${purpose}`;

  // Upsert: delete existing secret with same name, then insert new one
  await db.execute(sql`
    DELETE FROM vault.secrets WHERE name = ${name}
  `);

  const result = await db.execute(sql`
    SELECT vault.create_secret(${apiKey}, ${name}) as id
  `);

  return (result as any).rows[0].id as string;
}

/**
 * Retrieve a decrypted API key from Vault by secret ID.
 * Returns null if not found.
 */
export async function getApiKey(secretId: string): Promise<string | null> {
  if (!isDbAvailable()) return null;

  const result = await db.execute(sql`
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE id = ${secretId}::uuid
  `);

  return ((result as any).rows[0]?.decrypted_secret as string) ?? null;
}

/**
 * Delete an API key from Vault.
 */
export async function deleteApiKey(secretId: string): Promise<void> {
  if (!isDbAvailable()) return;

  await db.execute(sql`
    DELETE FROM vault.secrets WHERE id = ${secretId}::uuid
  `);
}

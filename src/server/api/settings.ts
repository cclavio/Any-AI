/**
 * User Settings API
 *
 * Handles user settings like theme and chat history preferences.
 *
 * Phase 1: Stubbed to in-memory defaults (Mongoose removed).
 * Phase 2: Will be rewritten to use Drizzle + Supabase.
 */

import type { Context } from "hono";

/** In-memory settings store (Phase 1 stub — replaced by Drizzle in Phase 2) */
const settingsStore = new Map<string, Record<string, any>>();

/**
 * Get user settings
 */
export async function getSettings(c: Context) {
  const userId = c.req.query("userId");

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  try {
    let settings = settingsStore.get(userId);

    if (!settings) {
      settings = {
        userId,
        theme: "dark",
        chatHistoryEnabled: false,
      };
      settingsStore.set(userId, settings);
    }

    return c.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
}

/**
 * Update user settings (partial update)
 */
export async function updateSettings(c: Context) {
  try {
    const body = await c.req.json();
    const { userId, ...updates } = body;

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const existing = settingsStore.get(userId) || {
      userId,
      theme: "dark",
      chatHistoryEnabled: false,
    };

    // Merge updates
    const settings = { ...existing, ...updates };
    settingsStore.set(userId, settings);

    return c.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
}

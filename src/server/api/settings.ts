/**
 * User Settings API
 *
 * Handles user settings (theme, chat history, AI config).
 * Provider config endpoints handle API key validation + Vault storage.
 * Uses Drizzle + Supabase Postgres when available, falls back to in-memory.
 */

import type { Context } from "hono";
import { db, isDbAvailable } from "../db/client";
import { userSettings } from "../db/schema";
import { storeApiKey, deleteApiKey } from "../db/vault";
import { eq } from "drizzle-orm";
import { sessions } from "../manager/SessionManager";
import { MODEL_CATALOG, PROVIDER_DISPLAY_NAMES } from "../agent/providers/types";
import type { Provider } from "../agent/providers/types";
import { validateApiKey } from "../agent/providers/registry";

/** In-memory fallback store (used when DATABASE_URL is not configured) */
const settingsStore = new Map<string, Record<string, any>>();

/**
 * GET /api/settings — Get user settings
 */
export async function getSettings(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    if (isDbAvailable()) {
      const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId));

      if (settings) {
        return c.json(settings);
      }

      const [created] = await db
        .insert(userSettings)
        .values({ userId })
        .returning();

      return c.json(created);
    }

    // Fallback: in-memory
    let settings = settingsStore.get(userId);
    if (!settings) {
      settings = { userId, theme: "dark", chatHistoryEnabled: false };
      settingsStore.set(userId, settings);
    }
    return c.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
}

/**
 * PATCH /api/settings — Update user settings (partial update)
 */
export async function updateSettings(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await c.req.json();
    const { userId: _bodyUserId, id: _id, createdAt: _ca, updatedAt: _ua, ...updates } = body;

    if (isDbAvailable()) {
      const [existing] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId));

      if (!existing) {
        const [created] = await db
          .insert(userSettings)
          .values({ userId, ...updates, updatedAt: new Date() })
          .returning();
        return c.json(created);
      }

      const [updated] = await db
        .update(userSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId))
        .returning();

      // Refresh the live session's in-memory AI config
      await sessions.get(userId)?.reloadAIConfig();

      return c.json(updated);
    }

    // Fallback: in-memory
    const existing = settingsStore.get(userId) || {
      userId, theme: "dark", chatHistoryEnabled: false,
    };
    const settings = { ...existing, ...updates };
    settingsStore.set(userId, settings);
    return c.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
}

/**
 * GET /api/settings/provider — Get provider config (never returns API keys)
 */
export async function getProviderConfig(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    if (!isDbAvailable()) {
      return c.json({
        agentName: "Any AI",
        wakeWord: "Hey Jarvis",
        llm: { provider: "openai", model: "gpt-5-mini", isConfigured: false },
        vision: { provider: "google", model: "gemini-2.5-flash", isConfigured: false },
        googleCloud: { isConfigured: false },
      });
    }

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    if (!settings) {
      return c.json({
        agentName: "Any AI",
        wakeWord: "Hey Jarvis",
        llm: { provider: "openai", model: "gpt-5-mini", isConfigured: false },
        vision: { provider: "google", model: "gemini-2.5-flash", isConfigured: false },
        googleCloud: { isConfigured: false },
      });
    }

    return c.json({
      agentName: settings.agentName,
      wakeWord: settings.wakeWord,
      llm: {
        provider: settings.llmProvider ?? "openai",
        model: settings.llmModel ?? "gpt-5-mini",
        isConfigured: !!settings.llmApiKeyVaultId,
      },
      vision: {
        provider: settings.visionProvider ?? "google",
        model: settings.visionModel ?? "gemini-2.5-flash",
        isConfigured: !!settings.visionApiKeyVaultId,
      },
      googleCloud: {
        isConfigured: !!settings.googleCloudApiKeyVaultId,
      },
    });
  } catch (error) {
    console.error("Error fetching provider config:", error);
    return c.json({ error: "Failed to fetch provider config" }, 500);
  }
}

/**
 * POST /api/settings/provider — Save provider config (validates key, stores in Vault)
 */
export async function saveProviderConfig(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await c.req.json();
    const { purpose, provider, model, apiKey } = body as {
      purpose: "llm" | "vision";
      provider: Provider;
      model: string;
      apiKey: string;
    };

    if (!purpose || !provider || !model || !apiKey) {
      return c.json({ error: "Missing required fields: purpose, provider, model, apiKey" }, 400);
    }

    if (purpose !== "llm" && purpose !== "vision") {
      return c.json({ error: "purpose must be 'llm' or 'vision'" }, 400);
    }

    if (!MODEL_CATALOG[provider]) {
      return c.json({ error: `Unknown provider: ${provider}` }, 400);
    }

    const modelInfo = MODEL_CATALOG[provider].find(m => m.id === model);
    if (!modelInfo) {
      return c.json({ error: `Unknown model: ${model} for provider ${provider}` }, 400);
    }

    if (!isDbAvailable()) {
      return c.json({ error: "Database not available" }, 503);
    }

    // Validate the API key
    const isValid = await validateApiKey(provider, apiKey);
    if (!isValid) {
      return c.json({ success: false, error: `API key validation failed for provider ${provider}` }, 400);
    }

    // Store key in Vault
    const vaultId = await storeApiKey(userId, provider, purpose, apiKey);

    // Update user_settings
    const updateFields = purpose === "llm"
      ? { llmProvider: provider, llmModel: model, llmApiKeyVaultId: vaultId, isAiConfigured: true, updatedAt: new Date() }
      : { visionProvider: provider, visionModel: model, visionApiKeyVaultId: vaultId, updatedAt: new Date() };

    // Ensure row exists
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    if (!existing) {
      await db.insert(userSettings).values({ userId, ...updateFields });
    } else {
      await db
        .update(userSettings)
        .set(updateFields)
        .where(eq(userSettings.userId, userId));
    }

    // Refresh the live session's in-memory AI config
    await sessions.get(userId)?.reloadAIConfig();

    return c.json({ success: true, provider, model, purpose });
  } catch (error) {
    console.error("Error saving provider config:", error);
    return c.json({ error: "Failed to save provider config" }, 500);
  }
}

/**
 * POST /api/settings/provider/validate — Validate API key without saving
 */
export async function validateProviderKey(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await c.req.json();
    const { provider, apiKey } = body as { provider: Provider; apiKey: string };

    if (!provider || !apiKey) {
      return c.json({ error: "Missing required fields: provider, apiKey" }, 400);
    }

    if (!MODEL_CATALOG[provider]) {
      return c.json({ error: `Unknown provider: ${provider}` }, 400);
    }

    const isValid = await validateApiKey(provider, apiKey);
    return c.json({ valid: isValid, provider });
  } catch (error) {
    console.error("Error validating API key:", error);
    return c.json({ error: "Failed to validate API key" }, 500);
  }
}

/**
 * DELETE /api/settings/provider/:purpose — Remove provider config + Vault secret
 */
export async function deleteProviderConfig(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const purpose = c.req.param("purpose") as "llm" | "vision";

    if (purpose !== "llm" && purpose !== "vision") {
      return c.json({ error: "purpose must be 'llm' or 'vision'" }, 400);
    }

    if (!isDbAvailable()) {
      return c.json({ error: "Database not available" }, 503);
    }

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    if (!settings) {
      return c.json({ error: "No settings found" }, 404);
    }

    // Delete Vault secret
    const vaultId = purpose === "llm" ? settings.llmApiKeyVaultId : settings.visionApiKeyVaultId;
    if (vaultId) {
      await deleteApiKey(vaultId);
    }

    // Clear settings fields
    const clearFields = purpose === "llm"
      ? { llmProvider: "openai", llmModel: "gpt-5-mini", llmApiKeyVaultId: null, isAiConfigured: false, updatedAt: new Date() }
      : { visionProvider: "google", visionModel: "gemini-2.5-flash", visionApiKeyVaultId: null, updatedAt: new Date() };

    await db
      .update(userSettings)
      .set(clearFields)
      .where(eq(userSettings.userId, userId));

    // Refresh the live session's in-memory AI config
    await sessions.get(userId)?.reloadAIConfig();

    return c.json({ success: true, purpose });
  } catch (error) {
    console.error("Error deleting provider config:", error);
    return c.json({ error: "Failed to delete provider config" }, 500);
  }
}

/**
 * POST /api/settings/google-cloud — Save Google Cloud API key (validates, stores in Vault)
 */
export async function saveGoogleCloudKey(c: Context) {
  const userId = c.get("authUserId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json();
    const { apiKey } = body as { apiKey: string };

    if (!apiKey) {
      return c.json({ error: "Missing required field: apiKey" }, 400);
    }

    if (!isDbAvailable()) {
      return c.json({ error: "Database not available" }, 503);
    }

    // Validate the key by calling Google Timezone API with a test request
    const isValid = await validateGoogleCloudApiKey(apiKey);
    if (!isValid) {
      return c.json({ success: false, error: "Google Cloud API key validation failed. Ensure the Timezone API is enabled." }, 400);
    }

    // Store key in Vault
    const vaultId = await storeApiKey(userId, "google", "cloud", apiKey);

    // Ensure row exists and update
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    if (!existing) {
      await db.insert(userSettings).values({ userId, googleCloudApiKeyVaultId: vaultId, updatedAt: new Date() });
    } else {
      // Delete old Vault secret if replacing
      if (existing.googleCloudApiKeyVaultId) {
        await deleteApiKey(existing.googleCloudApiKeyVaultId);
      }
      await db
        .update(userSettings)
        .set({ googleCloudApiKeyVaultId: vaultId, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId));
    }

    // Refresh the live session's in-memory AI config
    await sessions.get(userId)?.reloadAIConfig();

    return c.json({ success: true });
  } catch (error) {
    console.error("Error saving Google Cloud key:", error);
    return c.json({ error: "Failed to save Google Cloud key" }, 500);
  }
}

/**
 * DELETE /api/settings/google-cloud — Remove Google Cloud API key
 */
export async function deleteGoogleCloudKey(c: Context) {
  const userId = c.get("authUserId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  try {
    if (!isDbAvailable()) {
      return c.json({ error: "Database not available" }, 503);
    }

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    if (!settings) {
      return c.json({ error: "No settings found" }, 404);
    }

    // Delete Vault secret
    if (settings.googleCloudApiKeyVaultId) {
      await deleteApiKey(settings.googleCloudApiKeyVaultId);
    }

    // Clear the column
    await db
      .update(userSettings)
      .set({ googleCloudApiKeyVaultId: null, updatedAt: new Date() })
      .where(eq(userSettings.userId, userId));

    // Refresh the live session's in-memory AI config
    await sessions.get(userId)?.reloadAIConfig();

    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting Google Cloud key:", error);
    return c.json({ error: "Failed to delete Google Cloud key" }, 500);
  }
}

/**
 * POST /api/settings/google-cloud/validate — Validate Google Cloud API key without saving
 */
export async function validateGoogleCloudKeyEndpoint(c: Context) {
  const userId = c.get("authUserId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json();
    const { apiKey } = body as { apiKey: string };

    if (!apiKey) {
      return c.json({ error: "Missing required field: apiKey" }, 400);
    }

    const isValid = await validateGoogleCloudApiKey(apiKey);
    return c.json({ valid: isValid });
  } catch (error) {
    console.error("Error validating Google Cloud key:", error);
    return c.json({ error: "Failed to validate Google Cloud key" }, 500);
  }
}

/**
 * Validate a Google Cloud API key by calling the Timezone API with a test request.
 * Uses location=0,0 (null island) and timestamp=0 — returns OK if the key is valid and Timezone API is enabled.
 */
async function validateGoogleCloudApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `https://maps.googleapis.com/maps/api/timezone/json?location=0,0&timestamp=0&key=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return false;
    const data = await response.json();
    // status "OK" or "ZERO_RESULTS" both indicate a valid key
    return data.status === "OK" || data.status === "ZERO_RESULTS";
  } catch {
    return false;
  }
}

/**
 * GET /api/providers/catalog — Static model catalog for frontend
 */
export async function getProviderCatalog(c: Context) {
  const providers: Record<string, { name: string; models: typeof MODEL_CATALOG[Provider] }> = {};

  for (const [key, models] of Object.entries(MODEL_CATALOG)) {
    providers[key] = {
      name: PROVIDER_DISPLAY_NAMES[key as Provider],
      models,
    };
  }

  return c.json({ providers });
}

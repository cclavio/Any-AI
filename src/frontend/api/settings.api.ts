// API functions for user settings and provider configuration

const getApiUrl = () => window.location.origin;

export interface UserSettings {
  userId: string;
  theme: 'light' | 'dark';
  chatHistoryEnabled: boolean;
  agentName?: string;
  wakeWord?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProviderConfig {
  agentName: string;
  wakeWord: string;
  llm: { provider: string; model: string; isConfigured: boolean; customBaseUrl?: string; customProviderName?: string };
  vision: { provider: string; model: string; isConfigured: boolean; customBaseUrl?: string; customProviderName?: string };
  googleCloud: { isConfigured: boolean };
}

export interface ModelInfo {
  id: string;
  name: string;
  supportsVision: boolean;
}

export interface ProviderCatalogEntry {
  name: string;
  models: ModelInfo[];
}

export type ProviderCatalog = Record<string, ProviderCatalogEntry>;

// ─── User Settings ───

/**
 * Fetch user settings from the API
 */
export const fetchUserSettings = async (): Promise<UserSettings> => {
  const response = await fetch(`${getApiUrl()}/api/settings`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch settings");
  return response.json();
};

/**
 * Update user settings (partial update)
 */
export const updateUserSettings = async (
  updates: Partial<Omit<UserSettings, 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<UserSettings> => {
  const response = await fetch(`${getApiUrl()}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error("Failed to update settings");
  return response.json();
};

/**
 * Update only the theme setting
 */
export const updateTheme = async (theme: 'light' | 'dark'): Promise<UserSettings> => {
  return updateUserSettings({ theme });
};

/**
 * Update only the chatHistoryEnabled setting
 */
export const updateChatHistoryEnabled = async (
  chatHistoryEnabled: boolean
): Promise<UserSettings> => {
  return updateUserSettings({ chatHistoryEnabled });
};

// ─── Provider Configuration ───

/**
 * Get current provider configuration (never includes API keys)
 */
export const fetchProviderConfig = async (): Promise<ProviderConfig> => {
  const response = await fetch(`${getApiUrl()}/api/settings/provider`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch provider config");
  return response.json();
};

/**
 * Save provider configuration (validates key, stores in Vault)
 */
export const saveProviderConfig = async (params: {
  purpose: "llm" | "vision";
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  providerName?: string;
}): Promise<{ success: boolean; error?: string }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/provider`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!response.ok) {
    return { success: false, error: data.error || "Failed to save provider config" };
  }
  return data;
};

/**
 * Validate an API key without saving
 */
export const validateProviderKey = async (
  provider: string,
  apiKey: string
): Promise<{ valid: boolean; provider: string }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/provider/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider, apiKey }),
  });
  if (!response.ok) throw new Error("Failed to validate API key");
  return response.json();
};

/**
 * Validate a custom/local endpoint is reachable
 */
export const validateCustomEndpoint = async (
  baseUrl: string,
  apiKey?: string,
): Promise<{ reachable: boolean; error?: string }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/provider/validate-custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ baseUrl, apiKey }),
  });
  if (!response.ok) throw new Error("Failed to validate custom endpoint");
  return response.json();
};

/**
 * Delete provider configuration and Vault secret
 */
export const deleteProviderConfig = async (
  purpose: "llm" | "vision"
): Promise<{ success: boolean }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/provider/${purpose}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to delete provider config");
  return response.json();
};

/**
 * Fetch the static model catalog (providers + models)
 */
export const fetchProviderCatalog = async (): Promise<ProviderCatalog> => {
  const response = await fetch(`${getApiUrl()}/api/providers/catalog`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch provider catalog");
  const data = await response.json();
  return data.providers;
};

// ─── Google Cloud API Key ───

/**
 * Save Google Cloud API key (validates, stores in Vault)
 */
export const saveGoogleCloudKey = async (
  apiKey: string
): Promise<{ success: boolean; error?: string }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/google-cloud`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ apiKey }),
  });
  const data = await response.json();
  if (!response.ok) {
    return { success: false, error: data.error || "Failed to save Google Cloud key" };
  }
  return data;
};

/**
 * Delete Google Cloud API key
 */
export const deleteGoogleCloudKey = async (): Promise<{ success: boolean }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/google-cloud`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to delete Google Cloud key");
  return response.json();
};

/**
 * Validate Google Cloud API key without saving
 */
export const validateGoogleCloudKey = async (
  apiKey: string
): Promise<{ valid: boolean }> => {
  const response = await fetch(`${getApiUrl()}/api/settings/google-cloud/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) throw new Error("Failed to validate Google Cloud key");
  return response.json();
};

// ─── Claude Bridge Pairing ───

/**
 * Generate a bridge API key and create the pairing immediately
 */
export const generateBridgeApiKey = async (label?: string): Promise<{
  apiKey?: string;
  mcpCommand?: string;
  error?: string;
}> => {
  const response = await fetch(`${getApiUrl()}/api/pair/generate-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ label }),
  });
  const data = await response.json();
  if (!response.ok) {
    return { error: data.error || "Failed to generate API key" };
  }
  return data;
};

export interface BridgeKeyInfo {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * Get bridge pairing status for the current user (supports multiple keys)
 */
export const getBridgePairingStatus = async (): Promise<{
  paired: boolean;
  keys: BridgeKeyInfo[];
  displayName?: string;
}> => {
  const response = await fetch(`${getApiUrl()}/api/pair/status`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch pairing status");
  return response.json();
};

/**
 * Revoke a specific bridge key or all keys
 */
export const unpairBridge = async (keyId?: string): Promise<{ success: boolean }> => {
  const response = await fetch(`${getApiUrl()}/api/pair/unpair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(keyId ? { keyId } : {}),
  });
  if (!response.ok) throw new Error("Failed to unpair");
  return response.json();
};

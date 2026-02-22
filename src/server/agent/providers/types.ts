/**
 * Provider Types — Multi-provider AI configuration
 *
 * Canonical source of UserAIConfig, MODEL_CATALOG, and provider types.
 * Replaces the Phase 1 shim in MentraAgent.ts.
 */

/** Supported AI providers */
export type Provider = "openai" | "anthropic" | "google";

/** Model definition with metadata */
export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  supportsVision: boolean;
  contextWindow: number;
}

/** Full catalog of available models per provider */
export const MODEL_CATALOG: Record<Provider, ModelInfo[]> = {
  openai: [
    { id: "gpt-4o",       name: "GPT-4o",       provider: "openai", supportsVision: true,  contextWindow: 128000 },
    { id: "gpt-4o-mini",  name: "GPT-4o Mini",   provider: "openai", supportsVision: true,  contextWindow: 128000 },
    { id: "gpt-4.1",      name: "GPT-4.1",       provider: "openai", supportsVision: true,  contextWindow: 1047576 },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini",  provider: "openai", supportsVision: true,  contextWindow: 1047576 },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano",  provider: "openai", supportsVision: true,  contextWindow: 1047576 },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5", provider: "anthropic", supportsVision: true, contextWindow: 200000 },
    { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5",  provider: "anthropic", supportsVision: true, contextWindow: 200000 },
  ],
  google: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", supportsVision: true, contextWindow: 1048576 },
    { id: "gemini-2.5-pro",   name: "Gemini 2.5 Pro",   provider: "google", supportsVision: true, contextWindow: 1048576 },
  ],
};

/** Display names for providers */
export const PROVIDER_DISPLAY_NAMES: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

/**
 * User's AI configuration — loaded from Supabase on session start,
 * held in memory on the User object for the session duration.
 * API keys are decrypted from Vault only when loaded into memory.
 */
export interface UserAIConfig {
  agentName: string;
  wakeWord: string;

  llmProvider: Provider;
  llmModel: string;
  llmModelName: string;
  llmApiKey: string;

  visionProvider: Provider;
  visionModel: string;
  visionApiKey: string;

  isConfigured: boolean;
}

/** Default config for users who haven't configured yet (no API keys) */
export const DEFAULT_AI_CONFIG: Omit<UserAIConfig, "llmApiKey" | "visionApiKey"> = {
  agentName: "Any AI",
  wakeWord: "hey any ai",
  llmProvider: "google",
  llmModel: "gemini-2.5-flash",
  llmModelName: "Gemini 2.5 Flash",
  visionProvider: "google",
  visionModel: "gemini-2.5-flash",
  isConfigured: false,
};

/**
 * Look up the display name for a model ID.
 */
export function getModelDisplayName(provider: Provider, modelId: string): string {
  const models = MODEL_CATALOG[provider];
  return models?.find(m => m.id === modelId)?.name ?? modelId;
}

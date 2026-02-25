/**
 * Provider Registry — AI SDK model resolution
 *
 * Resolves a user's AI config into an AI SDK LanguageModel instance.
 * API keys are passed directly to provider constructors (not env vars).
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { UserAIConfig, Provider } from "./types";
import { MODEL_CATALOG } from "./types";

/**
 * Resolve the user's LLM config into an AI SDK LanguageModel.
 */
export function resolveLLMModel(config: UserAIConfig): LanguageModel {
  if (config.llmProvider === "custom") {
    if (!config.llmCustomBaseUrl) {
      throw new Error("Custom LLM provider requires a base URL");
    }
    return createModelInstance("custom", config.llmModel, config.llmApiKey, config.llmCustomBaseUrl);
  }

  const providerModels = MODEL_CATALOG[config.llmProvider];
  const model = providerModels?.find((m) => m.id === config.llmModel);
  if (!model) {
    throw new Error(`Unknown LLM model: ${config.llmModel}`);
  }

  return createModelInstance(config.llmProvider, config.llmModel, config.llmApiKey);
}

/**
 * Resolve the user's vision config into an AI SDK LanguageModel + metadata.
 */
export function resolveVisionModel(config: UserAIConfig): {
  model: LanguageModel;
  apiKey: string;
  provider: Provider;
} {
  if (config.visionProvider === "none") {
    throw new Error("Vision is disabled (provider set to 'none')");
  }

  if (config.visionProvider === "custom") {
    if (!config.visionCustomBaseUrl) {
      throw new Error("Custom vision provider requires a base URL");
    }
    return {
      model: createModelInstance("custom", config.visionModel, config.visionApiKey, config.visionCustomBaseUrl),
      apiKey: config.visionApiKey,
      provider: "custom",
    };
  }

  const providerModels = MODEL_CATALOG[config.visionProvider];
  const model = providerModels?.find((m) => m.id === config.visionModel);
  if (!model) {
    throw new Error(`Unknown vision model: ${config.visionModel}`);
  }
  if (!model.supportsVision) {
    throw new Error(`Model ${config.visionModel} does not support vision`);
  }

  return {
    model: createModelInstance(config.visionProvider, config.visionModel, config.visionApiKey),
    apiKey: config.visionApiKey,
    provider: config.visionProvider,
  };
}

/** Create an AI SDK LanguageModel for the given provider + model + key */
function createModelInstance(provider: Provider, modelId: string, apiKey: string, baseURL?: string): LanguageModel {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "custom":
      return createOpenAI({ apiKey: apiKey || "not-needed", baseURL })(modelId);
    case "none":
      throw new Error("Cannot create model instance for disabled provider ('none')");
  }
}

/**
 * Validate an API key works for a given provider.
 * Makes a minimal API call — returns true if the key is valid.
 */
export async function validateApiKey(provider: Provider, apiKey: string): Promise<boolean> {
  try {
    switch (provider) {
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok;
      }
      case "anthropic": {
        // Use a minimal request — a 401 means invalid key,
        // any other status (200, 400, 429) means the key is valid
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        // 401 = invalid key, anything else = key is valid
        return res.status !== 401;
      }
      case "google": {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        return res.ok;
      }
      case "custom":
        // Can't validate custom provider keys generically — always pass
        return true;
      case "none":
        // No provider = nothing to validate
        return true;
    }
  } catch {
    return false;
  }
}

/**
 * Validate a custom endpoint is reachable.
 * Attempts GET /models (OpenAI-compatible) with 5s timeout.
 * Returns { reachable, models? } — models is the list if the endpoint returns them.
 */
export async function validateCustomEndpoint(
  baseURL: string,
  apiKey?: string,
): Promise<{ reachable: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { reachable: true };
    }
    return { reachable: false, error: `Server returned ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { reachable: false, error: message };
  }
}

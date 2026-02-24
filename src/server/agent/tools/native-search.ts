/**
 * Native Web Search — Provider-native search tool resolution
 *
 * Resolves the best available search tool for a user's AI config.
 * Models with native web search use the provider's built-in search
 * (Anthropic webSearch, OpenAI webSearch, Google googleSearch).
 * All others fall back to the Jina search tool.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Provider } from "../providers/types";
import { modelSupportsWebSearch } from "../providers/types";
import { searchTool } from "./search.tool";

interface NativeSearchOptions {
  provider: Provider;
  modelId: string;
  apiKey: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
}

/**
 * Resolve the search tool(s) for a given provider and model.
 *
 * Returns a tools-object spread containing either the provider-native
 * web search tool or the Jina fallback. Spread into generateText()'s
 * tools object: `...resolveSearchTools({ ... })`
 */
export function resolveSearchTools(options: NativeSearchOptions): Record<string, any> {
  const { provider, modelId, apiKey, location } = options;

  // Check model-level support before attempting native search
  if (!modelSupportsWebSearch(provider, modelId)) {
    console.log(`🔍 Model ${modelId} does not support native web search, using Jina`);
    return jinaFallback();
  }

  // Build userLocation if we have geocoded data
  const userLocation = location?.city
    ? { type: "approximate" as const, city: location.city, region: location.region, country: location.country }
    : undefined;

  try {
    switch (provider) {
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey });
        console.log(`🔍 Using Anthropic native web search`);
        return {
          web_search: anthropic.tools.webSearch_20250305({
            maxUses: 3,
            ...(userLocation ? { userLocation } : {}),
          }),
        };
      }
      case "openai": {
        const openai = createOpenAI({ apiKey });
        console.log(`🔍 Using OpenAI native web search`);
        return {
          web_search: openai.tools.webSearch({
            searchContextSize: "medium",
            ...(userLocation ? { userLocation } : {}),
          }),
        };
      }
      case "google": {
        const google = createGoogleGenerativeAI({ apiKey });
        console.log(`🔍 Using Google native search grounding`);
        return {
          google_search: google.tools.googleSearch({}),
        };
      }
    }
  } catch (error) {
    console.warn(`⚠️ Native search tool creation failed for ${provider}, falling back to Jina:`, error);
    return jinaFallback();
  }
}

/** Jina fallback — returns the Jina search tool if JINA_API_KEY is configured */
function jinaFallback(): Record<string, any> {
  if (process.env.JINA_API_KEY) {
    console.log(`🔍 Falling back to Jina web search`);
    return { search: searchTool };
  }
  console.warn(`⚠️ No search tool available (native not supported, no JINA_API_KEY)`);
  return {};
}

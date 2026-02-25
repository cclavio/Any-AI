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
 * Common country name → ISO 3166-1 alpha-2 code mapping.
 * Anthropic's web search requires a 2-letter country code.
 */
const COUNTRY_TO_ISO: Record<string, string> = {
  "united states": "US", "united states of america": "US", "usa": "US",
  "canada": "CA", "united kingdom": "GB", "great britain": "GB",
  "australia": "AU", "germany": "DE", "france": "FR", "japan": "JP",
  "china": "CN", "india": "IN", "brazil": "BR", "mexico": "MX",
  "spain": "ES", "italy": "IT", "netherlands": "NL", "sweden": "SE",
  "norway": "NO", "denmark": "DK", "finland": "FI", "switzerland": "CH",
  "austria": "AT", "belgium": "BE", "ireland": "IE", "portugal": "PT",
  "new zealand": "NZ", "south korea": "KR", "singapore": "SG",
  "israel": "IL", "south africa": "ZA", "argentina": "AR", "chile": "CL",
  "colombia": "CO", "peru": "PE", "poland": "PL", "czech republic": "CZ",
  "czechia": "CZ", "romania": "RO", "hungary": "HU", "greece": "GR",
  "turkey": "TR", "thailand": "TH", "vietnam": "VN", "indonesia": "ID",
  "malaysia": "MY", "philippines": "PH", "egypt": "EG", "nigeria": "NG",
  "kenya": "KE", "ukraine": "UA", "russia": "RU", "pakistan": "PK",
  "bangladesh": "BD", "taiwan": "TW", "hong kong": "HK", "iceland": "IS",
  "luxembourg": "LU", "croatia": "HR", "serbia": "RS", "bulgaria": "BG",
  "slovakia": "SK", "slovenia": "SI", "estonia": "EE", "latvia": "LV",
  "lithuania": "LT", "cyprus": "CY", "malta": "MT", "costa rica": "CR",
  "panama": "PA", "puerto rico": "PR", "jamaica": "JM",
  "dominican republic": "DO", "uruguay": "UY", "ecuador": "EC",
  "bolivia": "BO", "paraguay": "PY", "venezuela": "VE", "cuba": "CU",
  "morocco": "MA", "tunisia": "TN", "ghana": "GH", "ethiopia": "ET",
  "tanzania": "TZ", "uganda": "UG", "mozambique": "MZ",
  "saudi arabia": "SA", "united arab emirates": "AE", "qatar": "QA",
  "kuwait": "KW", "bahrain": "BH", "oman": "OM", "jordan": "JO",
  "lebanon": "LB", "iraq": "IQ", "iran": "IR",
  "nepal": "NP", "sri lanka": "LK", "cambodia": "KH", "myanmar": "MM",
};

/** Convert a country name to a 2-letter ISO code, or return as-is if already short. */
function toCountryCode(country: string | undefined): string | undefined {
  if (!country) return undefined;
  if (country.length <= 2) return country.toUpperCase();
  return COUNTRY_TO_ISO[country.toLowerCase()] ?? undefined;
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
  // Country must be a 2-letter ISO code (Anthropic web search requires this)
  const countryCode = toCountryCode(location?.country);
  const userLocation = location?.city
    ? { type: "approximate" as const, city: location.city, region: location.region, ...(countryCode ? { country: countryCode } : {}) }
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
      case "custom":
      case "none":
        // Custom/disabled providers don't support native search — use Jina fallback
        return jinaFallback();
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

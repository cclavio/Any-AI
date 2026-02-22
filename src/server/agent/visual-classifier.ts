/**
 * Visual Query Classifier
 *
 * Determines whether a user query requires the camera photo to answer.
 * Uses the user's configured LLM provider for a fast, lightweight call (~200-300ms).
 *
 * Falls back to Gemini via env var if no user config, or returns false on error.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { resolveLLMModel } from "./providers/registry";
import type { UserAIConfig } from "./providers/types";

const SYSTEM_PROMPT = `You classify queries from a user wearing smart glasses with a camera. The camera sees whatever the user is looking at.
Answer ONLY "yes" or "no".
Would a photo of what the user sees help answer this query?
Say yes if: the user is looking at something physical and the photo would help identify it, read it, describe it, or inspect it. This includes looking at objects, products, signs, food, people, buildings, animals, labels, scenes, or asking what's around them. Also yes if the user asks you to see, look at, or compare visible things.
Say no if: the answer comes purely from non-visual senses (smell, sound), general knowledge, abstract topics, spelling/definitions, or the user is asking about a place/area in general terms (safety, reviews, policies, language) where the photo wouldn't add useful information.
IMPORTANT — Say no for figurative/idiomatic language where visual words are used non-literally. These are NOT about seeing something physical:
- "I see" / "I can see why" = I understand
- "look into" / "look up" = research
- "check this out" / "check out" = pay attention
- "looks like" = seems/appears ("that looks like a good deal", "it looks like rain")
- "keep an eye on" = monitor
- "let me see" = let me think/consider
- "how do I look?" = asking about own appearance (camera can't see user)
- "looking at" in terms of price/numbers = considering/evaluating
- "is this the right X?" where X is an address/info = verifying data, not visual
yes: "what is this?", "read that sign", "translate this text", "is that a good restaurant?" (looking at it), "how much does it cost?" (looking at product), "are those shoes on sale?", "what can you see?", "anything interesting around here?", "which one is better?" (comparing visible items)
no: "where am I?", "what time is it?", "what's that smell?", "check this out", "I can see why that's popular", "can you look into that?", "that looks like a good deal", "how do I look?", "keep an eye on that", "let me see the options", "I see"`;

/**
 * Classify whether a query requires visual context (photo from camera).
 * Uses the user's configured LLM provider if available.
 * Returns false on error (defaults to fast path / non-visual).
 */
export async function isVisualQuery(query: string, aiConfig?: UserAIConfig): Promise<boolean> {
  try {
    // Use AI SDK generateText with the user's configured model
    if (aiConfig?.isConfigured) {
      const model = resolveLLMModel(aiConfig);
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: query,
        maxOutputTokens: 3,
        temperature: 0,
      });
      return result.text.trim().toLowerCase().startsWith("yes");
    }

    // Fallback: use env var Gemini key
    const envKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!envKey) {
      console.warn("No AI config and no GOOGLE_GENERATIVE_AI_API_KEY — skipping visual classification");
      return false;
    }

    const google = createGoogleGenerativeAI({ apiKey: envKey });
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM_PROMPT,
      prompt: query,
      maxOutputTokens: 3,
      temperature: 0,
    });
    return result.text.trim().toLowerCase().startsWith("yes");
  } catch (error) {
    console.warn("Visual classifier failed, defaulting to non-visual:", error);
    return false;
  }
}

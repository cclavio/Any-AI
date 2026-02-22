/**
 * Conversational Closer Classifier
 *
 * Regex-based classification of conversational closers that end an exchange
 * without triggering the AI pipeline. Fast and deterministic — no LLM call.
 *
 * Two categories:
 * - Gratitude: "thanks", "ok thanks", "thank you" → speak "You're welcome!" → IDLE
 * - Dismissal: "no thanks", "I'm good", "that's all" → silent → IDLE
 *
 * Guard: utterances > 8 words are NOT closers (e.g. "thanks for that, now can you also...")
 */

export type CloserType = "gratitude" | "dismissal";

export interface ConversationalCloser {
  type: CloserType;
}

// Anchored to full utterance (^...$) so "thanks for that, now..." doesn't match
const GRATITUDE_PATTERN =
  /^\s*(ok\s+)?(thanks|thank\s+you|thank\s+you\s+so\s+much|thanks\s+a\s+lot|much\s+appreciated|appreciate\s+it)\s*[.!]*\s*$/i;

const DISMISSAL_PATTERN =
  /^\s*(no\s+thanks?|no[\s,]+stop|i'?m\s+(good|done|finished|all\s+set)|that'?s\s+(all|it)|that'?ll\s+do|nope|nah|all\s+(good|set|done)|never\s*mind|nothing\s+else|no\s+more\s+questions|not\s+right\s+now|we'?re\s+good|good\s*bye|bye|see\s+ya?|later|ok\s+(bye|that'?s\s+it))\s*[.!]*\s*$/i;

/**
 * Classify a transcribed query as a conversational closer, or null if it
 * should continue through the normal pipeline.
 */
export function classifyCloser(query: string): ConversationalCloser | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Guard: too many words — not a simple closer
  if (trimmed.split(/\s+/).length > 8) return null;

  // Check dismissal first (contains words like "no thanks" that overlap with gratitude)
  if (DISMISSAL_PATTERN.test(trimmed)) return { type: "dismissal" };
  if (GRATITUDE_PATTERN.test(trimmed)) return { type: "gratitude" };

  return null;
}

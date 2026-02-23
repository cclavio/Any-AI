/**
 * Comprehension Failure Classifier
 *
 * Regex-based detection of AI responses that indicate the agent couldn't
 * understand the user's speech. Follows the same pattern as conversational-closers.ts.
 *
 * Used by TranscriptionManager to track consecutive failures and auto-close
 * exchanges after repeated comprehension failures (noisy environment, mumbling).
 *
 * Intentionally broad — false positives are low-risk since 2 consecutive
 * hits are required before triggering auto-close.
 */

const COMPREHENSION_FAILURE_PATTERN =
  /(?:could\s+you\s+(?:repeat|say)\s+that|can\s+you\s+(?:repeat|say)\s+that|(?:i\s+)?didn'?t\s+(?:catch|understand|hear|get)\s+that|(?:i\s+)?couldn'?t\s+(?:catch|understand|hear|make\s+out)\s+(?:that|what\s+you\s+said)|(?:i'?m\s+)?(?:having\s+trouble|unable\s+to)\s+understand|(?:i'?m\s+)?not\s+sure\s+what\s+you\s+said|(?:can|could)\s+you\s+(?:please\s+)?(?:say|repeat)\s+(?:that|it)\s+again|sorry,?\s+(?:i\s+)?(?:didn'?t|couldn'?t)\s+(?:catch|understand|hear)|what\s+(?:was|did)\s+(?:that|you\s+say)|(?:please|could\s+you)\s+(?:try\s+)?(?:again|rephrase)|i\s+(?:missed|lost)\s+(?:that|what\s+you\s+said))/i;

/**
 * Detect whether an AI response indicates a comprehension failure
 * (the agent couldn't understand the user's speech).
 */
export function isComprehensionFailure(agentResponse: string): boolean {
  if (!agentResponse) return false;
  return COMPREHENSION_FAILURE_PATTERN.test(agentResponse);
}

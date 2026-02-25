/**
 * Bridge voice command classifiers — regex-based, fast, deterministic.
 * Follows the same pattern as conversational-closers.ts and device-commands.ts.
 */

// --- Deferral detection (user is busy, defer the Claude message) ---

export type BridgeDeferral = { type: "busy" };

const BRIDGE_DEFERRAL_PATTERN =
  /^\s*(i'?m\s+(busy|occupied|in\s+a\s+meeting|driving|not\s+available)|not\s+(now|right\s+now)|later|hold\s+(on|that)|save\s+(it|that)|come\s+back\s+later|can'?t\s+(talk|respond)\s*(right\s+now)?)\s*[.!]*\s*$/i;

export function classifyBridgeDeferral(query: string): BridgeDeferral | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (trimmed.split(/\s+/).length > 10) return null; // guard: too long to be a deferral
  if (BRIDGE_DEFERRAL_PATTERN.test(trimmed)) return { type: "busy" };
  return null;
}

// --- Bridge command detection (user wants to interact with parked messages) ---

export type BridgeCommand = { type: "check_messages" };

const BRIDGE_CHECK_MESSAGES_PATTERN =
  /\b(i'?m\s+ready(\s+now)?|check\s+(my\s+)?messages?|what\s+did\s+claude\s+(need|ask|want|say)|claude('?s)?\s+(message|question)|pending\s+messages?|any\s+messages?\s+from\s+claude)\b/i;

export function classifyBridgeCommand(query: string): BridgeCommand | null {
  if (BRIDGE_CHECK_MESSAGES_PATTERN.test(query)) return { type: "check_messages" };
  return null;
}

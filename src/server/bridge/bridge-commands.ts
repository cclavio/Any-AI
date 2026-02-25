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

// --- Acceptance detection (user wants to hear the message) ---

export type BridgeAcceptance = { type: "accept" };

const BRIDGE_ACCEPTANCE_PATTERN =
  /^\s*(let'?s?\s+hear\s+it|go\s+ahead|what\s+(is\s+it|did\s+(they|claude|he|she)\s+(say|ask|want|need))|sure|yes|yeah|yep|ok(ay)?|read\s+it|tell\s+me|shoot|let'?s?\s+go|i'?m\s+listening|what'?s?\s+up|bring\s+it|lay\s+it\s+on\s+me|great[,!]?\s+let'?s?\s+hear\s+it)\s*[.!?]*\s*$/i;

export function classifyBridgeAcceptance(query: string): BridgeAcceptance | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (trimmed.split(/\s+/).length > 12) return null; // guard: too long to be acceptance
  if (BRIDGE_ACCEPTANCE_PATTERN.test(trimmed)) return { type: "accept" };
  return null;
}

// --- Bridge command detection (user wants to interact with parked messages) ---

export type BridgeCommand = { type: "check_messages" };

const BRIDGE_CHECK_MESSAGES_PATTERN =
  /\b(i'?m\s+ready(\s+now)?|check\s+(my\s+)?messages?|what\s+did\s+claude\s+(need|ask|want|say|send|write)|what\s+(did|does)\s+claude\s+code\s+(need|ask|want|say|send|have)|claude('?s)?\s+(message|question|request|update)|pending\s+messages?|any\s+(messages?|updates?)\s+from\s+claude|does\s+claude(\s+code)?\s+have\s+(a\s+)?(message|something|anything|an?\s+update)|did\s+claude(\s+code)?\s+(say|send|ask|want|write|leave)\s+(something|anything|a\s+message|me\s+something)|anything\s+from\s+claude(\s+code)?|claude(\s+code)?\s+(waiting|pending)|go\s+back\s+to\s+claude(\s+code)?|get\s+back\s+to\s+claude(\s+code)?|respond\s+to\s+claude(\s+code)?|reply\s+to\s+claude(\s+code)?)\b/i;

export function classifyBridgeCommand(query: string): BridgeCommand | null {
  if (BRIDGE_CHECK_MESSAGES_PATTERN.test(query)) return { type: "check_messages" };
  return null;
}

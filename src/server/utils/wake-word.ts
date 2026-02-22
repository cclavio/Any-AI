/**
 * Wake Word Detection for Any AI
 *
 * Detects wake word activation in transcription text.
 * The wake word is configurable per-user (default: "hey any ai").
 */

/**
 * Default wake words for Any AI activation
 */
export const DEFAULT_WAKE_WORDS = [
  "hey any ai",
];

/**
 * Vision keywords that indicate a query requires camera/image analysis
 */
export const VISION_KEYWORDS = [
  // General identification
  'what am i looking at', 'what is this', 'what is that',
  'identify this', 'identify that', 'what do you see', 'describe what',
  'tell me about this', 'tell me about that', 'what\'s in front of me',
  'can you see', 'look at this', 'look at that', 'check this out',
  'what\'s this', 'what\'s that', 'whats this', 'whats that',
  'what kind of', 'what type of', 'what brand', 'what model',
  'who is this', 'who is that', 'who\'s this', 'who\'s that',

  // Reading / OCR
  'read this', 'read that', 'read it', 'what does this say',
  'what does that say', 'what does it say', 'what is written',
  'can you read', 'read the text', 'read the sign', 'read the label',
  'what\'s written', 'whats written', 'translate this', 'translate that',

  // Counting / Colors / Quantities
  'what color', 'what colour', 'how many', 'how much',
  'count the', 'count how many', 'how big', 'how small',
  'how tall', 'how long', 'how wide', 'what size',

  // Description
  'describe this', 'describe that', 'describe what you see',
  'tell me what you see', 'explain what you see',
  'what do you notice', 'what can you tell me about',

  // Problem solving (implies looking at something)
  'solve this', 'fix this', 'what\'s wrong', 'whats wrong',
  'what is wrong', 'how do i fix', 'how do i solve', 'how can i fix',
  'help me fix', 'help me solve', 'help me with this',
  'what\'s the problem', 'whats the problem', 'what is the problem',
  'diagnose this', 'troubleshoot this', 'debug this',
  'why isn\'t this working', 'why isnt this working',
  'why is this broken', 'why doesn\'t this work', 'why doesnt this work',
  'this isn\'t working', 'this isnt working', 'this doesn\'t work',
  'not working', 'broken', 'stuck', 'jammed',
  'what should i do', 'what do i do', 'how do i repair',

  // Instructions (implies looking at something)
  'how do i use this', 'how do i use that', 'how does this work',
  'how does that work', 'show me how', 'teach me how',
  'how to use this', 'how to use that', 'what does this do',
  'what does that do', 'how do i operate', 'how to operate',
  'how do i turn this on', 'how do i turn this off',
  'how do i set this up', 'how to set up', 'where do i',
  'which button', 'what button', 'where is the', 'how do i connect',
  'guide me', 'walk me through', 'step by step',

  // Location / Spatial
  'where is this', 'where is that',
  'what place is this', 'what building', 'what store',
  'what restaurant', 'what street'
];

/**
 * Result of wake word detection
 */
export interface WakeWordResult {
  detected: boolean;
  query: string;  // The query text after removing the wake word
  wakeWordUsed?: string;  // Which wake word was detected
}

/**
 * Strip punctuation and normalize whitespace for fuzzy wake word matching.
 * STT often inserts commas, periods, or extra spaces (e.g., "Hey, Jarvis" for "Hey Jarvis").
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // Remove all non-alphanumeric except spaces
    .replace(/\s+/g, ' ')          // Collapse multiple spaces
    .trim();
}

/**
 * Detect if the text contains a wake word.
 * Uses punctuation-stripped matching so STT variations like "Hey, Jarvis"
 * still match a "Hey Jarvis" wake word.
 *
 * @param text - The transcription text to check
 * @param customWakeWords - Optional custom wake words (from user settings)
 * @returns Detection result with the query text
 */
export function detectWakeWord(text: string, customWakeWords?: string[]): WakeWordResult {
  // Include custom wake words AND default wake words as fallback
  const wakeWords = [
    ...(customWakeWords && customWakeWords.length > 0 ? customWakeWords : []),
    ...DEFAULT_WAKE_WORDS,
  ];

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const uniqueWakeWords = wakeWords.filter(w => {
    const key = w.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const normalizedText = normalizeForMatch(text);

  for (const wakeWord of uniqueWakeWords) {
    const normalizedWake = normalizeForMatch(wakeWord);
    const index = normalizedText.indexOf(normalizedWake);
    if (index !== -1) {
      // Find the approximate position in the original text to extract the query.
      // Count how many normalized characters correspond to original characters.
      const normalizedBefore = normalizedText.slice(0, index + normalizedWake.length);
      let origCharsConsumed = 0;
      let normPos = 0;
      const lowerText = text.toLowerCase();

      for (let i = 0; i < lowerText.length && normPos < normalizedBefore.length; i++) {
        const ch = lowerText[i];
        // Skip characters that normalizeForMatch would remove
        if (/[^a-z0-9\s]/.test(ch)) {
          origCharsConsumed = i + 1;
          continue;
        }
        // Collapse whitespace
        if (/\s/.test(ch)) {
          if (normPos < normalizedBefore.length && normalizedBefore[normPos] === ' ') {
            normPos++;
          }
          origCharsConsumed = i + 1;
          continue;
        }
        if (ch === normalizedBefore[normPos]) {
          normPos++;
        }
        origCharsConsumed = i + 1;
      }

      // Extract everything after the wake word, stripping leading punctuation
      let query = text.slice(origCharsConsumed).trim();
      query = query.replace(/^[,.\s!?;:]+/, '').trim();
      return {
        detected: true,
        query,
        wakeWordUsed: wakeWord,
      };
    }
  }

  return {
    detected: false,
    query: text.trim(),
  };
}

/**
 * Remove wake word from text (if present)
 * @param text - The transcription text
 * @param customWakeWords - Optional custom wake words (from user settings)
 * @returns Text with wake word removed
 */
export function removeWakeWord(text: string, customWakeWords?: string[]): string {
  const result = detectWakeWord(text, customWakeWords);
  return result.query;
}

/**
 * Check if a query requires vision/camera analysis
 * @param query - The user's query text
 * @returns true if the query needs camera input
 */
export function isVisionQuery(query: string): boolean {
  const q = query.toLowerCase();
  return VISION_KEYWORDS.some(kw => q.includes(kw));
}

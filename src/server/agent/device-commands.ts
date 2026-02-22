/**
 * Device Command Classifier
 *
 * Regex-based classification of voice commands that target hardware
 * features (camera, etc.) rather than the AI agent pipeline.
 * Fast and deterministic — no LLM call required.
 */

export type DeviceCommand = { type: "take_photo" };

const TAKE_PHOTO_PATTERN =
  /\b(take|snap|capture|shoot|grab|get)\b.*\b(a\s+)?(photo|picture|snapshot|pic|shot|image)\b/i;

/**
 * Classify a transcribed query as a device command, or null if it
 * should continue through the normal AI pipeline.
 */
export function classifyDeviceCommand(query: string): DeviceCommand | null {
  if (TAKE_PHOTO_PATTERN.test(query)) {
    return { type: "take_photo" };
  }
  return null;
}

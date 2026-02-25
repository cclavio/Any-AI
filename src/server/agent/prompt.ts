/**
 * System Prompt Builder for Any AI
 *
 * Builds the system prompt dynamically based on context.
 * Includes device capabilities, response modes, and formatting rules.
 */

import { ResponseMode, WORD_LIMITS } from "../constants/config";
import type { LocationContext } from "../manager/LocationManager";
import type { ConversationTurn, ExchangeGroup } from "../manager/ChatHistoryManager";
import type { RecentPhoto } from "../manager/photo-analysis";
import type { UserAIConfig } from "./providers/types";
import { PROVIDER_DISPLAY_NAMES } from "./providers/types";

/**
 * Context passed to the prompt builder
 */
export interface AgentContext {
  // Device capabilities (from session.capabilities)
  hasDisplay: boolean;      // HUD glasses
  hasSpeakers: boolean;     // Audio output
  hasCamera: boolean;       // Can take photos
  hasPhotos: boolean;       // Whether photos were actually captured for this query
  hasMicrophone: boolean;   // Always true for voice input
  glassesType: 'display' | 'camera';  // Type of glasses connected

  // Query context
  responseMode: ResponseMode;

  // Environmental context (cached)
  location: LocationContext | null;
  localTime: string;
  timezone?: string;
  notifications: string;
  calendar: string;
  conversationHistory: ConversationTurn[];
  exchangeGroups?: ExchangeGroup[];
  recentPhotos?: RecentPhoto[];

  // User's AI configuration
  aiConfig?: UserAIConfig;

  // Whether Google Cloud services are configured (location, weather, places, directions, timezone)
  googleCloudConfigured: boolean;
}

/**
 * Build the complete system prompt
 */
export function buildSystemPrompt(context: AgentContext): string {
  const sections = [
    buildIdentitySection(context.aiConfig),
    buildDeviceCapabilitiesSection(context),
    buildResponseFormatSection(context),
    buildToolUsageSection(),
  ];

  // Vision section — depends on camera AND whether photo was actually captured
  if (context.hasCamera && context.hasPhotos) {
    sections.push(buildVisionSection());
  } else if (context.hasCamera && !context.hasPhotos) {
    sections.push(buildVisionFailedSection());
  }

  // Context sections
  sections.push(buildContextSection(context));

  // Google Cloud services section (fallback guidance when not configured)
  if (!context.googleCloudConfigured) {
    sections.push(buildGoogleServicesUnavailableSection(context));
  }

  // TTS formatting only for speaker glasses (no display)
  if (context.hasSpeakers && !context.hasDisplay) {
    sections.push(buildTTSFormatSection());
  }

  // Display formatting for HUD glasses
  if (context.hasDisplay) {
    sections.push(buildDisplayFormatSection());
  }

  return sections.join("\n\n");
}

/**
 * Core identity section — dynamic based on user's AI config
 */
function buildIdentitySection(config?: UserAIConfig): string {
  const agentName = config?.agentName || "Any AI";
  const modelName = config?.llmModelName || "Gemini 2.5 Flash";
  const providerName = (config?.llmProvider === "custom" && config?.llmCustomProviderName)
    ? config.llmCustomProviderName
    : PROVIDER_DISPLAY_NAMES[config?.llmProvider || "google"] || "Google";

  return `# ${agentName}

I'm ${agentName} - I live in these smart glasses and I'm here to help.

My underlying AI model is ${modelName} (provided by ${providerName}). If anyone asks what model or AI powers me, I share this openly.

If someone asks about the glasses themselves, I mention that these are MentraOS smart glasses.

## Core Principles

- Be direct and concise. Give the answer without filler, commentary, or playful remarks.
- For factual questions, state the fact directly.
- Never refuse reasonable requests - I always try my best.
- Keep responses natural and conversational, like a helpful friend.`;
}

/**
 * Device capabilities section - tells LLM what hardware is available
 */
function buildDeviceCapabilitiesSection(context: AgentContext): string {
  const capabilities: string[] = [];
  const limitations: string[] = [];

  // What the glasses CAN do
  if (context.hasCamera) {
    capabilities.push("Camera - can see what the user sees and answer visual questions");
  }
  if (context.hasSpeakers) {
    capabilities.push("Speakers - responses are spoken aloud to the user");
  }
  if (context.hasDisplay) {
    capabilities.push("HUD Display - responses are shown on a heads-up display");
  }
  if (context.hasMicrophone) {
    capabilities.push("Microphone - user speaks to interact (always present)");
  }

  // What the glasses CANNOT do
  if (!context.hasCamera) {
    limitations.push("NO camera - cannot see what the user sees, cannot analyze images. If the user asks you to look at something, describe something visual, or asks a question that requires seeing their surroundings, politely explain that these glasses don't have a camera so you can't see what's around them, and suggest they ask a question you can answer with your knowledge or a web search instead.");
  }
  if (!context.hasSpeakers) {
    limitations.push("NO speakers - responses are displayed only, not spoken");
  }
  if (!context.hasDisplay) {
    limitations.push("NO display - responses are spoken only, not shown visually");
  }

  return `## Device Capabilities

The user is wearing **${context.glassesType} glasses** with the following hardware:

**Available:**
${capabilities.map(c => `- ${c}`).join('\n')}

**Not Available:**
${limitations.length > 0 ? limitations.map(l => `- ${l}`).join('\n') : '- (all features available)'}

IMPORTANT: When the user asks "what can you do?" or "what can I do with these glasses?", describe my actual features based on available hardware. Here's what I can do:

**Always available:**
- Answer questions using my knowledge or web search
- Calculations and unit conversions
- Check battery level and charging status ("what's my battery?")
- Nearby places search and walking directions (if Google Cloud key configured)
- Weather, air quality, and pollen reports (if Google Cloud key configured)
- Remember context from our conversation (up to 8 hours)
- Follow-up questions without repeating the wake word

**Camera glasses only:**
- See what you're looking at and answer visual questions
- "Take a photo" voice command saves a photo to your camera roll

**Voice commands (handled instantly, no AI delay):**
- "Take a photo" / "take a picture" — saves to camera roll
- "Battery" / "what's my power" — reads battery percentage
- "What's my schedule?" / "check my calendar" — reads today's events
- "Check my notifications" / "any messages?" — reads recent phone notifications

NEVER suggest features that require hardware the user doesn't have.`;
}

/**
 * Response format section based on mode and device
 */
function buildResponseFormatSection(context: AgentContext): string {
  const limits = context.hasDisplay
    ? WORD_LIMITS.hud
    : WORD_LIMITS.speaker;

  const wordLimit = limits[context.responseMode];

  return `## Response Length

CRITICAL WORD LIMIT: MAXIMUM ${wordLimit} WORDS. This is NON-NEGOTIABLE.

Current mode: ${context.responseMode.toUpperCase()}
- QUICK (${limits[ResponseMode.QUICK]} words): Simple facts, yes/no, quick answers
- STANDARD (${limits[ResponseMode.STANDARD]} words): Explanations, recommendations
- DETAILED (${limits[ResponseMode.DETAILED]} words): Complex explanations, step-by-step

Count your words before responding. Keep it concise.`;
}

/**
 * Tool usage guidelines
 */
function buildToolUsageSection(): string {
  return `## How I Use Tools

1. **Direct answers first**: If I'm confident I know the answer, I respond directly WITHOUT using tools. Common knowledge, facts, math, definitions - I already know these.

2. **Search for real-time data**: I ONLY use web search when the answer depends on CURRENT data I don't have (today's weather, live scores, recent news, business hours, obscure topics). CRITICAL: I search AT MOST ONCE per user query. One search call is enough — I never refine or repeat searches.

3. **Nearby places**: Use the nearby_places tool when the user asks to find a specific type of place near them (restaurants, coffee shops, gas stations, etc.). This uses their exact GPS location for accurate results.

4. **Directions**: Use the directions tool when the user asks how to get somewhere or wants navigation instructions. Defaults to walking directions.

5. **Calculator for math**: Use the calculator tool for any arithmetic, conversions, or calculations.

6. **Think through complex problems**: Use the thinking tool to reason step-by-step about complex questions before answering.`;
}

/**
 * Vision/camera instructions
 */
function buildVisionSection(): string {
  return `## Vision (Camera)

I always receive a photo from the smart glasses camera alongside the user's query.

STEP 1 — CLASSIFY THE QUERY:
- VISUAL = the query explicitly references something physical, visible, or in the user's environment. Examples: "what is this?", "read that", "what color is this?", "identify this", "what am I looking at?"
- NON-VISUAL = everything else. Greetings, general knowledge, opinions, etc.

STEP 2 — RESPOND BASED ON CLASSIFICATION:
- If VISUAL: I analyze the image and answer the user's SPECIFIC question about what I see.
- If NON-VISUAL: I act as if NO image was attached. I answer the query directly without mentioning or describing the photo.

CRITICAL - Camera Perspective: The camera shows what the user is LOOKING AT, not them. I'm seeing FROM their eyes, not AT them. Any person visible is someone else - NEVER the user.

PREVIOUS IMAGES: I may receive previous photos for context. These help me answer follow-up questions like "what was that thing I was looking at earlier?"`;
}

/**
 * Vision failed section — camera exists but no photo was captured for this query
 */
function buildVisionFailedSection(): string {
  return `## Vision (Camera)

The glasses have a camera, but NO photo was captured for this query (camera error or non-visual query).
Do NOT reference, describe, or mention any image. Answer using your knowledge, location data, and web search instead.
If the user asked a visual question ("what is this?", "what am I looking at?"), let them know the camera couldn't capture a photo and ask them to try again.`;
}

/**
 * Context section with location, time, notifications, history
 */
function buildContextSection(context: AgentContext): string {
  const sections: string[] = [];

  // Location
  if (context.location) {
    const loc = context.location;
    // Build location string with as much specificity as available
    let locationStr = '';
    if (loc.streetAddress) {
      locationStr = `${loc.streetAddress}, `;
    }
    if (loc.neighborhood) {
      locationStr += `${loc.neighborhood}, `;
    }
    locationStr += `${loc.city}, ${loc.state}, ${loc.country}`;

    if (loc.weather) {
      locationStr += ` | Weather: ${loc.weather.temperature}°F (${loc.weather.temperatureCelsius}°C), ${loc.weather.condition}`;
    }
    if (loc.airQuality) {
      locationStr += ` | Air Quality: AQI ${loc.airQuality.aqi} (${loc.airQuality.category})`;
    }
    if (loc.pollen) {
      const pollenParts = [
        loc.pollen.grass ? `Grass: ${loc.pollen.grass.level}` : null,
        loc.pollen.tree ? `Tree: ${loc.pollen.tree.level}` : null,
        loc.pollen.weed ? `Weed: ${loc.pollen.weed.level}` : null,
      ].filter(Boolean);
      if (pollenParts.length > 0) {
        locationStr += ` | Pollen: ${pollenParts.join(', ')}`;
      }
    }
    sections.push(`**Location:** ${locationStr}`);
    sections.push(`**Location Note:** When the user asks where they are, describe the location using the neighborhood, street name, and nearby landmarks or cross streets - but do NOT read out the exact street number (GPS addresses can be off by a few numbers). Use the full address internally for finding nearby places, directions, and mapping.`);
  }

  // Date and time
  if (context.localTime) {
    sections.push(`**Current Date & Time:** ${context.localTime}${context.timezone ? ` (${context.timezone})` : ''}`);
  }

  // Calendar / Schedule
  if (context.calendar && context.calendar.length > 0) {
    sections.push(`**Today's Schedule:**\n${context.calendar}`);
  }

  // Notifications (formatted with header by NotificationManager)
  if (context.notifications) {
    sections.push(context.notifications);
  }

  // Recent photos with tags and analysis
  if (context.recentPhotos && context.recentPhotos.length > 0) {
    sections.push(formatRecentPhotosForPrompt(context.recentPhotos));
  }

  // Conversation history — prefer exchange-grouped format when available
  if (context.exchangeGroups && context.exchangeGroups.length > 0) {
    sections.push(formatExchangeGroupsForPrompt(context.exchangeGroups, context.localTime, context.timezone));
  } else if (context.conversationHistory.length > 0) {
    const historyStr = context.conversationHistory.map(turn => {
      const photoNote = turn.hadPhoto ? " (with photo)" : "";
      return `User${photoNote}: ${turn.query}\nAssistant: ${turn.response}`;
    }).join("\n\n");
    sections.push(`**Conversation History:**\n${historyStr}`);
  }

  if (sections.length === 0) {
    return "## Context\n\nNo additional context available.";
  }

  return `## Context\n\n${sections.join('\n\n')}`;
}

/**
 * Google Cloud services unavailable — guides agent to suggest adding key + web search fallback
 */
function buildGoogleServicesUnavailableSection(context: AgentContext): string {
  const lines = [
    `## Location Services (Not Configured)`,
    ``,
    `Google Cloud services are NOT set up. This means weather, air quality, pollen, nearby places, directions, and timezone detection are unavailable.`,
    ``,
    `When the user asks about weather, nearby places, directions, air quality, pollen, or time:`,
    `1. Try to answer using a web search as a fallback.`,
    `2. Briefly mention that they can add a Google Cloud API key in Settings to enable these features directly.`,
  ];

  if (!context.timezone) {
    lines.push(``);
    lines.push(`**Timezone Note:** The current time shown may be in the server's timezone, not the user's local timezone. If the user asks about the time, mention that adding a Google Cloud API key in Settings will enable automatic timezone detection from their GPS location.`);
  }

  return lines.join('\n');
}

/**
 * TTS formatting for speaker glasses
 */
function buildTTSFormatSection(): string {
  return `## Speech Output Formatting

Since the user will HEAR your response through speakers, format your output for natural speech:

- Write numbers as words: "fifty degrees" not "50°"
- Spell out units: "fahrenheit" not "F", "dollars" not "$"
- Spell out abbreviations: "for example" not "e.g."
- No special characters: avoid symbols like °, %, $, €
- No markdown formatting: no bullets, headers, or links
- Use natural punctuation for pauses

Examples:
- BAD: "It's 72°F with 45% humidity"
- GOOD: "It's seventy-two degrees fahrenheit with forty-five percent humidity"

- BAD: "The iPhone 15 Pro costs $999"
- GOOD: "The iPhone fifteen Pro costs nine hundred ninety-nine dollars"`;
}

/**
 * Display formatting for HUD glasses
 */
function buildDisplayFormatSection(): string {
  return `## Display Output Formatting

Since the user will READ your response on a small HUD display:

- Keep responses extremely brief (15 words max)
- You CAN use symbols and abbreviations: 72°F, $50, 45%
- No markdown formatting
- Prioritize scannable, glanceable text`;
}

/**
 * Format exchange groups for the system prompt.
 * Current (active) exchange = full turns, no tags.
 * Past exchanges = temporal label + tags + full turns.
 */
function formatExchangeGroupsForPrompt(groups: ExchangeGroup[], localTime: string, timezone?: string): string {
  if (groups.length === 0) return "";

  const now = new Date();
  const lines: string[] = ["## Conversation History (48h)"];

  for (const group of groups) {
    const isCurrentExchange = group.endedAt === null;
    const turns = group.turns;
    if (turns.length === 0 && !isCurrentExchange) continue;

    if (isCurrentExchange) {
      lines.push("");
      lines.push("**Current Exchange:**");
    } else {
      const label = formatTemporalLabel(group.startedAt, now, timezone);
      const timeStr = formatTimeOfDay(group.startedAt, timezone);
      const tagStr = group.tags.length > 0 ? ` [${group.tags.join(", ")}]` : "";
      lines.push("");
      lines.push(`**Exchange (${label}, ${timeStr})${tagStr}:**`);
    }

    for (const turn of turns) {
      const photoNote = turn.hadPhoto ? " (with photo)" : "";
      lines.push(`User${photoNote}: ${turn.query}`);
      lines.push(`Assistant: ${turn.response}`);
    }

    if (!isCurrentExchange) {
      lines.push("");
      lines.push("---");
    }
  }

  return lines.join("\n");
}

/**
 * Generate a temporal label like "today morning", "yesterday evening", "2 days ago".
 */
function formatTemporalLabel(timestamp: Date, now: Date, timezone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" };
  const tsDate = new Date(timestamp.toLocaleDateString("en-US", opts));
  const nowDate = new Date(now.toLocaleDateString("en-US", opts));
  const diffDays = Math.floor((nowDate.getTime() - tsDate.getTime()) / (24 * 60 * 60 * 1000));

  const hour = getHourInTimezone(timestamp, timezone);
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  if (diffDays === 0) return `today ${period}`;
  if (diffDays === 1) return `yesterday ${period}`;
  return `${diffDays} days ago`;
}

/**
 * Format time of day like "9:30 AM".
 */
function formatTimeOfDay(timestamp: Date, timezone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (timezone) opts.timeZone = timezone;
  return timestamp.toLocaleTimeString("en-US", opts);
}

/**
 * Get the hour (0-23) in a specific timezone.
 */
function getHourInTimezone(date: Date, timezone?: string): number {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", hour12: false };
  if (timezone) opts.timeZone = timezone;
  return parseInt(date.toLocaleTimeString("en-US", opts), 10);
}

/**
 * Format recent photos for the system prompt.
 * Shows tags + truncated analysis so the AI can reference past photos.
 */
function formatRecentPhotosForPrompt(photos: RecentPhoto[]): string {
  const lines = ["**Recent Photos (last 24h):**"];
  for (const photo of photos) {
    const timeAgo = formatTimeAgo(photo.capturedAt);
    const tagStr = photo.tags.length > 0 ? ` [${photo.tags.join(", ")}]` : "";
    const type = photo.saved ? "saved" : "query";
    lines.push(`- ${timeAgo}${tagStr} (${type}): ${photo.analysis}`);
  }
  return lines.join("\n");
}

/**
 * Format a timestamp as a human-readable relative time (e.g., "5 min ago", "2h ago").
 */
function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

/**
 * Classify the response mode based on query complexity
 */
export function classifyResponseMode(query: string, hasDisplay: boolean): ResponseMode {
  // HUD glasses always get quick responses
  if (hasDisplay) return ResponseMode.QUICK;

  const lower = query.toLowerCase();

  // Detailed triggers
  if (/explain|how does|why does|compare|analyze|in detail|tell me more|elaborate/.test(lower)) {
    return ResponseMode.DETAILED;
  }

  // Standard triggers
  if (/how to|what are|recommend|suggest|steps to|what should|give me|list/.test(lower)) {
    return ResponseMode.STANDARD;
  }

  // Default to quick
  return ResponseMode.QUICK;
}

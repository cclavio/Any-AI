/**
 * Any AI Agent — Main AI agent using Vercel AI SDK
 *
 * Uses AI SDK generateText() with multi-provider model resolution.
 * Accepts UserAIConfig for per-user provider/model selection.
 */

import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { searchTool, calculatorTool, thinkingTool, createPlacesTool, createDirectionsTool } from "./tools";
import { buildSystemPrompt, classifyResponseMode, type AgentContext } from "./prompt";
import { ResponseMode, AGENT_SETTINGS } from "../constants/config";
import { resolveLLMModel } from "./providers/registry";
import type { UserAIConfig } from "./providers/types";
import { DEFAULT_AI_CONFIG, getModelDisplayName } from "./providers/types";
import type { LocationContext } from "../manager/LocationManager";
import type { ConversationTurn } from "../manager/ChatHistoryManager";

// Re-export for consumers
export type { UserAIConfig } from "./providers/types";
export { DEFAULT_AI_CONFIG } from "./providers/types";

/**
 * Content part for multimodal messages
 */
export interface ContentPart {
  type: "text" | "image";
  text?: string;
  image?: Buffer;
}

/**
 * Agent generation options
 */
export interface GenerateOptions {
  query: string;
  photos?: Buffer[];
  context: {
    hasDisplay: boolean;
    hasSpeakers: boolean;
    hasCamera: boolean;
    hasPhotos: boolean;
    glassesType: 'display' | 'camera';
    location: LocationContext | null;
    localTime: string;
    timezone?: string;
    notifications: string;
    conversationHistory: ConversationTurn[];
  };
  aiConfig?: UserAIConfig;
  onToolCall?: (toolName: string) => void;
}

/**
 * Agent generation result
 */
export interface GenerateResult {
  response: string;
  toolCalls: number;
}

/**
 * Build a complete UserAIConfig with env var fallback for development.
 * Returns null if no config and no env vars available.
 */
function resolveConfig(aiConfig?: UserAIConfig): UserAIConfig | null {
  if (aiConfig && aiConfig.isConfigured) {
    return aiConfig;
  }

  // Development fallback: use env var if available
  const envKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (envKey) {
    return {
      ...DEFAULT_AI_CONFIG,
      llmApiKey: envKey,
      visionApiKey: envKey,
      isConfigured: true,
    };
  }

  return null;
}

/**
 * Generate a response using AI SDK generateText()
 */
export async function generateResponse(options: GenerateOptions): Promise<GenerateResult> {
  const { query, photos, context, aiConfig } = options;
  const config = resolveConfig(aiConfig);

  if (!config) {
    return {
      response: "I'm not set up yet. Please go to Settings and configure your AI provider with an API key.",
      toolCalls: 0,
    };
  }

  // Classify response mode
  const responseMode = classifyResponseMode(query, context.hasDisplay);

  // Build full agent context
  const agentContext: AgentContext = {
    hasDisplay: context.hasDisplay,
    hasSpeakers: context.hasSpeakers,
    hasCamera: context.hasCamera,
    hasPhotos: context.hasPhotos,
    hasMicrophone: true,
    glassesType: context.glassesType,
    responseMode,
    location: context.location,
    localTime: context.localTime,
    timezone: context.timezone,
    notifications: context.notifications,
    conversationHistory: context.conversationHistory,
    aiConfig: config,
    googleCloudConfigured: !!config.googleCloudApiKey,
  };

  // Resolve AI SDK model via ProviderRegistry
  let model: LanguageModel;
  try {
    model = resolveLLMModel(config);
  } catch (error) {
    console.error("Failed to resolve LLM model:", error);
    return {
      response: "There's an issue with your AI provider configuration. Please check your settings.",
      toolCalls: 0,
    };
  }

  // Build content array
  const content: ContentPart[] = [
    { type: "text", text: query },
  ];

  // Add photos (current + previous)
  if (photos && photos.length > 0) {
    for (const photoBuffer of photos) {
      content.push({
        type: "image",
        image: photoBuffer,
      });
    }
  }

  console.log(`🤖 Generating response for: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`);
  console.log(`   Mode: ${responseMode}, Photos: ${photos?.length || 0}, hasPhotos: ${context.hasPhotos}, History: ${context.conversationHistory.length}`);
  console.log(`   Provider: ${config.llmProvider}, Model: ${config.llmModel}`);

  let toolCallCount = 0;

  try {
    const result = await generateText({
      model,
      system: buildSystemPrompt(agentContext),
      messages: [
        {
          role: "user",
          content: content as any,
        },
      ],
      tools: {
        search: searchTool,
        calculator: calculatorTool,
        thinking: thinkingTool,
        // Location-aware tools — only available when GPS is active AND Google Cloud key is configured
        ...(context.location && config.googleCloudApiKey ? {
          nearby_places: createPlacesTool(context.location.lat, context.location.lng, config.googleCloudApiKey),
          directions: createDirectionsTool(context.location.lat, context.location.lng, config.googleCloudApiKey),
        } : {}),
      },
      stopWhen: stepCountIs(AGENT_SETTINGS.maxSteps),
      onStepFinish: ({ toolCalls }) => {
        if (toolCalls && toolCalls.length > 0) {
          toolCallCount += toolCalls.length;
          console.log(`   Tool calls this step: ${toolCalls.length}`);
          if (options.onToolCall) {
            for (const tc of toolCalls) {
              if (tc) options.onToolCall(tc.toolName);
            }
          }
        }
      },
    });

    const response = typeof result.text === 'string' ? result.text : String(result.text || '');

    console.log(`✅ Response generated (${response.length} chars, ${toolCallCount} tool calls)`);

    return {
      response,
      toolCalls: toolCallCount,
    };

  } catch (error) {
    console.error("❌ Agent generation error:", error);
    throw error;
  }
}

/**
 * Quick helper to get response mode from query
 */
export { classifyResponseMode } from "./prompt";
export { ResponseMode } from "../constants/config";

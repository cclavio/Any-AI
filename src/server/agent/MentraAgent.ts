/**
 * Any AI Agent — Main AI agent using Vercel AI SDK
 *
 * Replaces Mastra Agent with AI SDK generateText().
 * Accepts UserAIConfig for multi-provider model resolution.
 */

import { generateText, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { searchTool, calculatorTool, thinkingTool } from "./tools";
import { buildSystemPrompt, classifyResponseMode, type AgentContext } from "./prompt";
import { ResponseMode, AGENT_SETTINGS } from "../constants/config";
import type { LocationContext } from "../manager/LocationManager";
import type { ConversationTurn } from "../manager/ChatHistoryManager";

/**
 * Temporary UserAIConfig type for Phase 1.
 * Will be replaced by providers/types.ts in Phase 3.
 */
export interface UserAIConfig {
  agentName: string;
  wakeWord: string;
  llmProvider: string;
  llmModel: string;
  llmModelName: string;
  llmApiKey: string;
  visionProvider: string;
  visionModel: string;
  visionApiKey: string;
  isConfigured: boolean;
}

/** Default config used when no user config is available (Phase 1 shim) */
export const DEFAULT_AI_CONFIG: UserAIConfig = {
  agentName: "Any AI",
  wakeWord: "hey any ai",
  llmProvider: "google",
  llmModel: "gemini-2.5-flash",
  llmModelName: "Gemini 2.5 Flash",
  llmApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
  visionProvider: "google",
  visionModel: "gemini-2.5-flash",
  visionApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
  isConfigured: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
};

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
 * Temporary model resolver for Phase 1.
 * Will be replaced by providers/registry.ts in Phase 3.
 */
function resolveModel(config: UserAIConfig): LanguageModel {
  // Phase 1: Only Google provider is supported as a shim
  // Phase 3 will add the full ProviderRegistry with OpenAI/Anthropic/Google
  if (config.llmApiKey) {
    const google = createGoogleGenerativeAI({ apiKey: config.llmApiKey });
    return google(config.llmModel);
  }

  // Fallback: use env var key
  const envKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (envKey) {
    const google = createGoogleGenerativeAI({ apiKey: envKey });
    return google("gemini-2.5-flash");
  }

  throw new Error("No API key configured. Please set up a provider in Settings.");
}

/**
 * Generate a response using AI SDK generateText()
 */
export async function generateResponse(options: GenerateOptions): Promise<GenerateResult> {
  const { query, photos, context, aiConfig } = options;
  const config = aiConfig || DEFAULT_AI_CONFIG;

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
  };

  // Resolve AI SDK model from config
  const model = resolveModel(config);

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
      },
      stopWhen: stepCountIs(AGENT_SETTINGS.maxSteps),
      onStepFinish: ({ toolCalls }) => {
        if (toolCalls && toolCalls.length > 0) {
          toolCallCount += toolCalls.length;
          console.log(`   Tool calls this step: ${toolCalls.length}`);
          if (options.onToolCall) {
            for (const tc of toolCalls) {
              options.onToolCall(tc.toolName);
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

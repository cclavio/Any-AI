/**
 * Drizzle Schema Definitions — Supabase Postgres
 *
 * Tables:
 *   - user_settings: Extended with AI provider configuration
 *   - conversations: One row per user per day
 *   - conversation_turns: Individual Q&A pairs (normalized from Mongoose embedded array)
 *
 * API keys are NOT stored here — only Vault secret IDs (UUIDs).
 */

import { pgTable, text, timestamp, boolean, integer, uuid, date, jsonb } from "drizzle-orm/pg-core";

/**
 * User settings — extended with AI provider configuration.
 * API keys are NOT stored here — only Vault secret IDs (UUIDs).
 */
export const userSettings = pgTable("user_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),

  // Existing settings (ported from Mongoose)
  theme: text("theme").notNull().default("dark"),
  chatHistoryEnabled: boolean("chat_history_enabled").notNull().default(true),

  // Personalization
  agentName: text("agent_name").notNull().default("Any AI"),
  wakeWord: text("wake_word").notNull().default("Hey Jarvis"),

  // LLM provider config
  llmProvider: text("llm_provider").default("openai"),
  llmModel: text("llm_model").default("gpt-5-mini"),
  llmApiKeyVaultId: text("llm_api_key_vault_id"),

  // Vision provider config (can differ from LLM)
  visionProvider: text("vision_provider").default("google"),
  visionModel: text("vision_model").default("gemini-2.5-flash"),
  visionApiKeyVaultId: text("vision_api_key_vault_id"),

  // Google Cloud API key (optional — enables location, weather, places, directions, timezone)
  googleCloudApiKeyVaultId: text("google_cloud_api_key_vault_id"),

  // Tracks whether user has completed provider setup
  isAiConfigured: boolean("is_ai_configured").notNull().default(false),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Conversations — one row per user per day.
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Conversation turns — individual Q&A pairs within a conversation.
 * Normalized from Mongoose's embedded array to a proper relation.
 */
export const conversationTurns = pgTable("conversation_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  response: text("response").notNull(),
  hadPhoto: boolean("had_photo").notNull().default(false),
  photoId: uuid("photo_id").references(() => photos.id),
  contextIds: uuid("context_ids").array().default([]),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

/**
 * Generic user context — ephemeral data like calendar events, notifications, etc.
 * Rows expire based on expires_at and can be cleaned up periodically.
 */
/**
 * Photos — metadata for photos stored in Supabase Storage.
 * Actual image files live in the "photos" storage bucket.
 */
export const photos = pgTable("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  requestId: text("request_id").notNull().unique(),
  storagePath: text("storage_path"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  saved: boolean("saved").notNull().default(false),
  analysis: text("analysis"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userContext = pgTable("user_context", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  contextType: text("context_type").notNull(),
  contextKey: text("context_key").notNull(),
  data: jsonb("data").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

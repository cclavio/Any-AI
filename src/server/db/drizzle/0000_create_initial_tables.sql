-- Migration: create_initial_tables
-- Applied via Supabase MCP on 2026-02-22

-- User settings with AI provider configuration
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,

  -- Existing settings
  theme TEXT NOT NULL DEFAULT 'dark',
  chat_history_enabled BOOLEAN NOT NULL DEFAULT true,

  -- Personalization
  agent_name TEXT NOT NULL DEFAULT 'Any AI',
  wake_word TEXT NOT NULL DEFAULT 'hey any ai',

  -- LLM provider config
  llm_provider TEXT DEFAULT 'google',
  llm_model TEXT DEFAULT 'gemini-2.5-flash',
  llm_api_key_vault_id TEXT,

  -- Vision provider config
  vision_provider TEXT DEFAULT 'google',
  vision_model TEXT DEFAULT 'gemini-2.5-flash',
  vision_api_key_vault_id TEXT,

  -- Setup status
  is_ai_configured BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations (one per user per day)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversation turns (Q&A pairs)
CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  response TEXT NOT NULL,
  had_photo BOOLEAN NOT NULL DEFAULT false,
  photo_timestamp INTEGER,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user_date ON conversations(user_id, date);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_conversation ON conversation_turns(conversation_id);

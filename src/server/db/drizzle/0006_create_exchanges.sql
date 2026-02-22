-- Migration: Create exchanges table and link conversation_turns
-- Groups conversation turns into exchanges (wake word -> done)

-- Exchanges table
CREATE TABLE IF NOT EXISTS exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,  -- 'closer_gratitude' | 'closer_dismissal' | 'follow_up_timeout' | 'session_disconnect'
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exchanges_user_started ON exchanges (user_id, started_at DESC);

-- Add exchange_id column to conversation_turns (nullable for backward compat)
ALTER TABLE conversation_turns
  ADD COLUMN IF NOT EXISTS exchange_id UUID REFERENCES exchanges(id) ON DELETE SET NULL;

CREATE INDEX idx_conversation_turns_exchange ON conversation_turns (exchange_id);

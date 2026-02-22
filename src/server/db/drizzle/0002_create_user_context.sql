-- Generic user context table for ephemeral data (calendar events, notifications, etc.)
-- Rows auto-expire based on expires_at and can be cleaned up periodically.

CREATE TABLE IF NOT EXISTS user_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  context_type TEXT NOT NULL,        -- "calendar_event" | "notification" | future types
  context_key TEXT NOT NULL,         -- unique key within type (e.g., eventId)
  data JSONB NOT NULL,               -- flexible payload
  expires_at TIMESTAMPTZ NOT NULL,   -- when this row becomes stale
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_context_upsert
  ON user_context(user_id, context_type, context_key);

CREATE INDEX IF NOT EXISTS idx_user_context_active
  ON user_context(user_id, context_type, expires_at);

ALTER TABLE user_context ENABLE ROW LEVEL SECURITY;

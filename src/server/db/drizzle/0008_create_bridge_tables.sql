-- Pairs a Claude Code API key with a Mentra user (one row per pairing)
CREATE TABLE claude_mentra_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_hash TEXT NOT NULL UNIQUE,
  mentra_user_id TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived pairing codes (6-digit, 10-minute expiry)
CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ
);

-- Bridge interactions — doubles as audit log and deferred message store
CREATE TABLE bridge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_hash TEXT NOT NULL,
  mentra_user_id TEXT NOT NULL,
  conversation_id TEXT,
  message TEXT NOT NULL,
  response TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- status values: pending → responded | timeout → timeout_responded → consumed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_bridge_pairs_api_key ON claude_mentra_pairs(api_key_hash);
CREATE INDEX idx_pairing_codes_expires ON pairing_codes(expires_at);
CREATE INDEX idx_bridge_requests_api_key ON bridge_requests(api_key_hash);
CREATE INDEX idx_bridge_requests_status ON bridge_requests(mentra_user_id, status);

-- RLS
ALTER TABLE claude_mentra_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_pairs" ON claude_mentra_pairs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_codes" ON pairing_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_requests" ON bridge_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

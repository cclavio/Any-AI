-- Add saved/analysis fields to photos, make storage_path nullable
ALTER TABLE photos ADD COLUMN saved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE photos ADD COLUMN analysis TEXT;
ALTER TABLE photos ALTER COLUMN storage_path DROP NOT NULL;

-- Replace dead photo_timestamp with photo_id FK in conversation_turns
ALTER TABLE conversation_turns DROP COLUMN photo_timestamp;
ALTER TABLE conversation_turns ADD COLUMN photo_id UUID REFERENCES photos(id);

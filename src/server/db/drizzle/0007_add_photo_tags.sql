-- Add tags array to photos table (mirrors exchanges.tags pattern)
ALTER TABLE photos ADD COLUMN tags TEXT[] DEFAULT '{}';

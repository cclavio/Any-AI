ALTER TABLE conversation_turns ADD COLUMN context_ids UUID[] DEFAULT '{}';

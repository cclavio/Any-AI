-- Migration: enable_rls
-- Enable Row Level Security on all tables as defense-in-depth.
-- The server connects as the `postgres` superuser role which bypasses RLS,
-- so existing queries are unaffected. This blocks `anon`/`authenticated`
-- roles from directly accessing data via Supabase client libraries.

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;

-- No policies are needed for the server (postgres role bypasses RLS).
-- If Supabase client-side access is ever needed, add policies here.

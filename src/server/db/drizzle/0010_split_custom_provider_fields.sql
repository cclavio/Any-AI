-- Split single custom_base_url into per-purpose columns for LLM and vision,
-- and add friendly name fields for custom providers.
-- This allows custom LLM + standard vision (or vice versa) with different URLs.

ALTER TABLE user_settings RENAME COLUMN custom_base_url TO llm_custom_base_url;
ALTER TABLE user_settings ADD COLUMN vision_custom_base_url TEXT;
ALTER TABLE user_settings ADD COLUMN llm_custom_provider_name TEXT;
ALTER TABLE user_settings ADD COLUMN vision_custom_provider_name TEXT;

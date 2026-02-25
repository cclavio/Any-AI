-- Add custom base URL for user-hosted model servers (Ollama, LM Studio, vLLM, etc.)
ALTER TABLE user_settings ADD COLUMN custom_base_url TEXT;

-- Persist the inbox visibility scope (All team / This campaign / Mine) per user
-- so the choice survives navigation + reload (operator request). NULL = no saved
-- preference -> fall back to the "mine" default. Safe to re-run.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS inbox_scope text;

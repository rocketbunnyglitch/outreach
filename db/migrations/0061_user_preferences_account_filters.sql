-- 0061_user_preferences_account_filters.sql
--
-- Adds inbox_account_filters JSONB to user_preferences. Persists the
-- per-campaign visibility scope from the Gmail-style AccountSwitcher
-- dropdown across sessions + devices.
--
-- Shape:
--   {
--     "<campaign_id>": ["<connected_account_id>", "<connected_account_id>"],
--     ...
--     "_default": ["<connected_account_id>"]   -- no campaign / all
--   }
--
-- Each entry is the set of connected_account ids the operator has
-- explicitly chosen to see when that campaign is active. Empty
-- arrays + missing keys both mean "default to every account I can
-- see" — the URL-param parse layer (parseAccountIds in
-- lib/account-filter.ts) handles the no-filter case.
--
-- JSONB lets the shape evolve (per-campaign + future per-folder /
-- per-scope-preset combinations) without a schema migration each
-- time. The application layer treats unknown keys as missing.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS inbox_account_filters jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Per-user inbox layout (outlook 3-pane vs gmail list/full-screen) and
-- light/dark theme, synced across devices via user_preferences.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS inbox_view text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS theme_pref text;

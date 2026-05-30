-- 0060_user_preferences.sql
--
-- Per-user UI preferences that should sync across devices. Each user
-- has at most one row here; rows are upserted on every preference
-- change.
--
-- Why a separate table from `users`:
--   We want preferences to be additive over time (each new pref is
--   a new column or JSONB field) without touching the core users
--   table on every UI iteration. Schema migrations on users.* tend
--   to require careful coordination across deploys; preferences
--   should be cheap to evolve.
--
-- All fields nullable + carry sensible defaults so a missing row
-- just means "use the app defaults". The application layer
-- (lib/user-preferences.ts) handles the upsert + read pattern.

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    /** 'compact' | 'default' | 'comfortable' — inbox row density. */
    inbox_density text,
    /** 'right' | 'bottom' | 'none' — reading-pane position. */
    inbox_reading_pane text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

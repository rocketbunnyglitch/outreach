-- 0041_rename_staff_members_to_users.sql
-- Renames staff_members → users and prepares the table for the
-- upcoming password-auth + invite system.
--
-- DESTRUCTIVE NOTE: Operator confirmed (this session) that all
-- existing staff_members rows can be DELETED — they'll be recreated
-- from scratch under the new password-auth model. We use TRUNCATE
-- with CASCADE to clear out every FK-referenced row across the
-- whole graph (notes, tasks, goals, audit log, cold outreach
-- assignments, etc).
--
-- After this migration:
--   - users table exists (was staff_members), with new columns
--     team_id, password_hash, password_set_at, password_must_change
--   - All existing user-owned rows are gone, including all audit
--     history, all cold-outreach assignments, all task assignments,
--     etc. The app is functionally a fresh install from a data
--     perspective, but the schema is intact and operator can
--     recreate users via the admin UI shipped in the next session.
--   - Postgres automatically cascades FK references: every
--     existing FK to staff_members(id) now points at users(id).
--     Drizzle schema files MUST be updated in lockstep with this
--     migration so TypeScript compilation reflects the new name.
--
-- Foreign-key columns NAMED staff_id / staff_member_id / etc are
-- NOT renamed here — only the table they point AT changes. Operator
-- agreed to defer column renames to a future cleanup PR; renaming
-- them now would multiply this PR's risk by an order of magnitude.

-- ---------------------------------------------------------------
-- Step 1: clear out all user-referenced data
-- ---------------------------------------------------------------
-- TRUNCATE CASCADE drops every row that has a FK to staff_members
-- via any path. This is the explicit operator decision: delete
-- the existing staff and start fresh.
TRUNCATE TABLE staff_members CASCADE;

-- ---------------------------------------------------------------
-- Step 2: rename the table
-- ---------------------------------------------------------------
-- Postgres rewrites every FK constraint to point at the new name
-- automatically. The constraint NAMES themselves are not renamed
-- (so a constraint like "fk_notes_staff_member_id" remains), but
-- they still function correctly.
ALTER TABLE staff_members RENAME TO users;

-- ---------------------------------------------------------------
-- Step 3: add team_id column, default to the single seeded team
-- ---------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS team_id uuid NOT NULL
    DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    REFERENCES teams (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS users_team_id_idx ON users (team_id);

-- ---------------------------------------------------------------
-- Step 4: add password-auth columns
-- ---------------------------------------------------------------
-- password_hash is nullable: invited users may exist without one
-- set yet (admin-created with "send invite link" flow). The
-- signIn callback in auth.ts will reject login attempts on rows
-- where password_hash IS NULL.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Timestamp of the last password set, used to enforce rotation
-- if/when the operator wants that policy.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

-- When true, the user is forced through the /set-password flow
-- on next login (e.g. after admin reset).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_must_change boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------
-- Step 5: indexes for the login path
-- ---------------------------------------------------------------
-- The auth callback queries by primary_email; ensure it's indexed.
-- This index may already exist if it was on the original table —
-- IF NOT EXISTS handles re-runs.
CREATE UNIQUE INDEX IF NOT EXISTS users_primary_email_unique
  ON users (primary_email);

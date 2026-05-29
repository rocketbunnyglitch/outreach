-- 0042_rename_staff_outreach_emails_to_connected_accounts.sql
-- Renames staff_outreach_emails → connected_accounts and adapts it
-- for the new "every team member can connect multiple Gmail
-- inboxes" model.
--
-- Operator decision (this session): keep the table's row-level
-- semantics + throttling logic, but drop the brand FK and rename
-- columns to match the connected_accounts spec.
--
-- DESTRUCTIVE NOTE: the previous TRUNCATE CASCADE in 0041 already
-- emptied this table via the FK chain. So we're operating on an
-- empty table here. The schema reshape is the only thing happening.
--
-- After this migration:
--   - connected_accounts table exists (was staff_outreach_emails)
--   - owner_user_id column (was staff_member_id) → FK to users(id)
--   - team_id column added → FK to teams(id), default to the
--     seeded BarCrawlConnect team
--   - outreach_brand_id column DROPPED + its FK constraint removed
--     (cold-outreach send queue is being decommissioned in a
--     follow-up commit; the brand binding goes with it)
--   - All other columns (google_oauth_refresh_token, email_address,
--     warmup state, daily/hourly send limits, etc) are preserved.
--     The send-queue decommission in a future commit will revisit
--     these — leaving them alone here keeps the rename surgical.

-- ---------------------------------------------------------------
-- Step 1: drop the outreach_brand_id column + its dependencies
-- ---------------------------------------------------------------
-- Drop the unique index that pinned (staff_member_id, outreach_brand_id, email_address):
-- once outreach_brand_id is gone, the natural key collapses to
-- (owner_user_id, email_address). The old global-unique index on
-- email_address (staff_outreach_emails_address_unique) is kept —
-- the spec calls for "one row per connected Gmail account" globally
-- as well as per-user, and operator confirmed reconnecting the
-- same Gmail updates the existing row.
ALTER TABLE staff_outreach_emails
  DROP COLUMN IF EXISTS outreach_brand_id;

-- ---------------------------------------------------------------
-- Step 2: rename the user-FK column
-- ---------------------------------------------------------------
ALTER TABLE staff_outreach_emails
  RENAME COLUMN staff_member_id TO owner_user_id;

-- ---------------------------------------------------------------
-- Step 3: rename the table itself
-- ---------------------------------------------------------------
ALTER TABLE staff_outreach_emails RENAME TO connected_accounts;

-- ---------------------------------------------------------------
-- Step 4: rename related indexes for clarity
-- ---------------------------------------------------------------
-- Postgres doesn't auto-rename indexes when their table is
-- renamed. We rename them explicitly so they don't carry the
-- old name into perpetuity. Each ALTER INDEX is wrapped in a
-- DO block so re-running this migration won't fail when the
-- target index already has the new name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'staff_outreach_emails_staff_brand_idx') THEN
    EXECUTE 'ALTER INDEX staff_outreach_emails_staff_brand_idx RENAME TO connected_accounts_owner_idx';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'staff_outreach_emails_address_unique') THEN
    EXECUTE 'ALTER INDEX staff_outreach_emails_address_unique RENAME TO connected_accounts_address_unique';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'staff_outreach_emails_status_idx') THEN
    EXECUTE 'ALTER INDEX staff_outreach_emails_status_idx RENAME TO connected_accounts_status_idx';
  END IF;
END $$;

-- ---------------------------------------------------------------
-- Step 5: add team_id column with default = seeded team
-- ---------------------------------------------------------------
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS team_id uuid NOT NULL
    DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    REFERENCES teams (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS connected_accounts_team_id_idx
  ON connected_accounts (team_id);

-- 0062_email_thread_labels_gmail_extension.sql
--
-- Extends email_thread_labels so it can store EITHER a team-label
-- reference (existing) OR a Gmail-label reference (new). Together
-- with email_messages.gmail_labels[] (per-message arrays) this gives
-- us a denormalized thread-level lookup for Gmail labels too — used
-- by the inbox list query + the thread label picker.
--
-- Approach: additive columns + check constraint. Existing rows keep
-- team_label_id NOT NULL semantics via the constraint; new
-- Gmail-direct rows set gmail_label_id + source='gmail' +
-- connected_email_account_id and leave team_label_id null.
--
-- The primary key drops the (thread_id, team_label_id) shape since
-- we now allow team_label_id to be null. New PK: a synthetic uuid
-- so a thread can have multiple label rows with different sources
-- without collision. Existing rows get a generated uuid via the
-- default — no data migration needed.
--
-- Indexes: keep both the thread-lookup + label-lookup; add a new
-- index on (connected_email_account_id, gmail_label_id) for the
-- two-way sync apply/remove path.

BEGIN;

-- 1. Add nullable id PK column. Existing rows get a fresh uuid via
--    the default; no app-side change needed before the migration
--    since the table doesn't read the PK shape from any active code.
ALTER TABLE email_thread_labels
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

-- 2. Drop the composite PK + recreate using id. Postgres requires
--    dropping the existing constraint before adding the new one.
ALTER TABLE email_thread_labels
  DROP CONSTRAINT IF EXISTS email_thread_labels_pkey;

ALTER TABLE email_thread_labels
  ADD CONSTRAINT email_thread_labels_pkey PRIMARY KEY (id);

-- 3. Allow team_label_id to be null + add the Gmail-direct columns.
ALTER TABLE email_thread_labels
  ALTER COLUMN team_label_id DROP NOT NULL;

ALTER TABLE email_thread_labels
  ADD COLUMN IF NOT EXISTS gmail_label_id text,
  ADD COLUMN IF NOT EXISTS connected_email_account_id uuid
    REFERENCES connected_accounts(id) ON DELETE CASCADE,
  -- 'manual' | 'gmail' — same semantics as applied_via, but
  -- semantically tagged for the SOURCE (engine team-label vs
  -- Gmail-direct). source defaults to 'engine' for backfill;
  -- existing rows are team-label-keyed.
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'engine';

-- 4. Backfill source on existing team-label rows. Should already be
--    'engine' via the default but be explicit so a future change to
--    the default doesn't drift the historical rows.
UPDATE email_thread_labels
  SET source = 'engine'
  WHERE source IS NULL OR source = '';

-- 5. Check constraint: exactly one of team_label_id / gmail_label_id
--    must be set, and gmail rows must carry a connected account.
ALTER TABLE email_thread_labels
  ADD CONSTRAINT email_thread_labels_exactly_one_label_kind CHECK (
    (team_label_id IS NOT NULL AND gmail_label_id IS NULL AND source = 'engine')
    OR
    (team_label_id IS NULL AND gmail_label_id IS NOT NULL AND connected_email_account_id IS NOT NULL AND source = 'gmail')
  );

-- 6. Lookup index for the two-way sync path (find the row for
--    "this thread + this gmail label on this account" so we can
--    delete it on Gmail-side removal).
CREATE INDEX IF NOT EXISTS email_thread_labels_gmail_lookup_idx
  ON email_thread_labels(connected_email_account_id, gmail_label_id)
  WHERE gmail_label_id IS NOT NULL;

-- 7. Replace the old (thread_id, team_label_id) uniqueness — both
--    namespaces need their own uniqueness so the same team_label
--    can't be applied twice + the same gmail_label can't be applied
--    twice per (thread, account).
CREATE UNIQUE INDEX IF NOT EXISTS email_thread_labels_team_unique
  ON email_thread_labels(thread_id, team_label_id)
  WHERE team_label_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_thread_labels_gmail_unique
  ON email_thread_labels(thread_id, gmail_label_id, connected_email_account_id)
  WHERE gmail_label_id IS NOT NULL;

COMMIT;

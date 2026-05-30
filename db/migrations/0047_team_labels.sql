-- 0047_team_labels.sql
--
-- Team-scoped label namespace that mirrors Gmail labels across every
-- connected_account on the team. Two-way sync: applying a team_label
-- to a thread pushes addLabelIds to Gmail; an inbound message's
-- labelIds get mapped back to team_labels and stamped on the thread.
--
-- Why per-team and not per-account or per-user:
--   The team shares one inbox in the new model. Staff need a shared
--   vocabulary ("Toronto-2026", "Lead-Verbal") that means the same
--   thing whether the thread came in on Bryle's Gmail or JC's. If
--   labels were per-account, the same logical label would have to be
--   re-created on every Gmail and the dashboard couldn't reason
--   about them uniformly. Per-team gives one logical label that we
--   reconcile down to the per-account Gmail label ids via the link
--   table.
--
-- Three tables:
--
--   team_labels             one row per logical label on a team
--   team_label_gmail_links  team_label x connected_account ->
--                           the Gmail-side label id on that account.
--                           One label can have many links (one per
--                           account it's been created on).
--   email_thread_labels     join: which team_labels are applied to
--                           which email_threads.

-- =========================================================================
-- team_labels
-- =========================================================================

CREATE TABLE IF NOT EXISTS team_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Tailwind color slug ('emerald', 'rose', 'blue', 'amber', 'zinc',
  -- 'violet', 'sky', 'orange', 'yellow'). Free-form; the UI picks a
  -- known palette. NULL renders as neutral zinc.
  color text,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL
);

-- Case-insensitive uniqueness per team. Two labels named "VIP" and "vip"
-- on the same team would be confusing; force them to one canonical form.
CREATE UNIQUE INDEX IF NOT EXISTS team_labels_team_name_unique
  ON team_labels (team_id, lower(name));

-- =========================================================================
-- team_label_gmail_links
-- =========================================================================
--
-- One row per (team_label, connected_account) pair. The
-- gmail_label_id is what we send to gmail.users.threads.modify.
--
-- A team_label without a link on a given account means "we've never
-- pushed this label to that Gmail" — we'll create it lazily the first
-- time the label is applied to a thread on that account.

CREATE TABLE IF NOT EXISTS team_label_gmail_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_label_id uuid NOT NULL REFERENCES team_labels (id) ON DELETE CASCADE,
  -- staff_outreach_emails was RENAMED to connected_accounts in migration
  -- 0042; the old name was dropped, not aliased. Reference the current
  -- name or the FK creation fails with relation-does-not-exist.
  connected_account_id uuid NOT NULL
    REFERENCES connected_accounts (id) ON DELETE CASCADE,
  gmail_label_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS team_label_gmail_links_unique
  ON team_label_gmail_links (team_label_id, connected_account_id);

-- For inbound sync: "given a Gmail label id on this account, which
-- team_label does it map to?"
CREATE INDEX IF NOT EXISTS team_label_gmail_links_lookup_idx
  ON team_label_gmail_links (connected_account_id, gmail_label_id);

-- =========================================================================
-- email_thread_labels
-- =========================================================================

CREATE TABLE IF NOT EXISTS email_thread_labels (
  thread_id uuid NOT NULL REFERENCES email_threads (id) ON DELETE CASCADE,
  team_label_id uuid NOT NULL REFERENCES team_labels (id) ON DELETE CASCADE,
  applied_by uuid REFERENCES users (id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  -- Which source applied the label.
  --   'manual'   — staff clicked apply in dashboard
  --   'gmail'    — inbound sync pulled it from message.labelIds
  --   'inherit'  — outbound message inherited from the thread on send
  applied_via text NOT NULL DEFAULT 'manual'
    CHECK (applied_via IN ('manual', 'gmail', 'inherit')),
  PRIMARY KEY (thread_id, team_label_id)
);

CREATE INDEX IF NOT EXISTS email_thread_labels_thread_idx
  ON email_thread_labels (thread_id);
CREATE INDEX IF NOT EXISTS email_thread_labels_label_idx
  ON email_thread_labels (team_label_id);

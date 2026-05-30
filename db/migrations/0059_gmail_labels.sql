-- 0059_gmail_labels.sql
--
-- Mirror of each connected inbox's Gmail labels so we can render
-- them in the left rail alongside team_labels.
--
-- Why a separate table from team_labels:
--   team_labels are operator-defined and team-scoped — every member
--   of the team sees them. Gmail labels are per-user (per
--   connected_account) and may include system labels (INBOX, SENT,
--   STARRED, IMPORTANT) plus user-defined ones the operator created
--   in Gmail's web UI. We mirror but don't merge: a future feature
--   can offer "link this Gmail label to a team label" as a one-time
--   bridge, but the storage stays distinct.
--
-- Sync model:
--   The Gmail poll worker (lib/gmail-poll-worker.ts) already polls
--   each connected_account on a cadence. A new `syncGmailLabels`
--   pass runs every N polls (cheap; Gmail's labels.list returns the
--   full set in a single call) and upserts here.
--
-- Per-account scope: an operator with multiple connected accounts
-- sees each account's labels distinctly. The left rail can later
-- collapse identically-named labels across accounts.

CREATE TABLE IF NOT EXISTS gmail_labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connected_account_id uuid NOT NULL
        REFERENCES connected_accounts(id) ON DELETE CASCADE,
    gmail_label_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('user', 'system')),
    /** Optional parent label id (Gmail supports nested labels via "Parent/Child" names). */
    parent_label_id text,
    /** Tailwind-friendly hex from Gmail's color config, if set. */
    background_color text,
    text_color text,
    /** Counts cached at sync time; stale between polls. */
    unread_count integer NOT NULL DEFAULT 0,
    total_count integer NOT NULL DEFAULT 0,
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (account, gmail_label_id). Gmail re-uses label ids on
-- rename so we can update in place.
CREATE UNIQUE INDEX IF NOT EXISTS gmail_labels_account_label_idx
    ON gmail_labels (connected_account_id, gmail_label_id);

-- Lookup by account for the left-rail render (a single Gmail account
-- typically has under 100 labels; team aggregation joins a small set).
CREATE INDEX IF NOT EXISTS gmail_labels_account_idx
    ON gmail_labels (connected_account_id);

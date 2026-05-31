-- Phase D — Collaboration.
--
-- Two new tables:
--
--   email_thread_notes        Per-thread internal notes the team
--                              writes to coordinate ("I called this
--                              owner, they're shy on email").
--                              Mentions array of staff_member ids
--                              that were @-tagged in the note.
--
--   email_thread_mentions     Materialized one-row-per-mention
--                              from email_thread_notes so the
--                              "mentioned" inbox scope can do
--                              fast EXISTS lookups by user. The
--                              same row appears once per (note,
--                              mentioned_user). Cleared when
--                              acknowledged.
--
-- A note can mention multiple users; one user can be mentioned
-- in many notes across many threads. The mention table lets
-- the inbox "mentioned" scope render in one cheap query without
-- unnesting the notes array on every page load.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS email_thread_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,

  -- Author (always required; notes can't be anonymous).
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Free text. Markdown-ish but rendered as plain text in the
  -- rail (no XSS surface). 2000 char cap enforced in the action.
  body text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  -- Soft-delete so notes referenced in history audits stay
  -- traceable. UI hides deleted notes from the rail.
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_thread_notes_thread_idx
  ON email_thread_notes (thread_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS email_thread_notes_author_idx
  ON email_thread_notes (author_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- =========================================================================
-- email_thread_mentions
-- =========================================================================

CREATE TABLE IF NOT EXISTS email_thread_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES email_thread_notes(id) ON DELETE CASCADE,

  -- The staff member who was @-tagged.
  mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The author of the note (denormalized so the inbox scope can
  -- show "JC mentioned you" without joining notes every time).
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  created_at timestamptz NOT NULL DEFAULT NOW(),

  -- NULL = unread. Operator dismisses the mention (or replies to
  -- the thread, which auto-clears) and we set this.
  acknowledged_at timestamptz
);

-- The hot read path: "show me threads where I have unacknowledged
-- mentions." Partial index keeps it small — most mentions get
-- acknowledged within hours.
CREATE INDEX IF NOT EXISTS email_thread_mentions_user_unack_idx
  ON email_thread_mentions (mentioned_user_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS email_thread_mentions_thread_idx
  ON email_thread_mentions (thread_id);

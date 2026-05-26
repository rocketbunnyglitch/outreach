-- =========================================================================
-- 0005_smart_notes.sql
--
-- Smart Notes → Action Extraction infrastructure.
--
-- When a staffer writes a note like "Mike said call back today at 5pm",
-- the engine scans for action verbs + time references and creates rows
-- in note_action_suggestions. The operator sees Create / Edit / Dismiss
-- buttons under the note. Accepted suggestions spawn tasks rows with
-- source='smart_note'.
--
-- Two things to make sure of:
--   1. ALTER TYPE ADD VALUE must NOT run inside a BEGIN/COMMIT block in
--      older Postgres versions; here psql script mode runs statements in
--      autocommit so it's safe.
--   2. IF NOT EXISTS on enum value requires PG 12+; we're on 16, fine.
-- =========================================================================

-- ---------- Extend task_source enum ----------
ALTER TYPE task_source ADD VALUE IF NOT EXISTS 'smart_note';

-- ---------- note_action_suggestions table ----------
CREATE TABLE IF NOT EXISTS note_action_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,

  -- SHA-256 hash of the note body at the time the suggestion was
  -- extracted. When the note is edited, the new body is rescanned —
  -- but suggestions tied to the OLD hash stay marked dismissed.
  -- This prevents the same dismissed suggestion from re-appearing on
  -- every page load.
  note_content_hash text NOT NULL,

  status text NOT NULL DEFAULT 'pending',
    -- 'pending' | 'accepted' | 'dismissed'
  CONSTRAINT note_action_suggestions_status_check
    CHECK (status IN ('pending', 'accepted', 'dismissed')),

  -- The proposed action
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  action_type text NOT NULL,
    -- 'call' | 'follow_up_email' | 'venue_callback' |
    -- 'confirmation_reminder' | 'poster_send' | 'wristband_task' |
    -- 'missing_info_task' | 'reminder' | 'custom'

  due_at timestamptz,
  timezone text NOT NULL,

  -- Context for the task that would be created
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  phone_e164 text,

  confidence text NOT NULL DEFAULT 'medium',
    -- 'high' (action + date both clear) | 'medium' (action only)
  CONSTRAINT note_action_suggestions_confidence_check
    CHECK (confidence IN ('high', 'medium')),

  -- The exact phrase from the note that triggered detection — surfaced
  -- in the UI so the operator can verify the extraction is accurate.
  source_text text NOT NULL,

  -- Set when status flips to 'accepted'
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS note_action_suggestions_note_idx
  ON note_action_suggestions(note_id);
CREATE INDEX IF NOT EXISTS note_action_suggestions_status_idx
  ON note_action_suggestions(status);
CREATE INDEX IF NOT EXISTS note_action_suggestions_venue_idx
  ON note_action_suggestions(venue_id);
CREATE INDEX IF NOT EXISTS note_action_suggestions_due_idx
  ON note_action_suggestions(due_at);

-- Touch updated_at on UPDATE
DROP TRIGGER IF EXISTS touch_note_action_suggestions ON note_action_suggestions;
CREATE TRIGGER touch_note_action_suggestions
  BEFORE UPDATE ON note_action_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at_func();

-- Audit trail
DROP TRIGGER IF EXISTS audit_note_action_suggestions ON note_action_suggestions;
CREATE TRIGGER audit_note_action_suggestions
  AFTER INSERT OR UPDATE OR DELETE ON note_action_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

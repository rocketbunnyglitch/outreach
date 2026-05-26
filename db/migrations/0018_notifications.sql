-- =========================================================================
-- 0018_notifications.sql
--
-- Per-staff notifications inbox: durable record of events that need an
-- operator's attention. Bell icon in the top nav shows unread count;
-- clicking opens a dropdown listing recent items.
--
-- Sources of notifications:
--   • Inbound replies (replies_inbox parallel — durable per-staff feed)
--   • @mentions in notes / remarks (future)
--   • ZeroBounce 'invalid' results on venues the staff member owns
--   • AI draft failures (when Anthropic is misconfigured / errors)
--   • Conflicts on edits (someone else changed your field)
--   • Generic operator messages from admins
-- =========================================================================

CREATE TYPE notification_kind AS ENUM (
  'reply',
  'mention',
  'email_invalid',
  'ai_draft_failed',
  'edit_conflict',
  'admin_message'
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recipient
  staff_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,

  kind notification_kind NOT NULL,

  -- Human-readable title (operator sees this in the dropdown)
  title TEXT NOT NULL,

  -- Optional secondary line (e.g. venue name, snippet of reply)
  body TEXT,

  -- Optional deep-link path the bell-click should navigate to
  -- (e.g. '/city-campaigns/<uuid>?focus=<venueId>')
  link_path TEXT,

  -- Free-form metadata for client-side rendering / future enrichment
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Unread until the operator clicks or marks-all-read
  read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_staff_unread_idx
  ON notifications(staff_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_staff_recent_idx
  ON notifications(staff_id, created_at DESC);

-- Audit trigger for mark-as-read trail
DROP TRIGGER IF EXISTS notifications_audit ON notifications;
CREATE TRIGGER notifications_audit
  AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- =========================================================================
-- 0020_inbox.sql
--
-- Gmail-style inbox: full message history + thread state for the new
-- three-pane inbox UI at /inbox.
--
-- What's new
-- ----------
-- 1. email_messages table — every inbound + outbound email body, so the
--    inbox right-pane can render the full conversation. Until now only
--    thread metadata + reply summaries were stored; raw message bodies
--    lived in Gmail only.
--
-- 2. email_threads gets eight new columns:
--      state                — thread_state enum, drives the folder routing
--      classification       — copies the latest reply classification onto
--                             the thread for fast list-view rendering
--      direction            — initial direction (inbound/outbound/mixed)
--      last_inbound_at      — for SLA breach computation (no stored flag)
--      last_outbound_at     — to flip state back to waiting_on_them
--      snippet              — ~140-char preview, denormalized for list speed
--      message_count        — for the "Lavelle · 4 messages" badge
--      unread_count         — global, not per-staff (small team, v1)
--      last_sender_name     — display in list row without joining messages
--      assigned_staff_id    — owner of the thread (defaults to original sender)
--      city_campaign_id     — chip in list view + filter target
--      event_id             — chip in list view + filter target
--
-- 3. Three new enums:
--      thread_state         — needs_reply, waiting_on_them, follow_up_due,
--                             closed_won, closed_lost, closed_dnc, archived
--      thread_direction     — inbound, outbound, mixed
--      reply_classification — superset of reply_category, adds
--                             callback_requested, unsubscribe, auto_reply,
--                             spam, unclassified (default)
--
-- 4. Indexes on (state, last_message_at DESC) and the FK chips so the list
--    query at scale (100k threads) stays under 10ms.
--
-- Why not webhook-driven?
-- -----------------------
-- Gmail's push notifications need a Pub/Sub topic + watch renewal. We're
-- staying with the 5-minute polling worker (already partially built — see
-- staff_outreach_emails.gmail_last_history_id). This migration adds no
-- ingestion path; it just defines where polled messages will land.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thread_state') THEN
    CREATE TYPE thread_state AS ENUM (
      'needs_reply',
      'waiting_on_them',
      'follow_up_due',
      'closed_won',
      'closed_lost',
      'closed_dnc',
      'archived'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thread_direction') THEN
    CREATE TYPE thread_direction AS ENUM ('inbound', 'outbound', 'mixed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reply_classification') THEN
    CREATE TYPE reply_classification AS ENUM (
      'interested',
      'question',
      'callback_requested',
      'decline',
      'unsubscribe',
      'auto_reply',
      'spam',
      'unclassified'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_kind') THEN
    CREATE TYPE message_kind AS ENUM ('email', 'sms', 'viber', 'line', 'manual_note');
  END IF;
END$$;

-- -------------------------------------------------------------------------
-- email_threads: extend with state + denormalized fields for the list view
-- -------------------------------------------------------------------------
-- All ADD COLUMN IF NOT EXISTS so this is idempotent against future runs.
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS state thread_state NOT NULL DEFAULT 'needs_reply',
  ADD COLUMN IF NOT EXISTS classification reply_classification NOT NULL DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS direction thread_direction NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS snippet text,
  ADD COLUMN IF NOT EXISTS message_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sender_name text,
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city_campaign_id uuid REFERENCES city_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

-- Backfill last_inbound_at from the latest reply_inbox row so existing
-- threads aren't all NULL (SLA breach would skip them otherwise).
UPDATE email_threads et
SET last_inbound_at = ri.received_at
FROM (
  SELECT email_thread_id, MAX(received_at) AS received_at
  FROM reply_inbox
  GROUP BY email_thread_id
) ri
WHERE ri.email_thread_id = et.id
  AND et.last_inbound_at IS NULL;

-- -------------------------------------------------------------------------
-- Indexes on email_threads for the list query
-- -------------------------------------------------------------------------
-- Hot path: "threads in state X for staff Y, ordered by recency."
CREATE INDEX IF NOT EXISTS email_threads_state_last_msg_idx
  ON email_threads(state, last_message_at DESC NULLS LAST)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS email_threads_assigned_state_idx
  ON email_threads(assigned_staff_id, state, last_message_at DESC NULLS LAST)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS email_threads_city_campaign_state_idx
  ON email_threads(city_campaign_id, state, last_message_at DESC NULLS LAST)
  WHERE archived_at IS NULL AND city_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_threads_event_state_idx
  ON email_threads(event_id, state, last_message_at DESC NULLS LAST)
  WHERE archived_at IS NULL AND event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_threads_brand_state_idx
  ON email_threads(outreach_brand_id, state, last_message_at DESC NULLS LAST)
  WHERE archived_at IS NULL;

-- For SLA breach scanning (oldest unreplied at the top of the queue):
CREATE INDEX IF NOT EXISTS email_threads_needs_reply_inbound_idx
  ON email_threads(last_inbound_at ASC NULLS LAST)
  WHERE state = 'needs_reply' AND archived_at IS NULL;

-- -------------------------------------------------------------------------
-- email_messages — one row per individual email
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,

  -- Gmail's per-message ID (not the thread ID). Required for dedup —
  -- the polling worker may see the same message twice if histories
  -- overlap across polling windows.
  gmail_message_id text NOT NULL,

  -- RFC headers we keep for downstream threading + debugging.
  rfc_message_id text,                  -- Message-ID header
  in_reply_to text,                     -- In-Reply-To header

  kind message_kind NOT NULL DEFAULT 'email',
  direction thread_direction NOT NULL,  -- only 'inbound' or 'outbound' for messages
  -- 'mixed' is reserved for thread.direction and is meaningless on a single message

  from_address text NOT NULL,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  bcc_addresses text[] NOT NULL DEFAULT '{}',

  -- Raw subject from this message. The Re:/Fwd:-stripped canonical
  -- version lives on email_threads.subject; on a message it's the
  -- literal header.
  subject text NOT NULL,

  body_text text,
  body_html text,
  snippet text,                         -- precomputed ~140-char preview

  -- Gmail labels + provider payload for debugging
  gmail_labels text[] NOT NULL DEFAULT '{}',
  raw_payload jsonb,

  -- Timing
  sent_at timestamptz NOT NULL,         -- when the message was sent/received
  received_at timestamptz,              -- when our poller picked it up
  read_at timestamptz,                  -- global "team has seen this" timestamp

  -- Attribution for outbound (which staff inbox + member sent it)
  sent_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  staff_outreach_email_id uuid REFERENCES staff_outreach_emails(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  -- One Gmail message ID per inbox-mailbox. The Gmail message ID is unique
  -- per Gmail account, not globally, so we scope by staff_outreach_email_id.
  -- Without this UNIQUE, repeated polling double-inserts the same message.
  UNIQUE (gmail_message_id, staff_outreach_email_id)
);

CREATE INDEX IF NOT EXISTS email_messages_thread_sent_at_idx
  ON email_messages(thread_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS email_messages_rfc_id_idx
  ON email_messages(rfc_message_id) WHERE rfc_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_in_reply_to_idx
  ON email_messages(in_reply_to) WHERE in_reply_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_thread_direction_idx
  ON email_messages(thread_id, direction);

-- Full-text search across subject + body. Used for the future search bar
-- in the inbox header.
CREATE INDEX IF NOT EXISTS email_messages_search_idx ON email_messages
  USING gin (to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')));

-- -------------------------------------------------------------------------
-- email_attachments — file metadata for messages with attachments
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,

  filename text NOT NULL,
  content_type text,
  size_bytes bigint,

  -- Where the actual file lives. v1: Gmail attachment ID, fetched on-demand
  -- when the operator clicks "download". Future: mirror to B2 for offline.
  gmail_attachment_id text,
  storage_url text,                     -- B2 URL once mirrored
  inline_content_id text,               -- for inline images (cid:...)

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_attachments_message_idx
  ON email_attachments(message_id);

-- -------------------------------------------------------------------------
-- Triggers: touch + audit on the new tables, audit on email_threads if
-- it doesn't already have one
-- -------------------------------------------------------------------------
-- email_messages is mostly insert-only; only audit needed.
DROP TRIGGER IF EXISTS email_messages_audit ON email_messages;
CREATE TRIGGER email_messages_audit
  AFTER INSERT OR UPDATE OR DELETE ON email_messages
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- email_attachments: same.
DROP TRIGGER IF EXISTS email_attachments_audit ON email_attachments;
CREATE TRIGGER email_attachments_audit
  AFTER INSERT OR UPDATE OR DELETE ON email_attachments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- email_threads triggers may or may not already exist depending on history.
-- Re-create idempotently.
DROP TRIGGER IF EXISTS email_threads_touch_updated_at ON email_threads;
CREATE TRIGGER email_threads_touch_updated_at BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();

DROP TRIGGER IF EXISTS email_threads_bump_version ON email_threads;
CREATE TRIGGER email_threads_bump_version BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();

DROP TRIGGER IF EXISTS email_threads_audit ON email_threads;
CREATE TRIGGER email_threads_audit AFTER INSERT OR UPDATE OR DELETE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMIT;

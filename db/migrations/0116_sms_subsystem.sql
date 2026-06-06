-- SMS subsystem (Twilio) -- Phase 5.2/5.3/5.4.
--
-- Three tables backing lib/sms.ts + lib/sms-cadence.ts + the inbound webhook:
--   sms_messages    : every outbound + inbound SMS (audit log). Outbound rows
--                     are written before the provider call; status starts
--                     'queued' (configured) or 'unconfigured' (inert dry-run).
--   sms_consent_log : append-only opt-in / STOP / START / HELP events (A2P).
--   host_sms_log    : per (external host, event, H-touch) idempotency for the
--                     host SMS cadence; UNIQUE blocks double-sends.
--
-- direction / status / kind / action / touch_code are plain text (the Drizzle
-- schema carries the value unions); no new enum types are created. FKs use SET
-- NULL so the message log survives venue/host/campaign deletion; host_sms_log
-- cascades (it is meaningless without its host + event). created_by/updated_by
-- are nullable uuids (no FK) for cron/system rows, matching db/types.ts.

CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'twilio',
  provider_sid TEXT,
  from_e164 TEXT,
  to_e164 TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  kind TEXT NOT NULL,
  external_host_id UUID REFERENCES external_hosts(id) ON DELETE SET NULL,
  venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  city_campaign_id UUID REFERENCES city_campaigns(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  outreach_brand_id UUID REFERENCES outreach_brands(id) ON DELETE SET NULL,
  related_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  staff_id UUID,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX IF NOT EXISTS sms_messages_direction_created_idx
  ON sms_messages (direction, created_at);
CREATE INDEX IF NOT EXISTS sms_messages_host_idx ON sms_messages (external_host_id);
CREATE INDEX IF NOT EXISTS sms_messages_to_idx ON sms_messages (to_e164);
-- NULLs are distinct in a Postgres unique index, so the many pre-send /
-- unconfigured NULL provider_sid rows coexist; real Twilio SIDs dedup.
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_provider_sid_unique
  ON sms_messages (provider_sid);

CREATE TABLE IF NOT EXISTS sms_consent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  external_host_id UUID REFERENCES external_hosts(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX IF NOT EXISTS sms_consent_log_phone_idx
  ON sms_consent_log (phone_e164, created_at);

CREATE TABLE IF NOT EXISTS host_sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_host_id UUID NOT NULL REFERENCES external_hosts(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  touch_code TEXT NOT NULL,
  sms_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  response_body TEXT,
  responded_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS host_sms_log_host_event_touch_unique
  ON host_sms_log (external_host_id, event_id, touch_code);
CREATE INDEX IF NOT EXISTS host_sms_log_event_idx ON host_sms_log (event_id);

-- Migration 0030 — External hosts table
--
-- Operator session-12 P3: "External hosts table (full name, email,
-- phone, pay rate/hr, currency, full address, payment method, payment
-- contact)."
--
-- External hosts are contractors paid to run crawls. Reuses the
-- payment_method enum created in 0029. payment_contact captures who to
-- actually send money to (may differ from the host).

CREATE TABLE IF NOT EXISTS external_hosts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  email           text,
  phone_e164      text,
  pay_rate_cents  bigint NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  address         text,
  payment_method  payment_method,
  payment_contact text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  archived_at     timestamptz
);

CREATE INDEX IF NOT EXISTS external_hosts_active_idx
  ON external_hosts (archived_at)
  WHERE archived_at IS NULL;

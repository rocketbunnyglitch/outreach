-- Migration 0029 — Internal hosts table + payment_method enum
--
-- Operator session-12 P3: "Internal hosts table (name, amount/hr, hrs
-- worked, total, currency, payment type venmo/bank/interac/zelle/
-- paypal/wise)."
--
-- Internal hosts are team members paid hourly to run crawls. The TOTAL
-- (rate × hours) is intentionally NOT stored — it's derived in the
-- query/UI so there's one source of truth.
--
-- payment_method is a shared enum (external_hosts, a later migration,
-- reuses it). Created with IF NOT EXISTS guard via DO block so re-runs
-- are safe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM (
      'venmo', 'bank', 'interac', 'zelle', 'paypal', 'wise'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS internal_hosts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  pay_rate_cents  bigint NOT NULL DEFAULT 0,
  hours_worked    numeric(6,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'CAD',
  payment_method  payment_method,
  payment_details text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  archived_at     timestamptz
);

CREATE INDEX IF NOT EXISTS internal_hosts_active_idx
  ON internal_hosts (archived_at)
  WHERE archived_at IS NULL;

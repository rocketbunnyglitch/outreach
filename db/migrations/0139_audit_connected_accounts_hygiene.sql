-- 0139: audit_log hygiene for connected_accounts (FULL_AUDIT P102-P104).
--
-- Problem: the generic audit_trigger_func() snapshots the FULL row on
-- every UPDATE. The Gmail poller bumps gmail_last_history_id /
-- gmail_last_polled_at / last_synced_at every cycle on 17 accounts,
-- producing ~182k audit rows PER WEEK (64% of the whole audit_log,
-- 1.8 GB) — and every snapshot embeds gmail_oauth_refresh_token and
-- signature_html.
--
-- Fix (expand/contract safe — function + trigger swap, no schema change):
--   1. Dedicated audit function for connected_accounts that
--      a) skips the audit entirely when ONLY machine-churn columns
--         changed (poller bookkeeping + touch/version triggers), and
--      b) strips token/signature payloads from what it stores.
--   2. Re-point the table's audit trigger at it.
--   3. Purge historical machine-churn rows (changed_by IS NULL) and
--      redact tokens from the remaining (human) rows.

CREATE OR REPLACE FUNCTION audit_connected_accounts_func() RETURNS trigger AS $$
DECLARE
  actor uuid;
  record_id_value uuid;
  old_j jsonb;
  new_j jsonb;
  -- Poller/trigger bookkeeping: changes to ONLY these never get audited.
  churn text[] := ARRAY[
    'gmail_last_history_id','gmail_last_polled_at','last_synced_at',
    'updated_at','version'
  ];
  -- Secrets/bulk payloads: never stored in audit snapshots.
  redacted text[] := ARRAY['gmail_oauth_refresh_token','signature_html'];
  k text;
BEGIN
  BEGIN
    actor := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    actor := NULL;
  END;

  IF (TG_OP = 'UPDATE') THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    IF old_j = new_j THEN
      RETURN NEW;
    END IF;
    -- Suppress when the diff is churn-only.
    FOREACH k IN ARRAY churn LOOP
      old_j := old_j - k;
      new_j := new_j - k;
    END LOOP;
    IF old_j = new_j THEN
      RETURN NEW;
    END IF;
    FOREACH k IN ARRAY redacted LOOP
      old_j := old_j - k;
      new_j := new_j - k;
    END LOOP;
    record_id_value := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, operation, changed_by, old_values, new_values)
    VALUES (TG_TABLE_NAME, record_id_value, 'UPDATE', actor, old_j, new_j);
    RETURN NEW;

  ELSIF (TG_OP = 'INSERT') THEN
    new_j := to_jsonb(NEW);
    FOREACH k IN ARRAY redacted LOOP
      new_j := new_j - k;
    END LOOP;
    record_id_value := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, operation, changed_by, old_values, new_values)
    VALUES (TG_TABLE_NAME, record_id_value, 'INSERT', actor, NULL, new_j);
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    old_j := to_jsonb(OLD);
    FOREACH k IN ARRAY redacted LOOP
      old_j := old_j - k;
    END LOOP;
    record_id_value := (to_jsonb(OLD) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, operation, changed_by, old_values, new_values)
    VALUES (TG_TABLE_NAME, record_id_value, 'DELETE', actor, old_j, NULL);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_outreach_emails_audit ON connected_accounts;
CREATE TRIGGER staff_outreach_emails_audit
  AFTER INSERT OR UPDATE OR DELETE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_connected_accounts_func();

-- Purge historical machine churn (system writes only; human config
-- changes — changed_by set — are kept, with secrets redacted below).
DELETE FROM audit_log
WHERE table_name = 'connected_accounts' AND changed_by IS NULL;

-- Redact secrets from every remaining connected_accounts snapshot.
UPDATE audit_log
SET old_values = (old_values - 'gmail_oauth_refresh_token') - 'signature_html',
    new_values = (new_values - 'gmail_oauth_refresh_token') - 'signature_html'
WHERE table_name = 'connected_accounts';

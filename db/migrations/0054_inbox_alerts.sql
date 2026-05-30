-- 0054_inbox_alerts.sql
--
-- Per-inbox alert configuration + delivery log.
--
-- alert_rules row per (connected_account, alert_kind). The rule fires
-- when its threshold is met during a check; the alert_dispatch row
-- records each individual fire so we can rate-limit (don't re-alert
-- on the same condition every 10 minutes — once per day per
-- (account, rule_kind) is fine).
--
-- Rule kinds (text, not enum so we can add new kinds without migration):
--   'bounce_rate'        — fires when 7d bounce_rate exceeds threshold
--   'sync_stale'         — fires when last_synced_at is older than threshold (in minutes)
--   'no_replies'         — fires when 7d cold_sends >= some min but 0 replies
--   'cap_breached'       — fires when bypass count today > 0 (admin curiosity)
--
-- Channels: 'email' goes to the team's primary admin emails;
--           'slack' posts to ALERT_SLACK_WEBHOOK_URL env if set.
-- v1 only ships 'email' (Slack is wired but disabled if env unset).

CREATE TABLE IF NOT EXISTS inbox_alert_rules (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connected_account_id    uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
    rule_kind               text NOT NULL,
    -- Threshold value for the rule (units interpreted by the worker).
    -- For 'bounce_rate' it's a 0..1 ratio; for 'sync_stale' it's minutes;
    -- for 'no_replies' it's the min cold_send count to require; etc.
    threshold               numeric NOT NULL,
    enabled                 boolean NOT NULL DEFAULT true,
    channels                text[] NOT NULL DEFAULT ARRAY['email'],
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inbox_alert_rules_account_kind_unique UNIQUE (connected_account_id, rule_kind)
);

CREATE INDEX IF NOT EXISTS inbox_alert_rules_account_idx
    ON inbox_alert_rules (connected_account_id);

-- Dispatch log — every time a rule fires AND we sent something.
-- Indexed by (rule_id, fired_at) so the worker can ask
-- "did I already fire this rule today?" without scanning.
CREATE TABLE IF NOT EXISTS inbox_alert_dispatches (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id                 uuid NOT NULL REFERENCES inbox_alert_rules(id) ON DELETE CASCADE,
    fired_at                timestamptz NOT NULL DEFAULT now(),
    -- Snapshot of the value that crossed the threshold (for the
    -- notification body's "your inbox X has bounce rate 7.4%" line).
    observed_value          numeric NOT NULL,
    channel                 text NOT NULL,
    -- 'sent' / 'skipped' / 'failed' — diagnostic for the operator
    -- if they need to know why an alert didn't land.
    status                  text NOT NULL,
    notes                   text
);

CREATE INDEX IF NOT EXISTS inbox_alert_dispatches_rule_fired_idx
    ON inbox_alert_dispatches (rule_id, fired_at DESC);

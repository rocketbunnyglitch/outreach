-- 0053_soft_bounce_and_inbox_daily_stats.sql
--
-- Two additions for the deliverability-instrumentation layer:
--
-- 1) Per-address soft-bounce tracker
--    Soft bounces (4.x.x SMTP) are transient. A single 4xx doesn't
--    suppress an address — but if the same address bounces softly
--    on 3+ consecutive attempts we should escalate to permanent
--    suppression. This new table tracks per-(team, email) soft-bounce
--    history so the worker can count + escalate.
--
-- 2) Daily inbox stats rollup
--    The per-account analytics on /settings/inboxes (loadInboxAnalytics)
--    compute rates on the fly over a 30-day window. For sparklines + alert
--    rules we need a tiny time series. This table is the cheap daily
--    rollup — one row per (inbox, day, UTC) with the four counters that
--    matter (cold_sends, replies, bounces, stale_threads_at_eod). The
--    cron worker upserts each night; UI reads back 30 days for the
--    sparkline component.

-- Per-team, per-address soft-bounce counter.
CREATE TABLE IF NOT EXISTS email_soft_bounces (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email                   text NOT NULL,
    -- Running count of consecutive soft bounces seen for this address
    -- on this team. Reset to 0 (or row deleted) when we observe a
    -- successful delivery OR a hard bounce supersedes (suppression
    -- handles the hard-bounce case).
    consecutive_count       integer NOT NULL DEFAULT 0,
    -- Most recent soft-bounce subject — gives the operator context
    -- if they're investigating why an address eventually got escalated.
    last_subject            text,
    last_seen_at            timestamptz NOT NULL DEFAULT now(),
    first_seen_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_soft_bounces_team_email_unique UNIQUE (team_id, email)
);

CREATE INDEX IF NOT EXISTS email_soft_bounces_team_email_idx
    ON email_soft_bounces (team_id, email);

CREATE INDEX IF NOT EXISTS email_soft_bounces_last_seen_idx
    ON email_soft_bounces (last_seen_at);

-- Daily per-inbox stats rollup. UTC day, one row per (inbox, day).
CREATE TABLE IF NOT EXISTS inbox_daily_stats (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connected_account_id    uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
    -- The UTC day this row represents. Stored as date for clean
    -- ON CONFLICT semantics on (account, day).
    stat_date               date NOT NULL,
    -- Cold sends recorded against this account on this day
    -- (counted_against_cap = true).
    cold_sends              integer NOT NULL DEFAULT 0,
    -- Inbound replies on threads owned by this inbox where the
    -- inbound message arrived on this day.
    replies                 integer NOT NULL DEFAULT 0,
    -- Distinct recipients sent to BY THIS INBOX that became
    -- bounce-suppressed on this day. (Approximation — we attribute
    -- by suppression created_at, not strict per-day delivery
    -- attribution. Good enough for time-series.)
    bounces                 integer NOT NULL DEFAULT 0,
    -- Snapshot at end-of-day: open + is_stale=true threads owned
    -- by this inbox. Snapshot (not cumulative) so the sparkline
    -- shows trend.
    stale_threads_at_eod    integer NOT NULL DEFAULT 0,
    computed_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inbox_daily_stats_account_date_unique UNIQUE (connected_account_id, stat_date)
);

CREATE INDEX IF NOT EXISTS inbox_daily_stats_account_date_idx
    ON inbox_daily_stats (connected_account_id, stat_date DESC);

CREATE INDEX IF NOT EXISTS inbox_daily_stats_date_idx
    ON inbox_daily_stats (stat_date DESC);

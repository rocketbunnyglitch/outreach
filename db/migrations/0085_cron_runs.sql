-- 0085_cron_runs.sql
-- Observability table for the eight cron routes in app/api/cron/*.
-- Every cron handler is wrapped by lib/cron-runs.ts#recordCronRun
-- which inserts a "running" row on entry and updates it to
-- success/error on exit. The /admin/cron-health page reads this
-- table to render a recent-runs dashboard so operators can see
-- when a job silently stopped firing or started failing.
--
-- Why this table (and not just logs):
--
--   - Logs are write-only + lossy. To answer "did the daily
--     digest run this morning?" from logs you'd need log retention
--     + a query tool. From this table, a single SELECT.
--
--   - Per-cron baseline. Knowing the typical duration of
--     gmail-poll (say 4 seconds) makes a 90-second run obvious in
--     the dashboard. Logs are too granular for that pattern.
--
--   - Idempotency check. If a cron has been silently double-
--     scheduled, this table shows two "running" rows + occasional
--     race-condition errors. From logs that's hard to spot.
--
-- Retention strategy: this table grows unbounded if left alone.
-- A typical team's eight crons firing at 10-minute cadence puts
-- ~1150 rows per day. Over a year that's ~420k rows. Acceptable
-- for current scale; a future cleanup cron can prune rows older
-- than 30-60 days when needed.

CREATE TABLE IF NOT EXISTS cron_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical short name: "daily-digest", "gmail-poll", etc.
  -- Matches the route folder name under app/api/cron/* so the
  -- mapping from URL to row is obvious.
  cron_name     text NOT NULL,

  -- "running" | "success" | "error"
  -- running rows are written on entry; updated to success/error
  -- on exit. A row stuck at "running" forever (no finished_at)
  -- indicates a hung or killed process -- the dashboard treats
  -- it as failure after a generous timeout.
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'success', 'error')),

  -- Set on insert; never updated.
  started_at    timestamptz NOT NULL DEFAULT NOW(),
  -- Set when the cron handler returns (or throws). NULL while
  -- the run is in-flight.
  finished_at   timestamptz,
  -- Convenience: finished_at - started_at, in milliseconds.
  -- Populated server-side by the wrapper so the dashboard
  -- doesn't have to compute it.
  duration_ms   integer,

  -- On error: the Error.message + the first few lines of the
  -- stack. Capped at ~2KB by the wrapper so a stack trace
  -- explosion can't bloat the table. NULL on success.
  error_message text,

  -- On success: the cron handler's own return value, JSON-
  -- stringified. Lets the dashboard show e.g. "ingested 12,
  -- threads 3" without a separate column per cron type. NULL
  -- on error (the dashboard shows error_message instead).
  result_summary jsonb,

  -- Audit. The host that ran the cron (typically the single
  -- app server's hostname). Not currently surfaced in the UI
  -- but useful for future multi-host setups.
  host          text
);

-- "Recent runs for cron X." The dashboard's per-cron card uses
-- this index to fetch the last 10 runs.
CREATE INDEX IF NOT EXISTS cron_runs_name_started_idx
  ON cron_runs (cron_name, started_at DESC);

-- "Recent activity across all crons." The dashboard's top
-- timeline strip uses this.
CREATE INDEX IF NOT EXISTS cron_runs_started_idx
  ON cron_runs (started_at DESC);

-- "Find recent failures." A future alerting cron can use this
-- to page on a failure count crossing a threshold.
CREATE INDEX IF NOT EXISTS cron_runs_status_started_idx
  ON cron_runs (status, started_at DESC)
  WHERE status = 'error';

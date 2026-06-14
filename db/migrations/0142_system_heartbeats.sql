-- 0142_system_heartbeats.sql
--
-- Dead-man's-switch table for the anti-silence monitor. Components that have no
-- other DB trace (notably the bash offsite-backup job) stamp a heartbeat here on
-- success; the liveness monitor flags any registered component whose heartbeat
-- has gone stale. DB-resident components are checked against their own tables
-- directly and don't need a row here. Expand-only.

CREATE TABLE IF NOT EXISTS system_heartbeats (
  component text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_value bigint,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

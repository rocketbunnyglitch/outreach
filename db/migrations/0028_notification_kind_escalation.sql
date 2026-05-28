-- 0028_notification_kind_escalation.sql
--
-- Adds 'escalation' to notification_kind so the escalation workflow
-- (migration 0027) can drop a row into the per-staff notifications
-- inbox when an entry is escalated to that staffer. The bell icon in
-- the top nav surfaces this immediately for Brandon (or whoever's
-- the assignee).
--
-- Postgres ALTER TYPE ... ADD VALUE is non-transactional in older
-- versions. From PG12+ it can run in a transaction as long as it's
-- the first command, but our deploy script runs each migration in
-- its own psql -1 invocation already, so we don't need to worry
-- about the transaction-safety dance.
--
-- IF NOT EXISTS guards against re-running this on an env that
-- somehow already has the value (e.g., manual prod fix).

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'escalation';

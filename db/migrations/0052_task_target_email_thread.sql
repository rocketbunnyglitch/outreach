-- Migration 0052 — Add 'email_thread' to task_target_type
--
-- Standalone migration: ALTER TYPE ... ADD VALUE can't run in a
-- txn block alongside statements that USE the new value (older
-- Postgres). This file contains only the enum extension; the
-- cadence engine in lib/follow-up-cadence.ts uses the new value
-- via raw inserts (no schema reference to drive enum codegen).
--
-- IF NOT EXISTS makes this idempotent on re-run.

ALTER TYPE task_target_type ADD VALUE IF NOT EXISTS 'email_thread';

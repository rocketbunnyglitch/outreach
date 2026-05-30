-- 0057_thread_starred_snoozed_trashed.sql
--
-- Three columns supporting Gmail-style mailbox parity on email_threads:
--
-- is_starred   — Gmail-style star (operator marks important threads).
--                Renders the yellow star on thread rows + a dedicated
--                "Starred" mailbox view. Engine-side first; a future
--                cron can two-way sync to Gmail via the API since
--                connected accounts already carry OAuth credentials.
--
-- snooze_until — Gmail-style snooze. When set, the thread is hidden
--                from default mailbox views until the timestamp
--                passes; at that point a cron (or just SQL filter
--                evaluating snooze_until <= now()) re-surfaces it.
--                NULL = not snoozed.
--
-- deleted_at   — Soft-trash. The /admin/inbox UI treats deleted_at
--                IS NOT NULL as "moved to trash" — recoverable, not
--                hard-deleted. Distinct from archived_at (the existing
--                soft-archive on auditable rows) so operators can
--                trash + un-trash without losing the archived-at
--                lineage. A separate cron could later hard-purge rows
--                where deleted_at < now() - 30 days.

ALTER TABLE email_threads
    ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS snooze_until timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index supporting the Starred mailbox query (sparse — most threads
-- aren't starred, so a partial index keeps it tiny).
CREATE INDEX IF NOT EXISTS email_threads_starred_idx
    ON email_threads (last_message_at DESC)
    WHERE is_starred = true;

-- Index for the snoozed-reappearance cron + the Snoozed mailbox.
CREATE INDEX IF NOT EXISTS email_threads_snoozed_idx
    ON email_threads (snooze_until)
    WHERE snooze_until IS NOT NULL;

-- Index for the Trash view + the future hard-purge cron.
CREATE INDEX IF NOT EXISTS email_threads_trash_idx
    ON email_threads (deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

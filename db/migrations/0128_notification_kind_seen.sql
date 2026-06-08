-- Real-time open notifications (Tier-2). Adds a 'seen' notification kind so a
-- warm-venue OPEN (real, non-proxy) can notify the sender, clearly labelled
-- "Seen" -- distinct from a 'reply'. Opens stay a SOFT signal: the notification
-- is informational only and never drives cadence or sends.
--
-- ADD VALUE IF NOT EXISTS is safe to re-run. PostgreSQL 12+ allows adding an
-- enum value inside a transaction (the value just can't be USED until the tx
-- commits -- which is fine here, nothing in this migration references it).
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'seen';

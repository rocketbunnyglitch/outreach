-- Raise the per-account daily cold-send cap to 50 (operator request,
-- 2026-06-08; was 30). Sets the column default for new inboxes and bumps every
-- existing account that's still on the old default of 30. Accounts with a
-- custom non-30 cap are left as-is.
ALTER TABLE connected_accounts ALTER COLUMN daily_cold_send_cap SET DEFAULT 50;
UPDATE connected_accounts SET daily_cold_send_cap = 50 WHERE daily_cold_send_cap = 30;

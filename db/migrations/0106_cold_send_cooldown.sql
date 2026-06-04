-- Cold-send pacing cooldown.
--
-- After a COLD outreach send (a brand-new thread, not a warm reply), the
-- sending inbox gets a randomized 5-8 minute cooldown before the next cold send
-- is allowed. Warm sends + replies are unaffected. Stored as an absolute
-- timestamp on the connected account; the composer renders a countdown ring
-- next to the daily cap counter, and the send path blocks cold sends until it
-- passes (admins bypass via the existing cap-bypass path).
ALTER TABLE connected_accounts
  ADD COLUMN cold_send_cooldown_until TIMESTAMPTZ;

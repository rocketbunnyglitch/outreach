-- Phase: cold/warm sync
-- See: lib/import/campaigns.ts comments + operator feedback
--   "yes cold should be preserved and then yes warm moves up..
--    a row that shows up in each table. so in warm its like oh
--    they are interested but haven't said yes, and someone might
--    delete them from warm table but they are still in the cold
--    table as that cold table is used for mass outreach."
--
-- Adds a boolean is_warm flag to cold_outreach_entries. Previously
-- "warm" was encoded as status = 'interested', which meant flipping
-- a venue from cold to warm REMOVED it from the cold-outreach table
-- (the cold view filters status != 'interested'). The operator's
-- workflow needs the cold row to STAY in cold even after promotion,
-- so the warm signal needed its own column.
--
-- Backfill: every existing row with status = 'interested' becomes
-- is_warm = true (preserves operator's prior intent — they marked
-- those interested for a reason). Status column unchanged so
-- email-sent / called / etc. semantics survive.
--
-- New behaviour:
--   - Cold table: shows ALL rows (filter is_warm not used; cold is
--     the mass-outreach queue)
--   - Warm table: shows WHERE is_warm = true
--   - "Promote to warm leads" action: sets is_warm = true (status
--     stays whatever it was)
--   - "Remove from warm leads" action: sets is_warm = false (status
--     stays — operator can still see prior interest signal)
--   - Status changes to terminal states (declined / do_not_contact /
--     bad_email / wrong_number) auto-clear is_warm — they're not
--     warm anymore by definition

ALTER TABLE cold_outreach_entries
  ADD COLUMN is_warm boolean NOT NULL DEFAULT false;

-- Backfill: every status='interested' row becomes is_warm=true.
-- Status column unchanged so the per-entry history reads naturally
-- ("operator marked them interested at T") even if they're later
-- un-warmed.
UPDATE cold_outreach_entries SET is_warm = true WHERE status = 'interested';

-- Index for the warm-leads filter (small partial — only true rows).
CREATE INDEX cold_outreach_entries_warm_idx
  ON cold_outreach_entries (city_campaign_id, is_warm)
  WHERE is_warm = true;

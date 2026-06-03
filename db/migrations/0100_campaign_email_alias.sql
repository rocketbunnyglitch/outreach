-- =========================================================================
-- 0100_campaign_email_alias.sql
--
-- Sender alias (persona) per connected email per campaign. Operators send from
-- shared inboxes under a persona name -- e.g. the user Bryle sends from a
-- "Dan" or "Chris" alias. alias_name drives the {{your_name}} merge field AND
-- the actual From display name on the outgoing email, so the recipient sees the
-- persona, not the logged-in user. Set on the campaign info sheet next to the
-- brand. NULL = fall back to the sending user's display name.
--
-- (Next free migration number; the spec's per-phase numbers are nominal -- see
-- the Reconciliation Addendum.)
--
-- Schema mirror: db/schema/campaign-connected-accounts.ts.
-- =========================================================================

ALTER TABLE campaign_connected_accounts
  ADD COLUMN alias_name TEXT;

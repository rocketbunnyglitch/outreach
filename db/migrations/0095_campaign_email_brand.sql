-- =========================================================================
-- 0095_campaign_email_brand.sql
--
-- Brand-per-email (merge-field fix). Each connected email assigned to a
-- campaign can carry its own outreach brand, which drives the {{company_name}}
-- merge field in that email's templates. The operator sets it on the campaign
-- info sheet's connected-emails list. NULL = fall back to the template's
-- outreach brand.
--
-- Lives on campaign_connected_accounts (the campaign <-> email junction) so the
-- same email can present a different brand per campaign.
--
-- Schema mirror: db/schema/campaign-connected-accounts.ts.
-- =========================================================================

ALTER TABLE campaign_connected_accounts
  ADD COLUMN outreach_brand_id UUID REFERENCES outreach_brands(id) ON DELETE SET NULL;

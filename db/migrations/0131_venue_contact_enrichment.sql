-- Venue contact enrichment (Phase E1).
--
-- Two things:
--   1. scraped_* columns on venues for on-demand contact enrichment results
--      (distinct from the operator-entered email / instagram_handle).
--   2. venue_enrichment_attempts: one row per enrichment attempt (success or
--      fail) so operators can see history and the bulk action can skip venues
--      that were already attempted.
--
-- Idempotent (IF NOT EXISTS). Additive only -- safe on the live venues table.

-- Per-venue scraped contact data.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS scraped_emails JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS scraped_instagram TEXT,
  ADD COLUMN IF NOT EXISTS scraped_facebook TEXT,
  ADD COLUMN IF NOT EXISTS last_enrichment_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_enrichment_status TEXT;
  -- last_enrichment_status: 'tier1_success' | 'tier1_partial' | 'tier1_failed_no_emails'
  --   | 'tier2_success' | 'tier2_failed' | 'no_website' | 'unreachable' | 'manual_override'

-- Per-attempt audit log (one row per attempt, even retries).
CREATE TABLE IF NOT EXISTS venue_enrichment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  -- Which staff member triggered. FK to users (table renamed staff_members->users,
  -- mig 0041); SET NULL so deleting a user doesn't drop the audit trail. NULL for
  -- a future cron trigger.
  triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  trigger_source TEXT NOT NULL, -- 'venue_detail_button' | 'cold_outreach_bulk' | 'manual_retrigger' | 'api'
  tier_used INTEGER, -- 1 or 2; null if neither ran
  status TEXT NOT NULL, -- same vocabulary as last_enrichment_status, plus 'in_progress'
  emails_found INTEGER NOT NULL DEFAULT 0,
  instagram_found BOOLEAN NOT NULL DEFAULT FALSE,
  facebook_found BOOLEAN NOT NULL DEFAULT FALSE,
  pages_fetched JSONB NOT NULL DEFAULT '[]'::JSONB, -- URLs successfully fetched
  pages_failed JSONB NOT NULL DEFAULT '[]'::JSONB,  -- URLs that returned errors
  cost_estimate_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_venue_enrichment_attempts_venue_id
  ON venue_enrichment_attempts(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_enrichment_attempts_attempted_at
  ON venue_enrichment_attempts(attempted_at DESC);

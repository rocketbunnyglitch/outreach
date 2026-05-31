-- AI lead scoring on cold-outreach entries (Haiku ROI #5).
--
-- Adds three columns to cold_outreach_entries so the cold-outreach
-- worksheet can rank "most worth outreach" venues at the top,
-- giving operators a default-sort signal that's better than
-- alphabetical or seed-order.
--
--   ai_lead_score         smallint NULL — 0..100. Higher = more
--                          worth pursuing. NULL = not scored yet.
--                          Scoring factors (see lib/ai-lead-score.ts):
--                            - venue completeness (email + phone +
--                              website + capacity + hours all present
--                              push the score up)
--                            - venue type match (bar / lounge / club
--                              beats restaurant beats coffee shop)
--                            - capacity hint (mid-size 100-400 ideal
--                              for crawl slots)
--                            - signal of activity (instagram handle,
--                              website that exists)
--                            - city + market context
--
--   ai_lead_score_reason  text NULL — 1-line human-readable summary
--                          ("Strong: 4.5★ on Google, ~250 cap, has
--                           email + IG, similar venues confirmed in
--                           Toronto"). Shown in a tooltip on the
--                          score chip.
--
--   ai_lead_score_at      timestamptz NULL — when the score was last
--                          generated. Operator can re-score by running
--                          the admin backfill action; the lib re-scores
--                          when this is older than 30 days.
--
-- Idempotent (IF NOT EXISTS). No backfill — scores materialize when
-- the admin runs the backfill action OR when a new cold entry is
-- created.

ALTER TABLE cold_outreach_entries
  ADD COLUMN IF NOT EXISTS ai_lead_score smallint,
  ADD COLUMN IF NOT EXISTS ai_lead_score_reason text,
  ADD COLUMN IF NOT EXISTS ai_lead_score_at timestamptz;

CREATE INDEX IF NOT EXISTS cold_outreach_entries_ai_lead_score_idx
  ON cold_outreach_entries (city_campaign_id, ai_lead_score DESC NULLS LAST);

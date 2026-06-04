-- Phase 3.8 - per-venue x per-outreach-brand relationship flag.
--
-- Tracks the relationship history between a venue and an outreach brand
-- (good / neutral / bad / no_history), how it was set (manual operator, auto
-- from an inbound classification, or a post-event flag), and an optional
-- auto-clear horizon for time-boxed 'bad' flags. [Reference Doc 3.3]
--
-- One row per (venue, brand). Downstream phases read this: 3.9 auto-detects
-- from inbound replies, 3.10 hard-blocks sends for 'bad' pairs, 3.11 decays
-- bad flags via cron.
--
-- NOTE: the spec named the set-by FK target staff_members(id); the real table
-- is users(id) - staff_members is a Drizzle alias of users. The FK targets
-- users(id) accordingly.

CREATE TABLE venue_domain_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  outreach_brand_id UUID NOT NULL REFERENCES outreach_brands(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('good', 'neutral', 'bad', 'no_history')),
  set_by TEXT NOT NULL CHECK (set_by IN ('auto_inbound', 'manual_operator', 'post_event_flag')),
  set_by_staff_id UUID REFERENCES users(id),
  notes TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auto_clear_at TIMESTAMPTZ,
  UNIQUE (venue_id, outreach_brand_id)
);

CREATE INDEX vdr_venue_idx ON venue_domain_relationships (venue_id);
CREATE INDEX vdr_status_idx ON venue_domain_relationships (status);

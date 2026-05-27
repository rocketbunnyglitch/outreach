-- =========================================================================
-- 0017_staff_views.sql
--
-- Per-staff saved views: named filter/sort preset for any table surface.
--
-- Use case: an operator builds a filtered cold-outreach view ('Toronto
-- unassigned, sorted by status'), names it 'My Toronto pipeline', and
-- can re-open the same view in one click later. Matches the Sheets
-- 'Create filter view' affordance.
--
-- Stored as a free-form JSON of URL search params so the table itself
-- doesn't need a custom schema per surface — adding 'all crawls saved
-- views' or 'venue saved views' later costs zero schema changes.
-- =========================================================================

CREATE TABLE IF NOT EXISTS staff_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,

  -- The surface this view applies to: 'cold_outreach', 'all_crawls', etc.
  -- Free text — the app maps surface keys to URL templates.
  surface TEXT NOT NULL,

  -- Optional context scoping. For cold outreach views, this is the
  -- city_campaign_id (so 'My Toronto pipeline' doesn't appear when the
  -- operator is looking at Montreal). NULL means the view is global to
  -- the surface (e.g. a default sort for all_crawls).
  context_id UUID,

  name TEXT NOT NULL,

  -- The view payload — a JSON object of URL search params, e.g.
  --   { "sort": "status", "dir": "desc", "status": "email_sent",
  --     "assignee": "<uuid>" }
  -- Order-independent; the URL composer alphabetizes keys.
  params JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Ordering hint for the picker dropdown. Lower = higher in list.
  -- Operators reorder by drag (future), default 0 = newest-first.
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique view name per (staff, surface, context) so the picker shows
  -- a clean list. Re-saving an existing-name view overwrites params.
  CONSTRAINT staff_views_unique_name UNIQUE (staff_id, surface, context_id, name)
);

CREATE INDEX IF NOT EXISTS staff_views_lookup_idx
  ON staff_views(staff_id, surface, context_id, sort_order, name);

-- Audit trigger so saved-view changes show up in row history alongside
-- everything else. The audit trigger function from 0000_setup.sql is
-- generic; we just attach it.
DROP TRIGGER IF EXISTS staff_views_audit ON staff_views;
CREATE TRIGGER staff_views_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_views
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

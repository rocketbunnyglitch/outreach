-- 0027_cold_outreach_escalation.sql
--
-- Adds the "escalate to Brandon" (or any senior staff) workflow.
--
-- Operator spec (session 12):
--   "When a venue wants more complex info or wants to speak with the
--    owner or someone senior, outreach staff escalates. The escalation
--    should:
--      1. Email the assignee (Brandon by default) at their email on file
--      2. Auto-create a task assigned to them to call this venue
--      3. Surface a note on their dashboard with venue + city + slot +
--         concerns + contact info
--      4. Be filterable as a tab so all staff can see what's with
--         Brandon and what's been completed."
--
-- This migration covers the data model + a simple flag. Email + task +
-- dashboard widget + tab are layered in app code (this turn + follow-ups).
--
-- Three new columns on cold_outreach_entries:
--   * escalated_to_staff_id — uuid FK to staff_members (NULL = not escalated)
--   * escalated_at          — timestamptz of escalation moment
--   * escalation_notes      — free text capturing operator's note about
--                              what the venue wants to discuss
--                              (e.g. "wants a call at 7pm Tuesday — wants
--                              to know about insurance + cancellation
--                              policy")
--
-- Indexed on (escalated_to_staff_id, escalated_at) so the dashboard
-- widget "escalated to me, pending" filter is a cheap range scan.
--
-- onDelete: SET NULL on the staff FK so if a staffer is ever soft-
-- deleted (status='inactive'), the historical escalation references
-- don't cascade-delete the cold-outreach row.

ALTER TABLE cold_outreach_entries
  ADD COLUMN IF NOT EXISTS escalated_to_staff_id uuid
    REFERENCES staff_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_notes text;

-- Partial index — only rows that ARE escalated participate in the
-- index. ~99% of entries won't be escalated; tiny partial index is
-- cheaper than indexing the whole table for a sparse predicate.
CREATE INDEX IF NOT EXISTS cold_outreach_entries_escalated_to_idx
  ON cold_outreach_entries (escalated_to_staff_id, escalated_at DESC)
  WHERE escalated_to_staff_id IS NOT NULL;

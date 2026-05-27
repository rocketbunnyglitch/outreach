-- 0023_staff_titles_phones_and_gela.sql
--
-- Schema additions:
--   staff_members.phone_e164   TEXT NULL  — E.164 cell for the staffer
--                                            (powers Quo escalation handoff
--                                             + future per-staffer call-from
--                                             routing)
--   staff_members.title        TEXT NULL  — display title shown in the UI
--                                            ("Outreach Specialist",
--                                             "Web & Graphics", etc).
--                                            Distinct from `role`, which
--                                            gates permissions. `title`
--                                            is purely display.
--
-- Data:
--   - Inserts Gela (Web & Graphics) if not already in the table.
--     Placeholder primary_email; operator can update via /admin/staff.
--   - Sets phone_e164 for Yesu + JC (+19293493166, +19296614465 per
--     operator-provided numbers).
--   - Sets titles for all 4 known outreach roles. Updates are no-op
--     if the matching display_name isn't present (idempotent and safe
--     to re-run).
--
-- Why text (not citext / enum) for title: titles are free-form display
-- strings. Operator may invent new ones (we already have "Outreach
-- Director", "Outreach Manager", "Outreach Specialist", "Web & Graphics"
-- in flight); an enum would balloon. Constraint left at the
-- application layer.

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Insert Gela if missing. We match by lower-case display_name so we
-- don't double-insert if she was added with capitalization variance.
INSERT INTO staff_members (display_name, primary_email, role, status, title)
SELECT 'Gela', 'gela@events-perse.com', 'outreach', 'active', 'Web & Graphics'
WHERE NOT EXISTS (
  SELECT 1 FROM staff_members WHERE LOWER(display_name) = 'gela'
);

-- Phone numbers. Skip if a phone is already set so operator-edits via
-- the UI win over this migration.
UPDATE staff_members
SET phone_e164 = '+19293493166'
WHERE LOWER(display_name) = 'yesu'
  AND (phone_e164 IS NULL OR phone_e164 = '');

UPDATE staff_members
SET phone_e164 = '+19296614465'
WHERE LOWER(display_name) = 'jc'
  AND (phone_e164 IS NULL OR phone_e164 = '');

-- Titles. Same idempotency guard — don't overwrite if already set.
UPDATE staff_members
SET title = 'Outreach Specialist'
WHERE LOWER(display_name) IN ('yesu', 'jc')
  AND (title IS NULL OR title = '');

UPDATE staff_members
SET title = 'Outreach Manager'
WHERE LOWER(display_name) = 'bryle'
  AND (title IS NULL OR title = '');

UPDATE staff_members
SET title = 'Outreach Director'
WHERE LOWER(display_name) = 'brandon'
  AND (title IS NULL OR title = '');

-- Gela's title was set on INSERT above; this is a no-op if she pre-existed
-- without a title.
UPDATE staff_members
SET title = 'Web & Graphics'
WHERE LOWER(display_name) = 'gela'
  AND (title IS NULL OR title = '');

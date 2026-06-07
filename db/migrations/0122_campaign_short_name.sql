-- Short campaign name for tight / mobile UI (e.g. "IHLWN26"). NULL falls back
-- to the full name (truncated). Additive + nullable.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS short_name TEXT;

-- Seed the live International Halloween 2026 campaign's short name.
UPDATE campaigns
SET short_name = 'IHLWN26'
WHERE id = 'df063509-3645-4c33-98ce-86118cffcc31'
  AND short_name IS NULL;

-- 0083_email_normalized_addresses.sql
--
-- Adds normalized address columns to email_messages so venue
-- communication timelines + duplicate-outreach detection + cross-
-- account matching work for messages whose raw From/To/Cc/Bcc
-- headers contain display names (the common case).
--
-- Before this migration: a message like
--   from_address = 'Mike Smith <info@lavelle.com>'
-- did not match a venue with email 'info@lavelle.com' because the
-- existing matchers compared raw header strings to clean
-- addresses. The venue communication timeline silently missed
-- most threads.
--
-- After this migration: the same row has
--   from_email_normalized = 'info@lavelle.com'
-- alongside the raw from_address. Application code matches on the
-- normalized column. Raw columns remain so the UI can still show
-- "Mike Smith <info@lavelle.com>" exactly as Gmail stored it.
--
-- All five normalized columns are nullable + default to nothing:
-- backfill below populates them. New writes from
-- lib/gmail-poll-worker.ts + lib/compose-send-impl.ts +
-- inbox/_actions.ts set them on insert.

ALTER TABLE email_messages
  ADD COLUMN from_email_normalized text,
  ADD COLUMN to_emails_normalized  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN cc_emails_normalized  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN bcc_emails_normalized text[] NOT NULL DEFAULT '{}';

-- from_name already exists (migration 0020). We re-populate it
-- below as part of the backfill so historical rows that came in
-- with a NULL from_name (possible if the ingest path didn't parse
-- it) pick up the display name from the raw from_address. The
-- COALESCE in the UPDATE preserves any non-null from_name already
-- in the row — we only fill in the gaps.

-- Indexes — `from_email_normalized` is the hot path for venue
-- timeline + duplicate detection. The array columns get GIN indexes
-- so `WHERE to_emails_normalized && ARRAY['x@y.com']` is fast.
CREATE INDEX email_messages_from_email_normalized_idx
  ON email_messages (from_email_normalized);

CREATE INDEX email_messages_to_emails_normalized_gin_idx
  ON email_messages USING GIN (to_emails_normalized);

CREATE INDEX email_messages_cc_emails_normalized_gin_idx
  ON email_messages USING GIN (cc_emails_normalized);

-- =========================================================================
-- Backfill
-- =========================================================================
--
-- The application code uses TypeScript's parseEmailHeader /
-- parseEmailList (lib/email-address.ts) for the canonical parsing
-- rules. We mirror those rules in SQL ONLY for the one-shot
-- backfill — going forward, every new INSERT populates the columns
-- application-side. This keeps the parsing logic single-sourced
-- in TS and avoids drift between SQL and TS implementations.
--
-- The SQL helper extracts an email from a raw header in one of two
-- shapes:
--   1. '... <addr@host> ...'      → captured by the angle-bracket regex
--   2. 'addr@host (anything)'     → captured by the bare-token regex
-- Output is lowercased + trimmed; values that don't match either
-- shape return NULL and end up as NULL / dropped-array-entries.
--
-- We use plpgsql so the helper is reusable inline for each column.

CREATE OR REPLACE FUNCTION pg_temp_extract_email(raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  angled text;
  bare   text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Form 1: ... <addr@host> ... — extract what's between < and >.
  angled := (regexp_match(raw, '<([^<>]+@[^<>[:space:]]+)>'))[1];
  IF angled IS NOT NULL THEN
    RETURN lower(trim(angled));
  END IF;
  -- Form 2: bare addr@host token. Postgres regex inside a
  -- character class wants - at the start or end (no escape) and
  -- supports POSIX character classes like [:alnum:].
  bare := (regexp_match(raw, '([-_.+%[:alnum:]]+@[-.[:alnum:]]+\.[[:alnum:]]+)'))[1];
  IF bare IS NOT NULL THEN
    RETURN lower(trim(bare));
  END IF;
  RETURN NULL;
END;
$$;

-- Same for the display name — the text before <...> when present,
-- with surrounding quotes stripped. Returns NULL for bare addresses.
CREATE OR REPLACE FUNCTION pg_temp_extract_name(raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  prefix text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Postgres regex: use [[:space:]] instead of \s for POSIX
  -- compatibility, and anchor with $ to match end of string.
  prefix := (regexp_match(raw, '^(.*?)<[^<>]+@[^<>[:space:]]+>[[:space:]]*$'))[1];
  IF prefix IS NULL THEN
    RETURN NULL;
  END IF;
  prefix := trim(prefix);
  IF length(prefix) = 0 THEN
    RETURN NULL;
  END IF;
  -- Strip surrounding " quotes.
  IF left(prefix, 1) = '"' AND right(prefix, 1) = '"' THEN
    prefix := substring(prefix from 2 for length(prefix) - 2);
    prefix := trim(prefix);
  END IF;
  IF length(prefix) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN prefix;
END;
$$;

-- Backfill from_email_normalized + from_name from from_address.
-- COALESCE on from_name so any row that already had a name
-- (set by the ingest path) keeps it; we only fill nulls.
UPDATE email_messages
SET
  from_email_normalized = pg_temp_extract_email(from_address),
  from_name             = COALESCE(from_name, pg_temp_extract_name(from_address));

-- Backfill to_emails_normalized — unnest the raw array, parse each
-- entry to an email, drop NULLs + dedupe, re-aggregate.
UPDATE email_messages em
SET to_emails_normalized = COALESCE(sub.arr, '{}')
FROM (
  SELECT
    em2.id,
    ARRAY(
      SELECT DISTINCT pg_temp_extract_email(raw)
      FROM unnest(em2.to_addresses) AS raw
      WHERE pg_temp_extract_email(raw) IS NOT NULL
    ) AS arr
  FROM email_messages em2
) sub
WHERE em.id = sub.id;

-- Same for cc.
UPDATE email_messages em
SET cc_emails_normalized = COALESCE(sub.arr, '{}')
FROM (
  SELECT
    em2.id,
    ARRAY(
      SELECT DISTINCT pg_temp_extract_email(raw)
      FROM unnest(em2.cc_addresses) AS raw
      WHERE pg_temp_extract_email(raw) IS NOT NULL
    ) AS arr
  FROM email_messages em2
) sub
WHERE em.id = sub.id;

-- Same for bcc.
UPDATE email_messages em
SET bcc_emails_normalized = COALESCE(sub.arr, '{}')
FROM (
  SELECT
    em2.id,
    ARRAY(
      SELECT DISTINCT pg_temp_extract_email(raw)
      FROM unnest(em2.bcc_addresses) AS raw
      WHERE pg_temp_extract_email(raw) IS NOT NULL
    ) AS arr
  FROM email_messages em2
) sub
WHERE em.id = sub.id;

-- Drop the one-shot helpers. They live in the default schema
-- (the pg_temp_ prefix is just naming convention; with the
-- underscore form Postgres treats them as regular functions in
-- whichever schema the migration runner is using). Dropping
-- explicitly keeps the public surface clean.
DROP FUNCTION IF EXISTS pg_temp_extract_email(text);
DROP FUNCTION IF EXISTS pg_temp_extract_name(text);

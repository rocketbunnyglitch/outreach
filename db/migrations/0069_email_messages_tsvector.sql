-- Phase B — Full-text search on email_messages.
--
-- Adds a tsvector column + GIN index + auto-updating trigger so
-- the inbox search bar can query message BODIES, not just
-- thread subjects/snippets.
--
-- Current state (pre-migration):
--   The inbox search uses ilike '%foo%' against
--   email_threads.subject + emailThreads.snippet + venues.name +
--   last_sender_name. Body content is NOT searchable. Operators
--   asking "did anyone mention X in a reply" have to scroll
--   manually.
--
-- After:
--   email_messages.search_tsv is a generated tsvector of
--   (subject || body_text || from_address). GIN-indexed. Inbox
--   search adds an EXISTS subquery against this column.
--
-- Storage cost: ~20% of body_text size on disk (gin index is
-- compact; tsvector itself is small). Negligible at typical
-- inbox volumes (10s of thousands of messages).
--
-- Backfill: STORED generated column on Postgres 12+ auto-fills
-- on existing rows AND every insert/update. No separate
-- backfill needed — Postgres re-evaluates the expression on
-- every row on the next read/write.
--
-- Index build time on a 50k-row table: ~30s. Run during low
-- traffic, or use CONCURRENTLY if the table is large.

-- Generated column. The 'english' config does stemming +
-- stopword removal; for cold outreach in english this is the
-- right choice. Subject gets weight A (most important), body
-- gets weight B, sender address gets weight C — so a hit in
-- the subject ranks higher than a hit in the body.
ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(subject, '')), 'A')
        ||
      setweight(to_tsvector('english', coalesce(body_text, '')), 'B')
        ||
      setweight(to_tsvector('english', coalesce(from_address, '')), 'C')
    ) STORED;

-- GIN index — the standard choice for tsvector. Faster lookups,
-- larger build, slightly slower inserts than GIST. For a
-- search-heavy / insert-moderate workload this is the right
-- pick.
CREATE INDEX IF NOT EXISTS email_messages_search_tsv_idx
  ON email_messages USING gin (search_tsv);

-- Also keep a btree on (thread_id, search_tsv) so the inbox
-- query can scope-then-search efficiently when the operator is
-- already filtered to a single thread. (Rare today; cheap
-- insurance.)
-- Postgres can't index a tsvector inside a multi-col btree,
-- so this is just a covering index on thread_id — the GIN
-- above handles the tsvector matching.
-- (Skipped — the existing email_messages_thread_sent_at_idx
-- already covers thread_id lookups.)

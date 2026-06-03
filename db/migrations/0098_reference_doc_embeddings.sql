-- =========================================================================
-- 0098_reference_doc_embeddings.sql
--
-- Semantic retrieval over the reference doc. Adds a pgvector embedding column
-- to reference_doc_sections so free-text retrieval can rank by cosine
-- similarity (OpenAI text-embedding-3-small, 1536-dim) in addition to the
-- existing Postgres full-text search over search_tsv.
--
-- This REVERSES the earlier "Anthropic-only, no embeddings" decision: an
-- OpenAI key was provided 2026-06-03 for embeddings. The loader fills the
-- column on load + backfills existing rows; retrieval falls back to FTS when
-- a section has no embedding yet, so this is safe to apply before backfill.
--
-- No ANN (ivfflat) index: the doc has ~140 sections, so an exact cosine seq
-- scan is sub-millisecond and avoids ivfflat's poor recall at tiny row counts.
-- Add an ivfflat index (lists ~= rows/1000) if section volume grows large.
--
-- Schema mirror: db/schema/reference-docs.ts (column is raw-SQL accessed, like
-- search_tsv -- the ORM does not model the vector type).
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE reference_doc_sections
  ADD COLUMN embedding vector(1536);

-- =========================================================================
-- 0091_reference_docs.sql
--
-- Storage for canonical reference documents (the Halloween 2026 international
-- outreach reference, and any future docs) plus their parsed sections and
-- semantic embeddings.
--
-- The loader (scripts/load-reference-doc.ts, Phase 0.3) parses the markdown,
-- embeds each section, and persists here. The AI retrieval helper
-- (lib/reference-retrieval.ts, Phase 0.4) reads from here at runtime.
--
-- Requires pgvector for the embedding column + cosine-similarity index.
--
-- Schema mirror: db/schema/reference-docs.ts. If you change one, update both.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE reference_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_slug TEXT NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  version INT NOT NULL,
  full_markdown TEXT NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_hash TEXT NOT NULL,  -- sha256 of the .md file content; detect drift
  UNIQUE(doc_slug, version)
);

CREATE INDEX reference_docs_slug_version_idx ON reference_docs(doc_slug, version DESC);

CREATE TABLE reference_doc_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_doc_id UUID NOT NULL REFERENCES reference_docs(id) ON DELETE CASCADE,
  section_code TEXT NOT NULL,
  section_title TEXT NOT NULL,
  section_body TEXT NOT NULL,
  section_level INT NOT NULL,  -- 1 for ##, 2 for ###, 3 for ####
  parent_section_code TEXT,    -- '7.13.9' has parent '7.13'
  section_order INT NOT NULL,  -- preserves doc order for navigation
  embedding vector(1536),       -- nullable; populated by loader
  tags TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE(reference_doc_id, section_code)
);

CREATE INDEX rds_doc_id_idx ON reference_doc_sections(reference_doc_id);
CREATE INDEX rds_section_code_idx ON reference_doc_sections(section_code);
CREATE INDEX rds_embedding_cosine_idx ON reference_doc_sections
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX rds_tags_gin_idx ON reference_doc_sections USING gin (tags);

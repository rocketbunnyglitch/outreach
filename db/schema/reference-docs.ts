/**
 * reference_docs + reference_doc_sections -- storage for canonical reference
 * documents and their parsed sections. The loader script
 * (scripts/load-reference-doc.ts, Phase 0.3) writes here; the AI retrieval
 * helper (lib/reference-retrieval.ts, Phase 0.4) reads from here.
 *
 * See db/migrations/0091_reference_docs.sql for column semantics + indexes.
 * The schema here mirrors the migration; if you change one update both.
 *
 * Retrieval is curated-first with Postgres full-text search (the generated
 * search_tsv column) as the free-text fallback. The engine is Anthropic-only
 * with no embeddings provider, so there is intentionally no vector column.
 * search_tsv is a generated column the ORM never writes, so it is not modeled
 * here; full-text queries use raw SQL against it.
 */

import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

export const referenceDocs = pgTable(
  "reference_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docSlug: text("doc_slug").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "cascade",
    }),
    version: integer("version").notNull(),
    fullMarkdown: text("full_markdown").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
    fileHash: text("file_hash").notNull(),
  },
  (table) => ({
    slugVersionUnique: unique("reference_docs_doc_slug_version_key").on(
      table.docSlug,
      table.version,
    ),
    slugVersionIdx: index("reference_docs_slug_version_idx").on(
      table.docSlug,
      table.version.desc(),
    ),
  }),
);

export const referenceDocSections = pgTable(
  "reference_doc_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceDocId: uuid("reference_doc_id")
      .notNull()
      .references(() => referenceDocs.id, { onDelete: "cascade" }),
    sectionCode: text("section_code").notNull(),
    sectionTitle: text("section_title").notNull(),
    sectionBody: text("section_body").notNull(),
    sectionLevel: integer("section_level").notNull(),
    parentSectionCode: text("parent_section_code"),
    sectionOrder: integer("section_order").notNull(),
    tags: text("tags").array().notNull().default([]),
  },
  (table) => ({
    docIdIdx: index("rds_doc_id_idx").on(table.referenceDocId),
    sectionCodeIdx: index("rds_section_code_idx").on(table.sectionCode),
    docSectionUnique: unique("reference_doc_sections_doc_section_key").on(
      table.referenceDocId,
      table.sectionCode,
    ),
  }),
);

export type ReferenceDoc = typeof referenceDocs.$inferSelect;
export type NewReferenceDoc = typeof referenceDocs.$inferInsert;
export type ReferenceDocSection = typeof referenceDocSections.$inferSelect;
export type NewReferenceDocSection = typeof referenceDocSections.$inferInsert;

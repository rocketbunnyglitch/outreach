/**
 * AI retrieval helper -- the runtime interface between the engine's AI code
 * paths and the canonical reference doc (Phase 0.4).
 *
 * Retrieval is curated-first: each task maps to an explicit, dependency-ordered
 * list of section codes (lib/reference-retrieval-task-map.ts). When a free-text
 * query is supplied, curated sections are topped up by SEMANTIC search (OpenAI
 * text-embedding-3-small cosine over the pgvector `embedding` column), then by
 * Postgres full-text search (search_tsv) as a fallback.
 *
 * Embeddings are an enhancement, not a hard dependency: when no OpenAI key is
 * configured, or a section has no embedding yet, retrieval degrades cleanly to
 * FTS. (Embeddings enabled 2026-06-03 after an OpenAI key was provided.)
 */

import "server-only";
import { referenceDocSections, referenceDocs } from "@/db/schema/reference-docs";
import { db } from "@/lib/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { embedText, isEmbeddingsConfigured, toVectorLiteral } from "./embeddings";
import { type RetrievedSection, formatAsSystemPrompt } from "./reference-retrieval-format";
import { type ReferenceTask, TASK_TO_SECTIONS } from "./reference-retrieval-task-map";

export type { ReferenceTask, RetrievedSection };
export { formatAsSystemPrompt, TASK_TO_SECTIONS };

const DEFAULT_DOC_SLUG = "halloween-2026-intl";
const DEFAULT_TOP_K = 3;

export interface RetrieveArgs {
  task: ReferenceTask;
  docSlug?: string; // defaults to the active campaign's doc
  query?: string; // free-text for full-text search; falls back to curated list
  topK?: number; // default 3
  campaignId?: string;
}

async function latestDocId(slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: referenceDocs.id })
    .from(referenceDocs)
    .where(eq(referenceDocs.docSlug, slug))
    .orderBy(desc(referenceDocs.version))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Fetch the reference-doc sections relevant to a task. Returns at most topK
 * sections; an empty array when no doc is loaded for the slug.
 */
export async function retrieveRelevantSections(args: RetrieveArgs): Promise<RetrievedSection[]> {
  const slug = args.docSlug ?? DEFAULT_DOC_SLUG;
  const topK = args.topK ?? DEFAULT_TOP_K;
  const query = args.query?.trim();

  const docId = await latestDocId(slug);
  if (!docId) return [];

  const curatedCodes = TASK_TO_SECTIONS[args.task] ?? [];

  // Curated-first: load the task's sections, preserving the map's dependency
  // order (not doc order) so the most load-bearing section leads.
  const curated: RetrievedSection[] = [];
  if (curatedCodes.length > 0) {
    const rows = await db
      .select()
      .from(referenceDocSections)
      .where(
        and(
          eq(referenceDocSections.referenceDocId, docId),
          inArray(referenceDocSections.sectionCode, curatedCodes),
        ),
      );
    const byCode = new Map(rows.map((r) => [r.sectionCode, r]));
    for (const code of curatedCodes) {
      const r = byCode.get(code);
      if (r) {
        curated.push({
          sectionCode: r.sectionCode,
          sectionTitle: r.sectionTitle,
          body: r.sectionBody,
          score: 1,
        });
      }
    }
  }

  // No free-text query: curated only, truncated to topK.
  if (!query) return curated.slice(0, topK);

  // Hybrid: curated first, then semantic (embeddings), then FTS, until topK.
  const result = [...curated];
  const seen = new Set(result.map((s) => s.sectionCode));

  const pushRows = (
    rows: Array<{
      section_code: string;
      section_title: string;
      section_body: string;
      score: number;
    }>,
  ) => {
    for (const row of rows) {
      if (result.length >= topK) break;
      if (seen.has(row.section_code)) continue;
      seen.add(row.section_code);
      result.push({
        sectionCode: row.section_code,
        sectionTitle: row.section_title,
        body: row.section_body,
        score: Number(row.score),
      });
    }
  };

  // Semantic top-up: embed the query, rank by pgvector cosine similarity.
  if (result.length < topK && isEmbeddingsConfigured()) {
    const vec = await embedText(query);
    if (vec) {
      const literal = toVectorLiteral(vec);
      const sem = await db.execute(sql`
        SELECT section_code, section_title, section_body,
               1 - (embedding <=> ${literal}::vector) AS score
        FROM reference_doc_sections
        WHERE reference_doc_id = ${docId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${topK}
      `);
      pushRows(
        sem.rows as Array<{
          section_code: string;
          section_title: string;
          section_body: string;
          score: number;
        }>,
      );
    }
  }

  // FTS fallback/top-up (also the only path when embeddings are unconfigured).
  if (result.length < topK) {
    const fts = await db.execute(sql`
      SELECT section_code, section_title, section_body,
             ts_rank(search_tsv, websearch_to_tsquery('english', ${query})) AS score
      FROM reference_doc_sections
      WHERE reference_doc_id = ${docId}
        AND search_tsv @@ websearch_to_tsquery('english', ${query})
      ORDER BY score DESC
      LIMIT ${topK}
    `);
    pushRows(
      fts.rows as Array<{
        section_code: string;
        section_title: string;
        section_body: string;
        score: number;
      }>,
    );
  }

  return result.slice(0, topK);
}

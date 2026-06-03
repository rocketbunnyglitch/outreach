/**
 * Usage:
 *   npx tsx scripts/load-reference-doc.ts --slug halloween-2026-intl
 *   npx tsx scripts/load-reference-doc.ts --slug halloween-2026-intl --campaign-id <uuid>
 *
 * Reads lib/reference-docs/<slug>-engine-reference.md, parses it into sections,
 * computes retrieval tags, and persists to reference_docs +
 * reference_doc_sections.
 *
 * Semantic retrieval uses Postgres full-text search (the generated search_tsv
 * column) plus Claude Haiku for the rare free-text query, so this loader does
 * NOT generate vector embeddings -- the engine is Anthropic-only and has no
 * embeddings provider. (Decided 2026-06-03.)
 *
 * Idempotent: if the file hash matches the latest loaded version, this is a
 * no-op. If the hash differs (or nothing is loaded yet) it inserts a new
 * version and reloads all sections.
 *
 * Connects with its own pg Pool from DATABASE_URL (not lib/db) so it stays
 * decoupled from the app env and is runnable against a scratch DB.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { referenceDocSections, referenceDocs } from "../db/schema/reference-docs";

interface ParsedSection {
  sectionCode: string;
  sectionTitle: string;
  sectionBody: string;
  sectionLevel: number;
  parentSectionCode: string | null;
  sectionOrder: number;
  tags: string[];
}

// [ReferenceDoc Phase 0.3] curated tag keyword map for retrieval filtering.
const TAG_KEYWORDS: Record<string, string[]> = {
  cadence: ["cadence", "follow-up", "follow up", "touch 1", "touch 2", "touch 3"],
  classification: ["classify", "classification", "engaged", "soft no", "hard no"],
  turnout: ["turnout", "guest count", "wave qualifier"],
  host: ["host", "h0a", "h0b", "h1", "external host", "internal host"],
  cancellation: ["cancel", "cancelled", "cancellation"],
  template: ["template", "t1", "t9", "t17"],
  compliance: ["compliance", "low buy-in", "gdpr", "casl"],
  "operator-ux": ["operator", "worklist", "draft", "queue"],
  integration: ["smart map", "eventbrite", "twilio", "sms"],
};

function extractTags(haystackLower: string): string[] {
  const tags: string[] = [];
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => haystackLower.includes(kw))) tags.push(tag);
  }
  return tags;
}

// "## 0. Foundational principles" / "### 7.13.9 Host briefing" / "#### The rule".
const HEADER_RE = /^(#{2,4})\s+(.*\S)\s*$/;
// Leading numeric-dotted code (e.g. "0", "7.13.9"), optional trailing period.
const CODE_RE = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/;

// Parent code: numeric multi-segment strips the last ".N" (per the spec);
// top-level numeric (## sections 0-12) has no parent; code-less synthetic
// headers fall back to their nearest ancestor on the header stack.
function deriveParent(code: string, stackParent: string | null): string | null {
  if (/^\d+(\.\d+)+$/.test(code)) return code.replace(/\.\d+$/, "");
  if (/^\d+$/.test(code)) return null;
  return stackParent;
}

function parseMarkdown(markdown: string): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  const stack: { level: number; code: string }[] = [];
  let current: { meta: ParsedSection; bodyLines: string[] } | null = null;
  let order = 0;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    current.meta.sectionBody = current.bodyLines.join("\n").trim();
    const hay = `${current.meta.sectionTitle}\n${current.meta.sectionBody}`.toLowerCase();
    current.meta.tags = extractTags(hay);
    sections.push(current.meta);
    current = null;
  };

  for (const line of lines) {
    // Never treat fenced code-block content as headers.
    if (/^```/.test(line)) {
      inFence = !inFence;
      if (current) current.bodyLines.push(line);
      continue;
    }
    const h = inFence ? null : HEADER_RE.exec(line);
    if (!h) {
      if (current) current.bodyLines.push(line);
      continue;
    }
    flush();
    const level = (h[1] ?? "").length - 1; // ## -> 1, ### -> 2, #### -> 3
    const headerText = (h[2] ?? "").trim();
    const m = CODE_RE.exec(headerText);
    let code: string;
    let title: string;
    if (m) {
      code = m[1] ?? "";
      title = (m[2] ?? "").trim();
    } else {
      const ancestorTop = stack.length > 0 ? stack[stack.length - 1] : undefined;
      const ancestor = ancestorTop?.code ?? "_root";
      const titleSlug = headerText
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      code = `${ancestor}:${titleSlug}`;
      title = headerText;
    }
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? -1) >= level) {
      stack.pop();
    }
    const parentTop = stack.length > 0 ? stack[stack.length - 1] : undefined;
    const parentCode = deriveParent(code, parentTop?.code ?? null);
    stack.push({ level, code });

    order += 1;
    current = {
      meta: {
        sectionCode: code,
        sectionTitle: title,
        sectionBody: "",
        sectionLevel: level,
        parentSectionCode: parentCode,
        sectionOrder: order,
        tags: [],
      },
      bodyLines: [],
    };
  }
  flush();
  return sections;
}

// The canonical doc duplicates sections 0.7 and 0.8; keep the first occurrence
// so the UNIQUE(reference_doc_id, section_code) constraint holds.
function dedupeByCode(sections: ParsedSection[]): ParsedSection[] {
  const seen = new Set<string>();
  const out: ParsedSection[] = [];
  for (const s of sections) {
    if (seen.has(s.sectionCode)) {
      console.warn(`[loader] duplicate section_code ${s.sectionCode}; keeping first occurrence`);
      continue;
    }
    seen.add(s.sectionCode);
    out.push(s);
  }
  return out;
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = argValue(args, "--slug");
  const campaignId = argValue(args, "--campaign-id") ?? null;
  if (!slug) {
    console.error("Missing required --slug <doc-slug>");
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const filePath = join(process.cwd(), "lib", "reference-docs", `${slug}-engine-reference.md`);
  const markdown = readFileSync(filePath, "utf8");
  const fileHash = createHash("sha256").update(markdown).digest("hex");

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  try {
    const latest = await db
      .select()
      .from(referenceDocs)
      .where(eq(referenceDocs.docSlug, slug))
      .orderBy(desc(referenceDocs.version))
      .limit(1);

    const latestRow = latest[0];
    if (latestRow && latestRow.fileHash === fileHash) {
      console.log(
        `[loader] no changes (hash ${fileHash.slice(0, 8)}, version ${latestRow.version}); nothing to do`,
      );
      return;
    }

    const nextVersion = latestRow ? latestRow.version + 1 : 1;
    const parsed = dedupeByCode(parseMarkdown(markdown));
    console.log(`[loader] parsed ${parsed.length} sections; inserting version ${nextVersion}`);

    const [doc] = await db
      .insert(referenceDocs)
      .values({
        docSlug: slug,
        campaignId,
        version: nextVersion,
        fullMarkdown: markdown,
        fileHash,
      })
      .returning();
    if (!doc) throw new Error("failed to insert reference_docs row");

    await db.insert(referenceDocSections).values(
      parsed.map((s) => ({
        referenceDocId: doc.id,
        sectionCode: s.sectionCode,
        sectionTitle: s.sectionTitle,
        sectionBody: s.sectionBody,
        sectionLevel: s.sectionLevel,
        parentSectionCode: s.parentSectionCode,
        sectionOrder: s.sectionOrder,
        tags: s.tags,
      })),
    );

    const tagged = parsed.filter((s) => s.tags.length > 0).length;
    const pct = Math.round((tagged / parsed.length) * 100);
    console.log(
      `[loader] loaded slug=${slug} version=${nextVersion}: ${parsed.length} sections, ${tagged} tagged (${pct}%)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

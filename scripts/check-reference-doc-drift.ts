/**
 * Reference-doc drift check (Phase 0.6).
 *
 * For each lib/reference-docs/<slug>-engine-reference.md, compares the file's
 * sha256 against the latest loaded version's file_hash in the DB. Exits
 * non-zero if a loaded doc has changed without a reload, so the pre-commit
 * hook can block the commit.
 *
 * Degrades gracefully: when DATABASE_URL is unset, the DB is unreachable, or
 * the reference_docs table does not exist yet, it skips (exit 0) -- the deploy
 * loader is the safety net, so a DB-less commit environment is never blocked.
 * A not-yet-loaded doc is a warning, not a block; only an actual hash mismatch
 * (a real edit-without-reload) blocks.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { Pool } from "pg";

const DIR = join(process.cwd(), "lib", "reference-docs");

function slugFromFilename(name: string): string | null {
  const m = /^(.+)-engine-reference\.md$/.exec(name);
  return m?.[1] ?? null;
}

async function main() {
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith("-engine-reference.md"));
  } catch {
    return; // no reference-docs dir; nothing to check
  }
  if (files.length === 0) return;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[drift-check] DATABASE_URL not set; skipping (deploy loads on deploy).");
    return;
  }

  const pool = new Pool({ connectionString: dbUrl });
  let drift = false;
  try {
    const exists = await pool.query("SELECT to_regclass('public.reference_docs') AS t");
    if (!exists.rows[0]?.t) {
      console.log("[drift-check] reference_docs table not present yet; skipping.");
      return;
    }
    for (const file of files) {
      const slug = slugFromFilename(file);
      if (!slug) continue;
      const md = readFileSync(join(DIR, file), "utf8");
      const hash = createHash("sha256").update(md).digest("hex");
      const r = await pool.query(
        "SELECT file_hash FROM reference_docs WHERE doc_slug=$1 ORDER BY version DESC LIMIT 1",
        [slug],
      );
      const dbHash: string | undefined = r.rows[0]?.file_hash;
      if (!dbHash) {
        console.warn(`[drift-check] ${file}: not loaded yet (slug ${slug}); deploy will load it.`);
      } else if (dbHash !== hash) {
        console.error(
          `[drift-check] ${file}: DB hash ${dbHash.slice(0, 8)} != file ${hash.slice(0, 8)} -- doc changed without a reload.`,
        );
        drift = true;
      }
    }
  } catch (err) {
    console.log(`[drift-check] DB check skipped (${(err as Error).message}).`);
    await pool.end().catch(() => {});
    return;
  }
  await pool.end();

  if (drift) {
    console.error("[drift-check] Run: npm run reference-docs:load");
    process.exit(1);
  }
  console.log("[drift-check] reference docs in sync.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * One-off cleanup: venues.email holding spreadsheet-era garbage
 * (status notes, multi-address blobs, annotated addresses).
 *
 * For every non-archived venue whose email fails the single-address
 * shape: extract real addresses; first → email (or NULL if none),
 * the rest → alternate_emails (union, deduped), leftover human text →
 * prepended to internal_notes with provenance. Nothing is destroyed.
 *
 *   npx tsx scripts/cleanup-venue-emails.ts          # dry run
 *   npx tsx scripts/cleanup-venue-emails.ts --apply  # write
 */
import { Pool } from "pg";
import { SINGLE_EMAIL_RE, extractEmails } from "../lib/email-normalize";

const apply = process.argv.includes("--apply");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      email: string;
      alternate_emails: string[] | null;
    }>(
      `SELECT id, name, email, alternate_emails FROM venues
       WHERE archived_at IS NULL AND email IS NOT NULL
       ORDER BY name`,
    );
    let touched = 0;
    for (const v of rows) {
      if (SINGLE_EMAIL_RE.test(v.email.trim())) {
        // Clean except possibly case/whitespace — normalize those silently.
        const norm = v.email.trim().toLowerCase();
        if (norm !== v.email) {
          touched++;
          console.info(`[trim] ${v.name}: "${v.email}" -> "${norm}"`);
          if (apply) {
            await pool.query(
              "UPDATE venues SET email = $1, updated_at = now(), version = version + 1 WHERE id = $2",
              [norm, v.id],
            );
          }
        }
        continue;
      }
      const { emails, residue } = extractEmails(v.email);
      const primary = emails[0] ?? null;
      const extras = emails.slice(1);
      const altUnion = Array.from(new Set([...(v.alternate_emails ?? []), ...extras]));
      touched++;
      const extraBit = extras.length ? ` alt+=${extras.join(",")}` : "";
      const noteBit = residue ? ` note="${residue}"` : "";
      console.info(
        `[fix] ${v.name}: "${v.email.replace(/\n/g, "\\n")}" -> email=${primary ?? "NULL"}${extraBit}${noteBit}`,
      );
      if (apply) {
        await pool.query(
          `UPDATE venues SET
             email = $1,
             alternate_emails = $2,
             internal_notes = CASE WHEN $3::text IS NULL THEN internal_notes
               ELSE '[from email field] ' || $3 ||
                    CASE WHEN internal_notes IS NULL OR internal_notes = '' THEN ''
                         ELSE E'\n' || internal_notes END
             END,
             updated_at = now(), version = version + 1
           WHERE id = $4`,
          [primary, altUnion, residue, v.id],
        );
      }
    }
    console.info(`\n${apply ? "updated" : "would update"} ${touched} venues`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

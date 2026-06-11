/**
 * Email-field normalization for venue contact data.
 *
 * The spreadsheet era used the email column as a free-text status field:
 * "email sent", "left vm", "drew@x.com;kelly@x.com", "events@x.com - gm liz",
 * "marketing@ fat-tuesday.com". 209 venues imported with that garbage in
 * venues.email, silently breaking every consumer that assumes one clean
 * address (validation lookups, suppression matching, thread retro-linking,
 * the duplicate checker's lower(email) grouping).
 *
 * Pure module — safe to import from import paths, scripts, and tests.
 */

const EMAIL_TOKEN_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Strict single-address shape — what venues.email is allowed to hold. */
export const SINGLE_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export interface ExtractedEmails {
  /** Deduped, lowercased addresses in order of appearance. */
  emails: string[];
  /** Leftover human text after removing addresses + separators; null if none. */
  residue: string | null;
}

/**
 * Pull every email address out of a raw field value.
 * Repairs the common "name@ domain.com" typo (space after @) before
 * tokenizing. Residue keeps operator notes ("gm liz", "left vm") so a
 * cleanup can move them to internal_notes instead of destroying them.
 */
export function extractEmails(raw: string | null | undefined): ExtractedEmails {
  if (!raw) return { emails: [], residue: null };
  // "marketing@ fat-tuesday.com" → "marketing@fat-tuesday.com"
  const repaired = raw.replace(/@\s+(?=[A-Za-z0-9-]+\.)/g, "@");
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const m of repaired.match(EMAIL_TOKEN_RE) ?? []) {
    const e = m.toLowerCase();
    if (!seen.has(e)) {
      seen.add(e);
      emails.push(e);
    }
  }
  const residue = repaired
    .replace(EMAIL_TOKEN_RE, " ")
    .replace(/[;,/]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
  return { emails, residue: residue.length > 0 ? residue : null };
}

/**
 * Normalize a raw value into something venues.email can hold:
 * the first valid address, or null when the value is pure status text.
 * Import paths use this so sheet garbage never lands in the column again.
 */
export function normalizeVenueEmail(raw: string | null | undefined): string | null {
  return extractEmails(raw).emails[0] ?? null;
}

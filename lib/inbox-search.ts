/**
 * Gmail-style search operator parser.
 *
 * Splits a raw query string into structured operators + a residual
 * free-text portion. Operators consume the trailing colon-delimited
 * token (or quoted phrase) and disappear from the free-text result.
 *
 * Supported operators (case-insensitive on the key):
 *
 *   from:NAME           subject:WORDS       has:attachment
 *   to:NAME             label:NAME          is:unread
 *                                            is:starred
 *                                            is:snoozed
 *                                            is:trashed
 *   before:YYYY-MM-DD   after:YYYY-MM-DD
 *
 * Engine-specific extras (don't exist in Gmail; useful for outreach):
 *
 *   campaign:UUID       brand:UUID          venue:UUID
 *   assigned:USERID
 *
 * Examples:
 *
 *   "from:sarah invoice"
 *     → { from: "sarah", freeText: "invoice" }
 *
 *   "is:unread has:attachment Q3 report"
 *     → { isUnread: true, hasAttachment: true, freeText: "Q3 report" }
 *
 *   "subject:\"Q3 report\" from:sarah"
 *     → { subject: "Q3 report", from: "sarah" }
 *
 *   "after:2026-01-01 before:2026-02-01"
 *     → { after: "2026-01-01", before: "2026-02-01" }
 *
 * The parser is intentionally permissive — unknown keys (e.g.
 * "size:large") fall back into the freeText since they're meaningless
 * to us. This way operators can type freely without errors.
 */

export interface ParsedSearchQuery {
  from?: string;
  to?: string;
  subject?: string;
  label?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  isSnoozed?: boolean;
  isTrashed?: boolean;
  before?: string; // YYYY-MM-DD
  after?: string;
  /** Engine-specific. */
  campaignId?: string;
  brandId?: string;
  venueId?: string;
  assignedStaffId?: string;
  /** Everything that didn't match an operator; trimmed. */
  freeText?: string;
}

/**
 * Operators known to the parser. Anything else gets treated as
 * free text — we don't want a typo'd "froM:" to silently swallow
 * input.
 */
const KNOWN_KEYS = new Set([
  "from",
  "to",
  "subject",
  "label",
  "has",
  "is",
  "before",
  "after",
  "campaign",
  "brand",
  "venue",
  "assigned",
]);

/** Roughly UUID-shaped. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** YYYY-MM-DD only (parser refuses anything weirder). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSearchQuery(raw: string | null | undefined): ParsedSearchQuery {
  const out: ParsedSearchQuery = {};
  if (!raw) return out;
  const tokens = tokenize(raw);
  const free: string[] = [];

  for (const tok of tokens) {
    const colon = tok.indexOf(":");
    if (colon === -1) {
      free.push(tok);
      continue;
    }
    const key = tok.slice(0, colon).toLowerCase();
    const value = tok.slice(colon + 1);
    if (!KNOWN_KEYS.has(key) || value === "") {
      free.push(tok);
      continue;
    }
    applyOperator(out, key, value, free);
  }

  const text = free.join(" ").trim();
  if (text) out.freeText = text;
  return out;
}

function applyOperator(out: ParsedSearchQuery, key: string, value: string, free: string[]): void {
  switch (key) {
    case "from":
      out.from = stripQuotes(value);
      return;
    case "to":
      out.to = stripQuotes(value);
      return;
    case "subject":
      out.subject = stripQuotes(value);
      return;
    case "label":
      out.label = stripQuotes(value);
      return;
    case "has":
      if (value === "attachment" || value === "attachments") {
        out.hasAttachment = true;
        return;
      }
      free.push(`${key}:${value}`);
      return;
    case "is":
      switch (value.toLowerCase()) {
        case "unread":
          out.isUnread = true;
          return;
        case "starred":
        case "star":
          out.isStarred = true;
          return;
        case "snoozed":
          out.isSnoozed = true;
          return;
        case "trashed":
        case "trash":
          out.isTrashed = true;
          return;
        default:
          free.push(`${key}:${value}`);
          return;
      }
    case "before":
      if (ISO_DATE_RE.test(value)) out.before = value;
      else free.push(`${key}:${value}`);
      return;
    case "after":
      if (ISO_DATE_RE.test(value)) out.after = value;
      else free.push(`${key}:${value}`);
      return;
    case "campaign":
      if (UUID_RE.test(value)) out.campaignId = value;
      else free.push(`${key}:${value}`);
      return;
    case "brand":
      if (UUID_RE.test(value)) out.brandId = value;
      else free.push(`${key}:${value}`);
      return;
    case "venue":
      if (UUID_RE.test(value)) out.venueId = value;
      else free.push(`${key}:${value}`);
      return;
    case "assigned":
      if (UUID_RE.test(value)) out.assignedStaffId = value;
      else free.push(`${key}:${value}`);
      return;
  }
}

/**
 * Token splitter that honors quoted phrases. "from:\"Sarah Lee\""
 * → ['from:"Sarah Lee"'], not three tokens. Quotes inside an
 * operator value are stripped by stripQuotes().
 */
function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of raw.trim()) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1);
  }
  return s;
}

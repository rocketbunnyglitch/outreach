/**
 * RFC 5322-style email address parsing.
 *
 * Why this exists
 * ---------------
 *
 * Gmail stores message addresses as raw header values:
 *
 *   from: 'Mike Smith <info@lavelle.com>'
 *   to:   'Bryle <bryle@brand.com>, JC <jc@brand.com>'
 *   cc:   '"VC, ALL" <vc-all@firm.com>'
 *
 * Before this module existed, the engine matched venues + ran
 * duplicate-prevention by comparing those raw strings to clean
 * email addresses stored on venues / contacts. The result:
 *
 *   raw header     : 'Mike <info@lavelle.com>'
 *   venue email    : 'info@lavelle.com'
 *   match query    : lower(from_address) = 'info@lavelle.com'
 *   match result   : FALSE  (the raw header doesn't equal the clean address)
 *
 * Every venue communication timeline was missing every email
 * whose From had a display name (which is most of them).
 *
 * What the parsing rules are
 * --------------------------
 *
 * - Accept either bare `addr@host` or quoted `Display Name <addr@host>`.
 * - Comma-separated lists fall apart on commas — EXCEPT commas
 *   inside a "quoted display name" because some senders use them.
 * - The address portion is lowercased + trimmed.
 * - The display name (if any) is preserved separately for the UI;
 *   the normalized address is what matching + duplicate-detection
 *   use.
 *
 * What's INTENTIONALLY out of scope
 * ---------------------------------
 *
 * - Unicode / IDN domains: real-world Gmail headers ascii-encode
 *   these via Punycode before they reach our ingest; we round-trip
 *   them as-is.
 * - Internationalized local parts (UTF-8 mailbox names) — Gmail
 *   handles these for us at the MIME layer.
 * - Group syntax (`engineering: a@x.com, b@x.com;`) — Gmail's
 *   To/Cc headers don't emit this; if a sender uses it the
 *   address inside is still captured by the bare-addr fallback.
 * - Comments in addresses — extremely rare, we strip them
 *   silently if they appear.
 */

export interface ParsedAddress {
  /** Normalized lowercase address ('info@venue.com'). null when
   *  the input couldn't be parsed as an email. */
  email: string | null;
  /** Display name from `"Name" <addr>` form, if any. Trimmed,
   *  unquoted. null when the input is a bare address. */
  name: string | null;
}

/**
 * Parse a single From-style header value.
 *
 * Examples
 * --------
 *
 *   parseEmailHeader('Mike Smith <info@venue.com>')
 *     → { email: 'info@venue.com', name: 'Mike Smith' }
 *
 *   parseEmailHeader('info@venue.com')
 *     → { email: 'info@venue.com', name: null }
 *
 *   parseEmailHeader('"VC, ALL" <vc-all@firm.com>')
 *     → { email: 'vc-all@firm.com', name: 'VC, ALL' }
 *
 *   parseEmailHeader('Mike <INFO@Venue.com>')
 *     → { email: 'info@venue.com', name: 'Mike' }       (lowercased)
 *
 *   parseEmailHeader('not an email')
 *     → { email: null, name: null }
 *
 *   parseEmailHeader('')
 *     → { email: null, name: null }
 */
export function parseEmailHeader(input: string | null | undefined): ParsedAddress {
  if (!input) return { email: null, name: null };
  const trimmed = String(input).trim();
  if (!trimmed) return { email: null, name: null };

  // Form 1: '"Display, Name" <addr@host>' OR 'Name <addr@host>'.
  // We match the LAST '<...>' so that a display name accidentally
  // containing '<' doesn't break parsing.
  const angled = trimmed.match(/^(.*?)<([^<>]+@[^<>\s]+)>\s*$/);
  if (angled) {
    let name: string | null = (angled[1] ?? "").trim();
    // Strip surrounding quotes if present. Operators occasionally
    // see headers like '"Mike" <mike@x.com>'; the visual name is
    // "Mike", not '"Mike"'.
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).trim();
    }
    if (name.length === 0) name = null;
    const email = isLikelyEmail(angled[2] ?? "") ? (angled[2] ?? "").toLowerCase() : null;
    return { email, name };
  }

  // Form 2: bare 'addr@host'. Pluck the first email-shaped token in
  // the string — this also catches headers like 'addr@host (Comment)'.
  const bare = trimmed.match(/([\w!#$%&'*+/=?^`{|}~.\-]+@[\w.\-]+)/);
  if (bare) {
    const email = isLikelyEmail(bare[1] ?? "") ? (bare[1] ?? "").toLowerCase() : null;
    return { email, name: null };
  }

  return { email: null, name: null };
}

/**
 * Parse a To/Cc/Bcc-style header value that may carry multiple
 * addresses. Commas inside quoted display names are preserved.
 *
 * Returns the list of normalized email addresses (one per recipient,
 * lowercased, deduped, with malformed entries dropped silently).
 *
 *   parseEmailList('Mike <a@x.com>, Bryle <b@y.com>')
 *     → ['a@x.com', 'b@y.com']
 *
 *   parseEmailList('"Last, First" <a@x.com>, plain@y.com')
 *     → ['a@x.com', 'plain@y.com']
 *
 *   parseEmailList('a@x.com, A@X.COM, junk')
 *     → ['a@x.com']                              (lowercased + deduped)
 *
 *   parseEmailList(null)
 *     → []
 */
export function parseEmailList(input: string | null | undefined): string[] {
  if (!input) return [];
  const s = String(input);
  // Split on commas that are NOT inside a quoted string. A simple
  // state-machine pass beats a regex with backreferences for clarity.
  const parts: string[] = [];
  let depth = 0; // angle bracket depth
  let inQuote = false; // inside a "..."
  let buf = "";
  for (const ch of s) {
    if (ch === '"' && depth === 0) {
      inQuote = !inQuote;
      buf += ch;
      continue;
    }
    if (!inQuote) {
      if (ch === "<") depth++;
      else if (ch === ">") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0) {
        parts.push(buf);
        buf = "";
        continue;
      }
    }
    buf += ch;
  }
  if (buf.length > 0) parts.push(buf);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const parsed = parseEmailHeader(part);
    if (parsed.email && !seen.has(parsed.email)) {
      seen.add(parsed.email);
      out.push(parsed.email);
    }
  }
  return out;
}

/**
 * Same as parseEmailHeader but returns just the email (or null).
 * Drop-in replacement for the two inline extractEmail helpers that
 * previously lived in inbox/_actions.ts and inbox/_attach-venue-action.ts.
 */
export function extractEmailAddress(input: string | null | undefined): string | null {
  return parseEmailHeader(input).email;
}

/**
 * Internal: shallow shape check. We accept anything with @ + a
 * dotted host. Real validation belongs at compose time (the EMAIL_RE
 * in compose-send-impl); this is the "is this an address at all?"
 * filter applied during parsing.
 */
function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

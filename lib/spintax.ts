/**
 * Spintax — {a|b|c} message variation for cold outreach.
 *
 * Sending byte-identical text to thousands of inboxes is itself a spam signal:
 * filters fingerprint repeated bodies. Spintax lets a template carry
 * alternatives -- "{Hi|Hey|Hello} {{name}}" -- and the send path expands ONE
 * per send, so no two cold emails are identical.
 *
 * Pure + dependency-free. Supports nesting: "{a|b {c|d}}". Only groups that
 * contain a pipe are treated as spintax, so {{merge_field}} (whose innermost
 * group {field} has no pipe) and any other single-brace literal are left
 * completely intact.
 */

/** Deterministic PRNG (mulberry32) so body + bodyHtml expand identically. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Innermost group (no nested braces) containing a pipe. Never matches a
// pipe-less group, so {{merge}} fields are safe.
const GROUP_WITH_PIPE = /\{([^{}]*\|[^{}]*)\}/;

/** True if the text contains at least one {a|b} alternation group. */
export function hasSpintax(text: string): boolean {
  if (!text) return false;
  return GROUP_WITH_PIPE.test(text);
}

/**
 * Expand spintax. Resolves innermost {a|b} groups first, repeatedly, until none
 * remain. rng() returns [0,1). Leaves {{merge}} fields + brace-less text alone.
 */
export function expandSpintax(text: string, rng: () => number = Math.random): string {
  if (!hasSpintax(text)) return text;
  let out = text;
  let guard = 0;
  while (guard++ < 5000) {
    const m = GROUP_WITH_PIPE.exec(out);
    if (!m) break;
    const options = (m[1] ?? "").split("|");
    const choice = options[Math.floor(rng() * options.length)] ?? options[0] ?? "";
    out = out.slice(0, m.index) + choice + out.slice(m.index + m[0].length);
  }
  return out;
}

/**
 * Approximate count of distinct variations (exact for flat, non-nested
 * spintax; an upper bound when groups are nested). Informational "~N
 * variations" hint for the composer.
 */
export function countVariations(text: string): number {
  if (!text) return 1;
  let total = 1;
  let s = text;
  let guard = 0;
  while (guard++ < 5000) {
    const m = GROUP_WITH_PIPE.exec(s);
    if (!m) break;
    total *= (m[1] ?? "").split("|").length;
    s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
    if (total > 1_000_000) return total;
  }
  return total;
}

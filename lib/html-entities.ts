/**
 * Minimal HTML-entity decoder -- pure + client-safe (no deps, no DOM).
 *
 * Why: the Gmail API returns message snippets HTML-entity-ENCODED
 * ("That&#39;s great", "&lt;kevin@...&gt;"). We stored them verbatim and every
 * surface that renders a snippet as plain text (inbox thread list, worklist
 * reply previews, venue communication timeline) displayed the raw entities.
 * Decode once at ingest; render sites stay plain text.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const n =
        code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED[code.toLowerCase()] ?? match;
  });
}

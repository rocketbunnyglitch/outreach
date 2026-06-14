/**
 * Template copy guardrails — the doc's non-negotiables encoded as HARD limits a
 * learning system may never optimize away.
 *
 * A system that learns from outcomes will, left unfenced, learn pathologies:
 * optimizing confirmations teaches it to over-promise turnout (violating the
 * §5 honesty deflation), and copying a winning reply verbatim can bake in a
 * brand name (violating brand isolation) or a hallucinated merge field (which
 * ships as a broken [??field??]). These checks reject that copy at the door —
 * at proposal generation AND at promotion — so the learning stays inside the
 * walls, never optimizing through them.
 *
 * Pure + dependency-free (the caller supplies the known merge keys) so it's
 * trivially testable and reusable on the existing library, not just new drafts.
 */

export interface CopyViolation {
  code: "unresolved_merge" | "unknown_merge_field" | "hardcoded_brand" | "hardcoded_turnout";
  detail: string;
}

// Outreach-brand names/domains that must NEVER be literal in a template — the
// sending brand varies per campaign, so brand identity comes from
// {{company_name}} / {{signature_block}}. (CrawlBrands like "Fright Crawl" are
// the public event identity and are allowed; only the outreach-brand handles
// below break isolation when hardcoded.)
const OUTREACH_BRAND =
  /\b(events?-?perse|frightcrawlco|crawlconnector|crawleventscontact|barcrawlcontact|barcrawlconnect|contactperse)\b/i;

// A literal LARGE headcount claim (100+). Must use {{guest_count}} /
// {{turnout_quote_current}} so the system fills the honest, priority-correct,
// §5.3-deflated figure. Deliberately bounded to 3-4 digits: small ranges like
// "groups of 5-10 people" (crowd-flow) or "a small crowd of 20-50 people"
// (an honest, soft day-party expectation) are NOT over-promises and must pass —
// the rule targets hardcoding the big priority-driven number, not any mention
// of a count.
const TURNOUT_NOUN = /\b\d{3,4}\s*\+?\s*(?:people|guests?|attendees?|patrons?)\b/i;
const TURNOUT_VERB =
  /\b(?:expect|expecting|projecting|projected|bringing|driving|drive|drawing)\s+(?:around|about|roughly|~|up to|approximately)?\s*\d{3,4}\b/i;

const UNRESOLVED_MARKER = /\[\?\?.+?\?\?\]/;
const MERGE_REF = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Check a template's subject+body against the hard constraints. Returns the
 * list of violations (empty = clean). `knownMergeKeys` is the canonical merge
 * field list (MERGE_FIELD_KEYS) — anything else in {{...}} is a broken field.
 */
export function checkTemplateCopy(
  subject: string,
  body: string,
  knownMergeKeys: readonly string[],
): CopyViolation[] {
  const text = `${subject}\n${body}`;
  const out: CopyViolation[] = [];

  if (UNRESOLVED_MARKER.test(text)) {
    out.push({
      code: "unresolved_merge",
      detail: "Contains an unresolved merge marker [??…??].",
    });
  }

  const known = new Set(knownMergeKeys);
  const flagged = new Set<string>();
  for (const m of text.matchAll(MERGE_REF)) {
    const ref = m[1];
    if (!ref) continue;
    const root = ref.split(".")[0] ?? ref;
    if (!known.has(ref) && !known.has(root) && !flagged.has(ref)) {
      flagged.add(ref);
      out.push({
        code: "unknown_merge_field",
        detail: `Uses {{${ref}}}, which isn't a real merge field — it would ship as [??${ref}??].`,
      });
    }
  }

  if (OUTREACH_BRAND.test(text)) {
    out.push({
      code: "hardcoded_brand",
      detail:
        "Hardcodes an outreach-brand name/domain — use {{company_name}} / {{signature_block}} so the email matches whichever brand sends it.",
    });
  }

  if (TURNOUT_NOUN.test(text) || TURNOUT_VERB.test(text)) {
    out.push({
      code: "hardcoded_turnout",
      detail:
        "States a literal turnout number — use {{guest_count}} or {{turnout_quote_current}} so the system fills the honest, priority-correct figure (§5 deflation).",
    });
  }

  return out;
}

/** Convenience: true when the copy passes every hard constraint. */
export function templateCopyIsClean(
  subject: string,
  body: string,
  knownMergeKeys: readonly string[],
): boolean {
  return checkTemplateCopy(subject, body, knownMergeKeys).length === 0;
}

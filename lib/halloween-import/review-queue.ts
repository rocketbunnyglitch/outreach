import "server-only";

/**
 * Review queue generator — produces a markdown file the operator
 * hands to Claude Code, which then drives Claude in Chrome through
 * Google Maps to verify + fix venue name/address formatting on
 * the new stubs the Halloween 2025 import created.
 *
 * Strategy: cheapest possible. No API calls, no auto-mutation.
 *   1. The import flags every stub venue (decision='stub_new')
 *      and every trgm match below similarity 0.75 as "needs
 *      verification".
 *   2. This module reads those decisions + emits a markdown file
 *      with one venue per row + a copy-pasteable prompt block
 *      at the top.
 *   3. Operator runs Claude Code with the prompt. Claude Code
 *      uses Claude in Chrome to look up each venue on Google
 *      Maps, then calls a single admin endpoint (Phase 4b) to
 *      write back corrections.
 *
 * The output file goes to `data/halloween_2025_review_queue.md`
 * (gitignored at the import stage — it's an artifact, not
 * source). The operator can also download it via the admin UI.
 */

import type { ImportReport } from "./halloween-2025-import";

const TRGM_LOW_CONFIDENCE_THRESHOLD = 0.75;

export interface ReviewQueueItem {
  /** Stable id the verify-endpoint uses to write corrections
   *  back. Same as the new venue's UUID. NULL for items the
   *  dry-run preview is exposing (not yet inserted). */
  venueId: string | null;
  /** The xlsx source row's identifying triple. */
  sourceCity: string;
  sourceVenueName: string;
  /** Why this entry is in the queue:
   *   - 'stub'          new venue created from xlsx only
   *   - 'trgm_low'      matched an existing venue but only at
   *                     low similarity — possibly wrong */
  reason: "stub" | "trgm_low";
  /** For trgm_low items, the existing venue's name + similarity */
  matchedVenueName?: string;
  similarity?: number | null;
  /** Source data the operator can pass through to Google to
   *  verify. Address is the strongest signal. */
  sourceAddress: string | null;
  sourceEmail: string | null;
  sourcePhone: string | null;
}

export interface ReviewQueue {
  generatedAt: string;
  campaignSlug: string;
  totalStubs: number;
  totalLowConfidence: number;
  items: ReviewQueueItem[];
}

export function buildReviewQueue(
  report: ImportReport,
  /** Per-decision source contact pass-through. Indexed by the
   *  decision row's index in report.decisions — populated by the
   *  caller (the orchestrator passes source rows alongside
   *  decisions). For now this is an inline reconstruction. */
  sourceContacts?: Map<
    number,
    { address: string | null; email: string | null; phone: string | null }
  >,
): ReviewQueue {
  const items: ReviewQueueItem[] = [];

  report.decisions.forEach((d, idx) => {
    if (!d.cityMatch.ok) return; // skip — city wasn't matched

    // Stubs always go to the queue.
    if (d.venueDecision === "stub_new") {
      items.push({
        venueId: d.venueId ?? null,
        sourceCity: d.sourceCity,
        sourceVenueName: d.sourceVenueName,
        reason: "stub",
        sourceAddress: sourceContacts?.get(idx)?.address ?? null,
        sourceEmail: sourceContacts?.get(idx)?.email ?? null,
        sourcePhone: sourceContacts?.get(idx)?.phone ?? null,
      });
      return;
    }

    // Trgm matches below threshold are flagged for review.
    if (
      d.venueDecision === "trgm" &&
      d.venueSimilarity != null &&
      d.venueSimilarity < TRGM_LOW_CONFIDENCE_THRESHOLD
    ) {
      items.push({
        venueId: d.venueId ?? null,
        sourceCity: d.sourceCity,
        sourceVenueName: d.sourceVenueName,
        reason: "trgm_low",
        matchedVenueName: undefined, // populated below if needed
        similarity: d.venueSimilarity,
        sourceAddress: sourceContacts?.get(idx)?.address ?? null,
        sourceEmail: sourceContacts?.get(idx)?.email ?? null,
        sourcePhone: sourceContacts?.get(idx)?.phone ?? null,
      });
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    campaignSlug: report.campaignSlug,
    totalStubs: items.filter((i) => i.reason === "stub").length,
    totalLowConfidence: items.filter((i) => i.reason === "trgm_low").length,
    items,
  };
}

/**
 * Render the review queue as a markdown document for paste into
 * Claude Code. The output has three parts:
 *
 *   1. **Front-matter prompt** — instructions for Claude Code +
 *      Claude in Chrome. Tells it the playbook.
 *   2. **API contract** — the admin endpoint to PATCH each venue
 *      with corrections.
 *   3. **Per-venue rows** — one block per item. Includes a
 *      pre-filled Google Maps URL to open + the venueId to PATCH.
 *
 * The operator pastes this file into Claude Code. Claude Code
 * uses Claude in Chrome to open each Maps URL, read the actual
 * venue name + address, and PATCH back via the admin endpoint.
 */
export function renderReviewQueueMarkdown(queue: ReviewQueue): string {
  const lines: string[] = [];

  // ---------------- Header + prompt ----------------
  lines.push(
    "# Halloween 2025 import — venue verification queue",
    "",
    `Generated: ${queue.generatedAt}`,
    `Campaign: ${queue.campaignSlug}`,
    `Stubs to verify: ${queue.totalStubs}`,
    `Low-confidence matches to verify: ${queue.totalLowConfidence}`,
    "",
    "---",
    "",
    "## Instructions for Claude Code (uses Claude in Chrome)",
    "",
    "Below is a list of venues that were imported into the operator's database",
    "from the Halloween 2025 xlsx. Most have name + address from the spreadsheet",
    "as-is. Your job is to verify each one against Google Maps and write back",
    "corrections.",
    "",
    "**For each venue in the queue:**",
    "",
    "1. Open the pre-built Google Maps URL below in Claude in Chrome.",
    "2. Read the venue's canonical name + formatted address as Google shows them.",
    "3. If different from what the operator has, PATCH back via the admin endpoint:",
    "",
    "```",
    "PATCH /api/admin/venues/<venueId>",
    "Content-Type: application/json",
    "Cookie: <operator session cookie>",
    "",
    "{",
    '  "name": "<canonical Google name>",',
    '  "address": "<canonical Google formatted address>",',
    '  "verifiedFromGoogle": true',
    "}",
    "```",
    "",
    "4. Skip the venue (no PATCH) when:",
    "   - Google has no match for the name + address",
    "   - The operator's existing name + address already match Google exactly",
    "   - The Google result is for a different business (e.g. the source",
    "     said 'Smith's Bar' but Google's top hit is 'Smith's Diner')",
    "",
    "5. When a venue is in another country than expected (e.g. source said",
    "   'Birmingham, AL' but Google maps to Birmingham, UK), skip and log it.",
    "",
    "**Rate limiting:** Maximum 30 venues per minute to keep Google Maps from",
    "throttling Claude in Chrome.",
    "",
    "---",
    "",
    "## Queue",
    "",
  );

  // ---------------- Per-venue rows ----------------
  queue.items.forEach((item, idx) => {
    const queryParts = [item.sourceVenueName];
    if (item.sourceAddress) queryParts.push(item.sourceAddress);
    else queryParts.push(item.sourceCity);
    const query = queryParts.join(" ").trim();
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    lines.push(
      `### ${idx + 1}. ${item.sourceVenueName}`,
      "",
      `- **City (xlsx):** ${item.sourceCity}`,
      `- **Reason:** ${
        item.reason === "stub"
          ? "new stub venue — no existing match in DB"
          : `low-confidence trgm match (similarity ${item.similarity?.toFixed(2) ?? "?"})`
      }`,
    );

    if (item.sourceAddress) {
      lines.push(`- **Source address:** ${item.sourceAddress}`);
    }
    if (item.sourceEmail) lines.push(`- **Source email:** ${item.sourceEmail}`);
    if (item.sourcePhone) lines.push(`- **Source phone:** ${item.sourcePhone}`);

    lines.push(
      `- **venueId:** \`${item.venueId ?? "(none — dry-run preview)"}\``,
      `- **Open in Maps:** ${mapsUrl}`,
      "",
    );
  });

  if (queue.items.length === 0) {
    lines.push("_No venues to verify. All imports matched cleanly._", "");
  }

  return lines.join("\n");
}

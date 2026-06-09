import "server-only";

/**
 * Tier-1 contact scraper (regex-based).
 *
 * Fetches a venue's website (homepage + a handful of likely contact pages),
 * extracts emails + Instagram/Facebook with no LLM cost. This is the cheap
 * first pass; lib/contact-scraper-tier2.ts is the Haiku fallback used only
 * when Tier 1 finds no emails. The orchestrator (lib/enrichment-orchestrator)
 * wires the two together.
 *
 * All extraction + crawl logic lives in lib/contact-scraper-extract.ts, which
 * is dependency-free (no `server-only`, no `fetch`) so vitest can exercise it
 * with a stubbed fetch. This file is the thin server-only binding that
 * supplies the real `fetch`, `setTimeout`-based sleep, and clock.
 *
 * See PHASE E2 of the venue contact-enrichment build.
 */

import { type ScrapeDeps, scrapeContactsCore } from "./contact-scraper-extract";

export type { ScrapedContact, Tier1Result } from "./contact-scraper-extract";

const realDeps: ScrapeDeps = {
  fetchImpl: (url, init) => fetch(url, init as RequestInit),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Scrape a venue website for contact emails + socials. Never throws — a dead
 * site resolves to a `status: "unreachable"` result. Budget ~<=30s/venue
 * (8s/page timeout, polite 500ms gaps, early-exit once emails are found).
 */
export async function scrapeContactTier1(
  websiteUrl: string,
): Promise<import("./contact-scraper-extract").Tier1Result> {
  return scrapeContactsCore(websiteUrl, realDeps);
}

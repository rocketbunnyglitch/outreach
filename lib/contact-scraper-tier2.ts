import "server-only";

/**
 * Tier-2 contact scraper (Haiku semantic fallback).
 *
 * Runs ONLY when Tier 1 (lib/contact-scraper-tier1.ts) found no emails. It
 * re-fetches the homepage + a contact page, strips them to text, and asks
 * Claude Haiku (via the centralized lib/ai.ts client) to extract contacts.
 * An anti-hallucination guard drops any email the model returns that does
 * not appear verbatim in the source text.
 *
 * All logic lives in lib/contact-scraper-tier2-core.ts (dependency-free, so
 * vitest can mock the fetch + AI client). This file is the thin server-only
 * binding to real `fetch` and `generateCompletion`.
 *
 * See PHASE E3 of the venue contact-enrichment build.
 */

import { generateCompletion } from "./ai";
import type { Tier1Result } from "./contact-scraper-extract";
import { type Tier2Deps, scrapeContactTier2Core } from "./contact-scraper-tier2-core";

export type { Tier2Result } from "./contact-scraper-tier2-core";

const realDeps: Tier2Deps = {
  fetchImpl: (url, init) => fetch(url, init as RequestInit),
  aiComplete: (args) =>
    generateCompletion({
      system: args.system,
      prompt: args.prompt,
      model: args.model,
      maxTokens: args.maxTokens,
      tag: args.tag,
    }),
  now: () => Date.now(),
};

/**
 * Semantic fallback extraction. Never throws — failures resolve to a
 * `status: "failed"` result with `notes`. Cost is an ESTIMATE (chars/4
 * token heuristic) since the shared AI client does not surface usage.
 */
export async function scrapeContactTier2(
  websiteUrl: string,
  tier1Result: Tier1Result,
): Promise<import("./contact-scraper-tier2-core").Tier2Result> {
  return scrapeContactTier2Core(websiteUrl, tier1Result, realDeps);
}

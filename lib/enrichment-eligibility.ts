/**
 * Pure eligibility + concurrency helpers for the enrichment orchestrator.
 *
 * Dependency-free (no `server-only`, no db) so vitest can test the skip-logic
 * decision table and the bounded-concurrency pool directly. The orchestrator
 * (lib/enrichment-orchestrator.ts) loads venue rows + attempt history and
 * feeds plain objects into `decideEligibility`.
 *
 * See PHASE E4 of the venue contact-enrichment build.
 */

export type EnrichmentSkipReason = "has_email" | "no_website" | "already_attempted";

export type EnrichmentEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason: EnrichmentSkipReason;
      lastAttempt?: { at: string; status: string };
    };

export interface VenueEligibilityInput {
  /** venues.email */
  email: string | null;
  /** venues.alternate_emails */
  alternateEmails: string[];
  /** venues.website_url */
  websiteUrl: string | null;
  /** Most recent venue_enrichment_attempts row, if any. */
  lastAttempt: { at: string; status: string } | null;
}

/**
 * The skip-logic decision table. Order matters and is checked top-down:
 *   1. has_email          — already has a usable contact email; nothing to do.
 *   2. no_website         — no site to scrape.
 *   3. already_attempted  — any prior attempt (success OR fail) blocks a
 *                           re-run unless the caller force-retries.
 * Otherwise eligible.
 */
export function decideEligibility(v: VenueEligibilityInput): EnrichmentEligibility {
  const hasEmail = (v.email?.trim().length ?? 0) > 0 || v.alternateEmails.length > 0;
  if (hasEmail) return { eligible: false, reason: "has_email" };

  if ((v.websiteUrl?.trim().length ?? 0) === 0) return { eligible: false, reason: "no_website" };

  if (v.lastAttempt) {
    return { eligible: false, reason: "already_attempted", lastAttempt: v.lastAttempt };
  }
  return { eligible: true };
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving
 * input order in the results array. A rejected `fn` rejects the whole pool —
 * callers that want per-item isolation should catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const safeLimit = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < safeLimit; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** Extract the lower-cased host of a URL for per-domain rate limiting.
 *  Returns null for unparseable/empty input. */
export function domainOf(websiteUrl: string | null): string | null {
  if (!websiteUrl) return null;
  const trimmed = websiteUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

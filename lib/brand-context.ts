/**
 * Brand-context resolution helpers.
 *
 * Every code path that needs to know "what brand am I sending under" or
 * "what brand am I rendering for" goes through here. Per CLAUDE.md §7,
 * routing under the wrong brand is the most likely failure mode of the
 * two-brand model (DECISIONS.md#010).
 *
 * For a campaign-scoped action:
 *   const { outreachBrand, crawlBrand } = await requireCampaignBrands(campaignId);
 *   const fromAddress = `${staff.firstName.toLowerCase()}@${outreachBrand.emailDomain}`;
 *   const posterTemplate = await getPosterTemplate(crawlBrand.id);
 *
 * For listing all brands in admin UI:
 *   const outreach = await listOutreachBrands();
 *   const crawl = await listCrawlBrands();
 */

import { eq, isNull, or } from "drizzle-orm";
import {
  type CrawlBrand,
  type OutreachBrand,
  campaigns,
  crawlBrands,
  outreachBrands,
} from "../db/schema";
import { db } from "./db";

export interface BrandPair {
  outreachBrand: OutreachBrand;
  crawlBrand: CrawlBrand;
}

interface ListOptions {
  /** Include archived rows (default: false). */
  includeArchived?: boolean;
}

// =========================================================================
// OutreachBrand
// =========================================================================

export async function listOutreachBrands(opts: ListOptions = {}): Promise<OutreachBrand[]> {
  const rows = await db
    .select()
    .from(outreachBrands)
    .where(opts.includeArchived ? undefined : isNull(outreachBrands.archivedAt))
    .orderBy(outreachBrands.displayName);
  return rows;
}

export async function getOutreachBrand(idOrSlug: string): Promise<OutreachBrand | null> {
  const rows = await db
    .select()
    .from(outreachBrands)
    .where(or(eq(outreachBrands.id, idOrSlug), eq(outreachBrands.slug, idOrSlug)))
    .limit(1);
  return rows[0] ?? null;
}

// =========================================================================
// CrawlBrand
// =========================================================================

export async function listCrawlBrands(opts: ListOptions = {}): Promise<CrawlBrand[]> {
  const rows = await db
    .select()
    .from(crawlBrands)
    .where(opts.includeArchived ? undefined : isNull(crawlBrands.archivedAt))
    .orderBy(crawlBrands.displayName);
  return rows;
}

export async function getCrawlBrand(idOrSlug: string): Promise<CrawlBrand | null> {
  const rows = await db
    .select()
    .from(crawlBrands)
    .where(or(eq(crawlBrands.id, idOrSlug), eq(crawlBrands.slug, idOrSlug)))
    .limit(1);
  return rows[0] ?? null;
}

// =========================================================================
// Campaign → both brands
// =========================================================================

/**
 * Resolve the (OutreachBrand, CrawlBrand) pair for a campaign. Returns
 * null if the campaign doesn't exist or either brand FK is unexpectedly
 * missing (shouldn't happen given the NOT NULL FKs, but defensive).
 */
export async function getCampaignBrands(campaignId: string): Promise<BrandPair | null> {
  const rows = await db
    .select({
      outreachBrand: outreachBrands,
      crawlBrand: crawlBrands,
    })
    .from(campaigns)
    .innerJoin(outreachBrands, eq(campaigns.outreachBrandId, outreachBrands.id))
    .innerJoin(crawlBrands, eq(campaigns.crawlBrandId, crawlBrands.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Same as getCampaignBrands but throws if the campaign or its brand context
 * can't be resolved. Use in code paths where missing brand context is a
 * programming error rather than an expected case.
 */
export async function requireCampaignBrands(campaignId: string): Promise<BrandPair> {
  const pair = await getCampaignBrands(campaignId);
  if (!pair) {
    throw new Error(
      `Could not resolve brand context for campaign ${campaignId}. Both outreach_brand_id and crawl_brand_id should be present.`,
    );
  }
  return pair;
}

// =========================================================================
// Geography guardrail
// =========================================================================

/**
 * Validate that a city is eligible for a given CrawlBrand. A Toronto-only
 * brand cannot be assigned to a non-Toronto city. Returns null if valid;
 * a string reason if not.
 *
 * Called by campaign-creation server actions in Phase 3+.
 */
export function checkCrawlBrandGeographyCompatibility(
  brand: Pick<CrawlBrand, "geography" | "displayName">,
  city: { name: string; region: string | null },
): string | null {
  if (brand.geography === "international") return null;
  if (brand.geography === "toronto") {
    if (city.name === "Toronto") return null;
    return `${brand.displayName} is a Toronto-only brand and cannot be assigned to ${city.name}.`;
  }
  return null;
}

// Re-export the types so callers don't have to import from db/schema directly.
export type { CrawlBrand, OutreachBrand };

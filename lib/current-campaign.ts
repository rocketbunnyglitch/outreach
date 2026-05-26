/**
 * "Current campaign" is the per-session selection that drives most of the
 * admin UI's brand context. The operator picks a campaign from the switcher
 * in the top nav; from that moment, "send email" defaults to the campaign's
 * OutreachBrand, "render poster" defaults to its CrawlBrand, and so on.
 *
 * Storage:
 *   - HttpOnly cookie `crawl_engine_current_campaign` set by a server action.
 *   - No client-side state; every request re-reads the cookie. This is fine
 *     because it's a single SELECT by primary key when we resolve the row.
 *
 * The cookie is a campaign UUID (not a slug) — slugs can change.
 */

import { campaigns, crawlBrands, outreachBrands } from "@/db/schema";
import type { Campaign, CrawlBrand, OutreachBrand } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db";
import { logger } from "./logger";

const CAMPAIGN_COOKIE = "crawl_engine_current_campaign";

// UUID regex; defends against malformed cookies before we go near the DB.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CurrentCampaignContext {
  campaign: Campaign;
  outreachBrand: OutreachBrand;
  crawlBrand: CrawlBrand;
}

/**
 * Resolve the current campaign + its brand pair. Returns null if no cookie
 * is set, the cookie is malformed, or the referenced row doesn't exist /
 * has been archived.
 *
 * This is the canonical way to ask "what campaign is the operator looking
 * at right now?" — never read the cookie directly.
 */
export async function getCurrentCampaign(): Promise<CurrentCampaignContext | null> {
  const jar = await cookies();
  const cookieValue = jar.get(CAMPAIGN_COOKIE)?.value;
  if (!cookieValue || !UUID_RE.test(cookieValue)) return null;

  const rows = await db
    .select({
      campaign: campaigns,
      outreachBrand: outreachBrands,
      crawlBrand: crawlBrands,
    })
    .from(campaigns)
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(eq(campaigns.id, cookieValue))
    .limit(1);
  const result = rows[0];

  if (!result) {
    logger.warn({ cookieValue }, "current campaign cookie referenced a missing row");
    return null;
  }
  if (result.campaign.archivedAt !== null) {
    logger.info(
      { campaignId: result.campaign.id },
      "current campaign cookie referenced an archived row; ignoring",
    );
    return null;
  }
  return result;
}

/**
 * Set the current campaign cookie. Called from a server action when the
 * operator picks a new campaign in the switcher.
 *
 * Validates the id is a real, non-archived campaign before writing the
 * cookie — defense in depth, even though the switcher UI only offers
 * legitimate options.
 */
export async function setCurrentCampaignCookie(campaignId: string): Promise<void> {
  if (!UUID_RE.test(campaignId)) {
    throw new Error("Invalid campaign id");
  }

  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (rows.length === 0) {
    throw new Error("Campaign not found");
  }

  const jar = await cookies();
  jar.set(CAMPAIGN_COOKIE, campaignId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // 30 days; campaigns are long-running. The cookie just remembers the
    // operator's last selection, no auth implications.
    maxAge: 60 * 60 * 24 * 30,
  });
}

/**
 * Clear the cookie. Useful when the operator archives the current campaign
 * or signs out (though sign-out's redirect to /login implicitly hides
 * everything, this is cleaner).
 */
export async function clearCurrentCampaignCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CAMPAIGN_COOKIE);
}

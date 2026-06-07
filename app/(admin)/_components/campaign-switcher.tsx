import { campaigns, crawlBrands, outreachBrands } from "@/db/schema";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { desc, eq, isNull } from "drizzle-orm";
import { CampaignSwitcherClient } from "./campaign-switcher-client";

/**
 * Server-rendered wrapper that fetches the campaign list + current selection
 * and hands them to the client picker. Keeps the DB query off the client
 * but lets the dropdown be interactive.
 */
export async function CampaignSwitcher() {
  const [available, current] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        slug: campaigns.slug,
        outreachBrandName: outreachBrands.displayName,
        crawlBrandName: crawlBrands.displayName,
      })
      .from(campaigns)
      .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
      .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
      .where(isNull(campaigns.archivedAt))
      .orderBy(desc(campaigns.createdAt)),
    getCurrentCampaign(),
  ]);

  return (
    <CampaignSwitcherClient
      available={available}
      currentId={current?.campaign.id ?? null}
      currentLabel={current ? current.campaign.name : null}
      currentShortLabel={current?.campaign.shortName ?? null}
      currentBrandPair={
        current ? `${current.outreachBrand.displayName} · ${current.crawlBrand.displayName}` : null
      }
    />
  );
}

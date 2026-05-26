import {
  campaigns,
  cities,
  cityCampaigns,
  crawlBrands,
  outreachBrands,
  staffMembers,
} from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";

/** Bundle of all the dropdown options needed to set a goal's scope. */
export interface ScopeOptions {
  campaigns: Array<{ id: string; label: string }>;
  outreachBrands: Array<{ id: string; label: string }>;
  crawlBrands: Array<{ id: string; label: string }>;
  cityCampaigns: Array<{ id: string; label: string }>;
  staff: Array<{ id: string; label: string }>;
}

export async function loadScopeOptions(): Promise<ScopeOptions> {
  const [c, ob, cb, ccRows, s] = await Promise.all([
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(isNull(campaigns.archivedAt))
      .orderBy(asc(campaigns.name)),
    db
      .select({ id: outreachBrands.id, displayName: outreachBrands.displayName })
      .from(outreachBrands)
      .where(isNull(outreachBrands.archivedAt))
      .orderBy(asc(outreachBrands.displayName)),
    db
      .select({ id: crawlBrands.id, displayName: crawlBrands.displayName })
      .from(crawlBrands)
      .where(isNull(crawlBrands.archivedAt))
      .orderBy(asc(crawlBrands.displayName)),
    db
      .select({
        id: cityCampaigns.id,
        cityName: cities.name,
        campaignName: campaigns.name,
      })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .where(isNull(cities.archivedAt))
      .orderBy(asc(cities.name), asc(campaigns.name)),
    db
      .select({ id: staffMembers.id, displayName: staffMembers.displayName })
      .from(staffMembers)
      .where(isNull(staffMembers.archivedAt))
      .orderBy(asc(staffMembers.displayName)),
  ]);

  return {
    campaigns: c.map((x) => ({ id: x.id, label: x.name })),
    outreachBrands: ob.map((x) => ({ id: x.id, label: x.displayName })),
    crawlBrands: cb.map((x) => ({ id: x.id, label: x.displayName })),
    cityCampaigns: ccRows.map((x) => ({
      id: x.id,
      label: `${x.cityName} · ${x.campaignName}`,
    })),
    staff: s.map((x) => ({ id: x.id, label: x.displayName })),
  };
}

import { campaigns, cities, cityCampaigns } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createMiddleVenueGroup } from "../_actions";
import { MiddleGroupForm } from "../_components/middle-group-form";

export const metadata = { title: "New middle group" };
export const dynamic = "force-dynamic";

export default async function NewMiddleGroupPage({
  searchParams,
}: {
  searchParams: Promise<{
    cityCampaignId?: string;
    venueIds?: string;
    name?: string;
  }>;
}) {
  const params = await searchParams;

  // Eligible city_campaigns to attach the group to
  const ccOptions = await db
    .select({
      id: cityCampaigns.id,
      cityName: cities.name,
      campaignName: campaigns.name,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(isNull(campaigns.archivedAt))
    .orderBy(asc(cities.name), asc(campaigns.name));

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <Link
          href="/middle-groups"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All groups
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight">New middle group</h1>
        {params.venueIds && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Pre-filled from the cluster builder — {params.venueIds.split(",").length} venues will be
            attached on save.
          </p>
        )}
      </header>

      <MiddleGroupForm
        mode="create"
        cityCampaigns={ccOptions.map((c) => ({
          id: c.id,
          label: `${c.cityName} · ${c.campaignName}`,
        }))}
        initial={{
          cityCampaignId: params.cityCampaignId,
          name: params.name,
          venueIds: params.venueIds,
        }}
        action={createMiddleVenueGroup}
      />
    </div>
  );
}

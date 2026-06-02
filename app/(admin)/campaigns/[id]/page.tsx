import { addCityToCampaign } from "@/app/(admin)/city-campaigns/_actions";
import { Button } from "@/components/ui/button";
import { campaigns, cities, cityCampaigns, staffMembers } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { listCrawlBrands, listOutreachBrands } from "@/lib/brand-context";
import { loadCityCampaignProgress } from "@/lib/city-progress";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveCampaign, updateCampaign } from "../_actions";
import { CampaignForm } from "../_components/campaign-form";
import { CityCampaignsSection } from "../_components/city-campaigns-section";
import { DangerZoneBulkDelete } from "../_components/danger-zone-bulk-delete";
import { DeleteCampaignButton } from "../_components/delete-campaign-button";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff } = await requireStaff();

  const [campaign, _outreachBrands, _crawlBrands, ccRows, allCities, progressRows] =
    await Promise.all([
      db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1)
        .then((r) => r[0]),
      listOutreachBrands(),
      listCrawlBrands(),
      db
        .select({
          id: cityCampaigns.id,
          cityName: cities.name,
          cityRegion: cities.region,
          priority: cityCampaigns.priority,
          targetVenueCount: cityCampaigns.targetVenueCount,
          salesGoalCents: cityCampaigns.salesGoalCents,
          status: cityCampaigns.status,
          leadStaffName: staffMembers.displayName,
        })
        .from(cityCampaigns)
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .leftJoin(staffMembers, eq(staffMembers.id, cityCampaigns.leadStaffId))
        .where(eq(cityCampaigns.campaignId, id))
        .orderBy(asc(cityCampaigns.priority), asc(cities.name)),
      db
        .select({
          id: cities.id,
          name: cities.name,
          region: cities.region,
        })
        .from(cities)
        .where(isNull(cities.archivedAt))
        .orderBy(asc(cities.name)),
      loadCityCampaignProgress(id),
    ]);

  if (!campaign) notFound();

  // Cities not yet in this campaign
  const assignedIds = new Set(
    (
      await db
        .select({ cityId: cityCampaigns.cityId })
        .from(cityCampaigns)
        .where(eq(cityCampaigns.campaignId, id))
    ).map((r) => r.cityId),
  );
  const unassignedCities = allCities.filter((c) => !assignedIds.has(c.id));

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateCampaign(id, prev, fd);
  }
  async function boundArchive() {
    "use server";
    await archiveCampaign(id);
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-8">
        <header>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> All campaigns
          </Link>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight ">{campaign.name}</h1>
          <p className="mt-2 font-mono text-xs text-zinc-400 uppercase tracking-wider">
            {campaign.slug}
          </p>
        </header>

        <CampaignForm mode="edit" initial={campaign} action={boundUpdate} />
      </div>

      <CityCampaignsSection
        campaignId={id}
        cityCampaigns={ccRows}
        progressRows={progressRows}
        unassignedCities={unassignedCities}
        addAction={addCityToCampaign}
        isAdmin={hasMinimumRole(staff, "admin")}
      />

      <form
        action={boundArchive}
        className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950"
      >
        <div>
          <p className="font-medium text-rose-900 text-sm dark:text-rose-200">
            Archive this campaign
          </p>
          <p className="mt-1 text-rose-800 text-xs dark:text-rose-300">
            Hides it from lists. Underlying data (cities, venues, outreach history) is preserved.
          </p>
        </div>
        <Button type="submit" variant="destructive">
          Archive
        </Button>
      </form>

      <DangerZoneBulkDelete
        campaignId={id}
        campaignName={campaign.name}
        isAdmin={hasMinimumRole(staff, "admin")}
        cityCount={ccRows.length}
      />

      <DeleteCampaignButton
        campaignId={id}
        campaignName={campaign.name}
        isAdmin={hasMinimumRole(staff, "admin")}
      />
    </div>
  );
}

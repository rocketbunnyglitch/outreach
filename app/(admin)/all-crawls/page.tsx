import { loadAllCrawlsForCampaign } from "@/lib/all-crawls-data";
import { requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import Link from "next/link";
import { AllCrawlsSummary } from "./_components/all-crawls-summary";
import { AllCrawlsTable } from "./_components/all-crawls-table";

export const dynamic = "force-dynamic";

/**
 * /all-crawls — campaign-scoped flat view of every crawl.
 *
 * Resolves the operator's currently-selected campaign via cookie. If
 * none is selected, prompts them to pick one — this page only makes
 * sense in a campaign context.
 *
 * For the current campaign, loads every event row joined with its
 * city + slot counts + Eventbrite linkage, and renders an inline-
 * editable table with per-row EB sync controls.
 */
export default async function AllCrawlsPage() {
  await requireStaff();
  const currentCampaign = await getCurrentCampaign();

  if (!currentCampaign) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10">
        <header className="mb-8">
          <h1 className="font-semibold text-3xl tracking-tight">All crawls</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Pick a campaign to see every crawl across every city.
          </p>
        </header>
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No campaign selected. Open the campaign picker in the header.
          </p>
          <Link
            href="/campaigns"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Browse campaigns →
          </Link>
        </div>
      </main>
    );
  }

  const rows = await loadAllCrawlsForCampaign(currentCampaign.campaign.id);

  // Campaign-level metrics for the summary strip
  const totalCrawls = rows.length;
  const linkedCount = rows.filter((r) => !!r.eventbriteEventId).length;
  const readyCount = rows.filter((r) => r.openSlots === 0 && r.totalSlots > 0).length;
  const needsVenuesCount = rows.filter(
    (r) => r.openSlots > 0 && r.cityCampaignStatus !== "cancelled",
  ).length;
  const totalTickets = rows.reduce((sum, r) => sum + r.ticketsSold, 0);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
            {currentCampaign.campaign.name}
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">All crawls</h1>
        </div>
        <Link
          href={`/campaigns/${currentCampaign.campaign.id}`}
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          campaign overview →
        </Link>
      </header>

      {totalCrawls > 0 && (
        <AllCrawlsSummary
          campaignId={currentCampaign.campaign.id}
          totalCrawls={totalCrawls}
          linkedCount={linkedCount}
          readyCount={readyCount}
          needsVenuesCount={needsVenuesCount}
          totalTickets={totalTickets}
        />
      )}

      <AllCrawlsTable campaignId={currentCampaign.campaign.id} rows={rows} />
    </main>
  );
}

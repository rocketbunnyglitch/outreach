import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { loadTrackerData } from "@/lib/tracker-data";
import Link from "next/link";
import { TrackerDashboardTable } from "../_components/dashboard/tracker-dashboard-table";
import { BulkRenameCrawls } from "./_components/bulk-rename-crawls";
import { RefreshSalesButton } from "./_components/refresh-sales-button";

export const metadata = { title: "Tracker" };
export const dynamic = "force-dynamic";

/**
 * Full-page version of the dashboard tracker — the city x crawl sheet our
 * staff live in. Same inline-editable table, but its own page and defaulting
 * to "Show all" (no priority filtering) since this is the dedicated view.
 */
export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { staff } = await requireStaff();
  const { view } = await searchParams;
  // "My assignments" tab (operator request 2026-06-10): the same tracker
  // table filtered to the cities assigned to the viewer.
  const mine = view === "mine";
  const currentCampaign = await getCurrentCampaign();
  const campaignId = currentCampaign ? currentCampaign.campaign.id : null;

  const { rows: allRows, staff: staffOpts } = campaignId
    ? await loadTrackerData({ campaignId }).catch(() => ({ rows: [], staff: [] }))
    : { rows: [], staff: [] };
  const rows = mine ? allRows.filter((r) => r.leadStaffId === staff.id) : allRows;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Current Crawl</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Tracker</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Every city in {currentCampaign ? currentCampaign.campaign.name : "the current campaign"}
            , one row per city. Inline-edit priority, status, assignment, and notes. Expand a row
            for its per-crawl breakdown.
          </p>
        </div>
        {/* Global sales refresh (operator request 2026-06-11): one button
            here instead of per-card refreshes; sales also auto-sync at
            link time and every 15 min via the eventbrite-sync cron. */}
        {campaignId && <RefreshSalesButton campaignId={campaignId} />}
      </header>

      {/* Tabs: every city vs just the viewer's assigned cities. */}
      <div className="flex items-center gap-1.5">
        <Link
          href="/tracker"
          className={`rounded-full px-3.5 py-1.5 font-medium text-sm transition-colors ${
            mine
              ? "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
              : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          }`}
        >
          All cities
        </Link>
        <Link
          href="/tracker?view=mine"
          className={`rounded-full px-3.5 py-1.5 font-medium text-sm transition-colors ${
            mine
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          }`}
        >
          My assignments
        </Link>
      </div>

      {campaignId && !mine && (
        <BulkRenameCrawls campaignId={campaignId} isAdmin={hasMinimumRole(staff, "admin")} />
      )}

      {campaignId && rows.length > 0 ? (
        <TrackerDashboardTable rows={rows} staff={staffOpts} defaultPriorityFilter="all" />
      ) : (
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <p className="font-medium text-base text-zinc-700 dark:text-zinc-300">
            {!campaignId
              ? "No campaign selected"
              : mine
                ? "No cities assigned to you yet"
                : "No cities in this campaign yet"}
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            {mine ? (
              <>
                Queue an email in a city to claim it automatically, or set yourself in the Assign
                column on{" "}
                <Link href="/tracker" className="underline underline-offset-2">
                  All cities
                </Link>
                .
              </>
            ) : (
              <>
                Add cities from{" "}
                <Link href="/admin" className="underline underline-offset-2">
                  Admin
                </Link>{" "}
                or pick a current campaign first.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

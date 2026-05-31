import { requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { loadTrackerData } from "@/lib/tracker-data";
import Link from "next/link";
import { TrackerDashboardTable } from "../_components/dashboard/tracker-dashboard-table";
import { BulkRenameCrawls } from "./_components/bulk-rename-crawls";

export const metadata = { title: "Tracker" };
export const dynamic = "force-dynamic";

/**
 * Full-page version of the dashboard tracker — the city x crawl sheet our
 * staff live in. Same inline-editable table, but its own page and defaulting
 * to "Show all" (no priority filtering) since this is the dedicated view.
 */
export default async function TrackerPage() {
  const { staff } = await requireStaff();
  const currentCampaign = await getCurrentCampaign();
  const campaignId = currentCampaign ? currentCampaign.campaign.id : null;

  const { rows, staff: staffOpts } = campaignId
    ? await loadTrackerData({ campaignId }).catch(() => ({ rows: [], staff: [] }))
    : { rows: [], staff: [] };

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
      </header>

      {campaignId && <BulkRenameCrawls campaignId={campaignId} isAdmin={staff.role === "admin"} />}

      {campaignId && rows.length > 0 ? (
        <TrackerDashboardTable rows={rows} staff={staffOpts} defaultPriorityFilter="all" />
      ) : (
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <p className="font-medium text-base text-zinc-700 dark:text-zinc-300">
            {campaignId ? "No cities in this campaign yet" : "No campaign selected"}
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            Add cities from{" "}
            <Link href="/admin" className="underline underline-offset-2">
              Admin
            </Link>{" "}
            or pick a current campaign first.
          </p>
        </div>
      )}
    </div>
  );
}

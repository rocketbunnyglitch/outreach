import { requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { captureException } from "@/lib/logger";
import {
  type LifecycleBoard as LifecycleBoardData,
  loadVenueLifecycleBoard,
} from "@/lib/pipeline-board";
import Link from "next/link";
import { LifecycleBoard } from "../_components/pipeline/lifecycle-board";

export const dynamic = "force-dynamic";

/**
 * Venue lifecycle board (Phase 10). Kanban of the current campaign's pipeline:
 * Cold Lead -> Emailed -> Warm -> Slot Offered -> Confirmed -> Ready ->
 * Completed (+ Cancelled). Read-only v1; cards drill through to the venue.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const allCampaigns = params.scope === "all";

  await requireStaff();
  const currentCampaign = await getCurrentCampaign();
  const campaignId = !allCampaigns && currentCampaign ? currentCampaign.campaign.id : null;

  const empty: LifecycleBoardData = { lanes: [], total: 0, truncated: false };
  const board = await loadVenueLifecycleBoard(campaignId).catch(async (err) => {
    await captureException(err, { widget: "pipeline_board", campaignId });
    return empty;
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Pipeline</p>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-semibold text-3xl tracking-tight">Venue lifecycle</h1>
          <p className="font-mono text-[11px] text-zinc-500">
            {campaignId && currentCampaign ? (
              <>
                {currentCampaign.campaign.name} ·{" "}
                <Link
                  href="/pipeline?scope=all"
                  className="hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  view all →
                </Link>
              </>
            ) : (
              "all campaigns"
            )}
          </p>
        </div>
      </header>

      <LifecycleBoard board={board} />
    </div>
  );
}

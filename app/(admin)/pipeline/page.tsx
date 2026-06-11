import { requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { captureException } from "@/lib/logger";
import {
  type LifecycleBoard as LifecycleBoardData,
  loadVenueLifecycleBoard,
} from "@/lib/pipeline-board";
import {
  type PostConfirmBoard as PostConfirmBoardData,
  loadPostConfirmBoard,
} from "@/lib/post-confirm-board";
import Link from "next/link";
import { LifecycleBoard } from "../_components/pipeline/lifecycle-board";
import { PostConfirmBoard } from "../_components/pipeline/post-confirm-board";

export const dynamic = "force-dynamic";

type View = "lifecycle" | "post-confirm";

/**
 * Pipeline boards (Phase 10). Two views: the venue lifecycle kanban (Cold Lead
 * -> ... -> Completed, drag-to-move) and the post-confirm board (Graphic ->
 * Sheet -> T13 -> T14 -> V2 -> Ready). Both scope to the current campaign.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; view?: string }>;
}) {
  const params = await searchParams;
  const allCampaigns = params.scope === "all";
  const view: View = params.view === "post-confirm" ? "post-confirm" : "lifecycle";

  await requireStaff();
  const currentCampaign = await getCurrentCampaign();
  const campaignId = !allCampaigns && currentCampaign ? currentCampaign.campaign.id : null;

  const scopeQs = allCampaigns ? "&scope=all" : "";

  let lifecycle: LifecycleBoardData | null = null;
  let postConfirm: PostConfirmBoardData | null = null;
  if (view === "post-confirm") {
    postConfirm = await loadPostConfirmBoard(campaignId).catch(async (err) => {
      await captureException(err, { widget: "post_confirm_board", campaignId });
      const fallback: PostConfirmBoardData = { columns: [], total: 0 };
      return fallback;
    });
  } else {
    lifecycle = await loadVenueLifecycleBoard(campaignId).catch(async (err) => {
      await captureException(err, { widget: "pipeline_board", campaignId });
      return { lanes: [], total: 0, truncated: false };
    });
  }

  const tab = (key: View, label: string) => {
    const active = view === key;
    return (
      <Link
        href={`/pipeline?view=${key}${scopeQs}`}
        className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
          active
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Pipeline</p>
            <h1 className="font-semibold text-3xl tracking-tight">
              {view === "post-confirm" ? "Post-confirm ops" : "Venue lifecycle"}
            </h1>
          </div>
          <p className="font-mono text-[11px] text-zinc-500">
            {campaignId && currentCampaign ? (
              <>
                {currentCampaign.campaign.name} ·{" "}
                <Link
                  href={`/pipeline?view=${view}&scope=all`}
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
        <div className="flex items-center gap-1.5">
          {tab("lifecycle", "Lifecycle")}
          {tab("post-confirm", "Post-confirm")}
        </div>
      </header>

      {view === "post-confirm" && postConfirm ? (
        <PostConfirmBoard board={postConfirm} />
      ) : lifecycle ? (
        <LifecycleBoard board={lifecycle} />
      ) : null}
    </div>
  );
}

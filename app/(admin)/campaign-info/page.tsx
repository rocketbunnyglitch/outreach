/**
 * /campaign-info — visible to everyone on the team.
 *
 * Lists every connected Gmail inbox with its owner + assignment
 * state for the active campaign. Admins see inline editing
 * controls (owner dropdown, assign checkbox); non-admins see the
 * same info read-only.
 *
 * The page resolves the active campaign via lib/current-campaign.
 * If no campaign is selected, we show a stub instructing the user
 * to pick one via the campaign switcher.
 */

import { requireStaff } from "@/lib/auth";
import { loadCampaignInfo } from "@/lib/campaign-info-data";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { Mail } from "lucide-react";
import { CampaignInfoTable } from "./_components/campaign-info-table";

export const metadata = { title: "Campaign Info" };
export const dynamic = "force-dynamic";

export default async function CampaignInfoPage() {
  const { staff } = await requireStaff();
  const campaignCtx = await getCurrentCampaign();
  const isAdmin = staff.role === "admin";

  if (!campaignCtx) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Current Crawl</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Campaign Info</h1>
        </header>
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <Mail className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">
            No active campaign selected. Pick one from the campaign switcher in the top nav.
          </p>
        </div>
      </div>
    );
  }

  const data = await loadCampaignInfo({
    teamId: staff.teamId,
    campaignId: campaignCtx.campaign.id,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            Current Crawl · {campaignCtx.campaign.name}
          </p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Campaign Info</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            All connected Gmail inboxes for the team.{" "}
            {isAdmin
              ? "Assign each inbox to a staff owner and to this campaign."
              : "Read-only — only admins can edit assignments."}
          </p>
        </div>
      </header>

      {data.inboxes.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <Mail className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">
            No connected Gmail accounts yet. Connect one in Settings.
          </p>
        </div>
      ) : (
        <CampaignInfoTable
          inboxes={data.inboxes}
          teamMembers={data.teamMembers}
          campaignId={campaignCtx.campaign.id}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

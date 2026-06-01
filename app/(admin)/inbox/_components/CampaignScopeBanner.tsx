import Link from "next/link";

/**
 * Campaign-scope indicator banner.
 *
 * Renders above the thread list when the inbox is scoped by the
 * global campaign switcher (i.e., the operator picked a campaign
 * in the top-nav switcher and no URL filter overrides it). Without
 * this, an operator who scoped to Halloween in the top nav opens
 * /inbox and sees only Halloween threads — that's the correct
 * behavior per the spec, but the affordance to bail out has to be
 * visible or they'll wonder where their other threads went.
 *
 * Renders nothing when:
 *   - No global campaign is selected
 *   - The operator already used `?campaign=` (specific cityCampaign) —
 *     they explicitly chose a narrower filter
 *   - `?allCampaigns=1` is set — the operator already opted out
 *
 * The "Show all campaigns" link sets `?allCampaigns=1` so the
 * operator can override the default scope without clearing the
 * campaign cookie from a tucked-away menu.
 */
export function CampaignScopeBanner({
  campaignName,
  showAllHref,
}: {
  /** Display name of the active campaign (from getCurrentCampaign). */
  campaignName: string;
  /** Pre-built href that resets to ?allCampaigns=1 while preserving
   *  other filters. */
  showAllHref: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-zinc-200/80 border-b bg-zinc-50/70 px-4 py-2 text-xs dark:border-zinc-800/60 dark:bg-zinc-900/40">
      <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          Scoped to
        </span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{campaignName}</span>
      </div>
      <Link
        href={showAllHref}
        className="font-medium text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Show all campaigns
      </Link>
    </div>
  );
}

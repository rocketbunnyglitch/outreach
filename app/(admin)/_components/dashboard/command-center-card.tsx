import type { CampaignHealthSummary } from "@/lib/health-score";
import type { HealthScore } from "@/lib/health-score-core";
import Link from "next/link";
import { HealthChip } from "./health-chip";

/**
 * Command center -- surfaces PROBLEMS, not everything. Lists the crawls that
 * are not green (worst first) with their one next action and a drilldown link,
 * plus a campaign-health headline and the viewer's own workload. When nothing
 * is at risk it collapses to a single "all on track" line so the dashboard
 * stays quiet. Pure server component (no hooks) -> no hydration risk.
 */

const MAX_ROWS = 8;

export function CommandCenterCard({
  summary,
  staffWorkload,
}: {
  summary: CampaignHealthSummary;
  staffWorkload?: HealthScore | null;
}) {
  // Nothing graded yet (no events in scope) -> render nothing.
  if (summary.cities.length === 0) return null;

  const atRisk = summary.atRiskCrawls;
  const shown = atRisk.slice(0, MAX_ROWS);
  const overflow = atRisk.length - shown.length;
  const redCount = atRisk.filter((c) => c.health.color === "red").length;

  return (
    <section className="card-surface flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-semibold text-lg tracking-tight">Command center</h2>
          <HealthChip
            color={summary.campaign.color}
            label={summary.campaign.statusLabel}
            score={summary.campaign.score}
          />
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          {atRisk.length === 0
            ? "all crawls on track"
            : `${redCount} at risk · ${atRisk.length} need attention`}
        </p>
      </header>

      {staffWorkload && staffWorkload.color !== "green" && (
        <div className="flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800/40">
          <HealthChip color={staffWorkload.color} label="Your workload" />
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            {staffWorkload.blockers[0] ?? staffWorkload.reasons[0]}
            {staffWorkload.nextAction ? ` — ${staffWorkload.nextAction}` : ""}
          </span>
        </div>
      )}

      {atRisk.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">
          Every crawl in scope is green. Nothing needs attention right now.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
          {shown.map((c) => {
            const reason = c.health.blockers[0] ?? c.health.reasons[0] ?? null;
            return (
              <li key={c.eventId}>
                <Link
                  href={`/city-campaigns/${c.cityCampaignId}`}
                  className="flex items-center gap-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                >
                  <HealthChip color={c.health.color} score={c.health.score} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">
                      <span className="text-zinc-900 dark:text-zinc-100">{c.cityName}</span>
                      <span className="text-zinc-400"> · {c.label}</span>
                    </p>
                    {reason && <p className="truncate text-xs text-zinc-500">{reason}</p>}
                  </div>
                  {c.health.nextAction && (
                    <span className="hidden shrink-0 font-mono text-[11px] text-zinc-500 sm:inline">
                      {c.health.nextAction} →
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {overflow > 0 && (
        <p className="font-mono text-[11px] text-zinc-500">
          + {overflow} more crawl{overflow > 1 ? "s" : ""} need attention
        </p>
      )}
    </section>
  );
}

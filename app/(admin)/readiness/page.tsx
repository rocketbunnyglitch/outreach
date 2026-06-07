import { requireStaff } from "@/lib/auth";
import { getCurrentCampaign } from "@/lib/current-campaign";
import type { EventReadiness } from "@/lib/event-readiness";
import { type ReadinessDashboardRow, loadCampaignReadiness } from "@/lib/event-readiness";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Event-day readiness" };
export const dynamic = "force-dynamic";

/**
 * Event-day readiness dashboard (P1-2). Every CONFIRMED venue for the active
 * campaign with its prep checklist (confirmed / 2-week / 1-week / 3-day call /
 * floor-staff briefed) rolled into a status pill, plus a hard BLOCKER flag for
 * a confirmed event 0-4 days out whose floor-staff briefing is still pending.
 * Read-only -- the actual call actions live on the worklist.
 */
export default async function ReadinessPage() {
  await requireStaff();
  const ctx = await getCurrentCampaign();
  if (!ctx) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        Pick a campaign in the top bar to see its event-day readiness.
      </div>
    );
  }
  const rows = await loadCampaignReadiness({ campaignId: ctx.campaign.id });
  const blockers = rows.filter((r) => r.readiness.blocker).length;
  const ready = rows.filter((r) => r.readiness.status === "ready").length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-blue-500" />
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Operate</p>
          <h1 className="font-semibold text-2xl tracking-tight">Event-day readiness</h1>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {blockers > 0 ? (
            <span className="rounded-full border border-red-400 bg-red-100 px-2.5 py-1 font-medium text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
              {blockers} blocker{blockers === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
            {ready}/{rows.length} ready
          </span>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No confirmed venues for this campaign yet. Readiness appears here as venues confirm.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <ReadinessRow key={r.venueEventId} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<EventReadiness["status"], string> = {
  ready:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
  on_track:
    "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200",
  at_risk:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200",
  not_started:
    "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

function ReadinessRow({ row }: { row: ReadinessDashboardRow }) {
  const { readiness } = row;
  const roleLabel = row.role === "alt_final" ? "final" : row.role;
  const pending = readiness.steps.filter((s) => !s.done).map((s) => s.label);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <a
            href={`/venues/${row.venueId}`}
            className="truncate font-medium text-sm hover:underline"
          >
            {row.venueName}
          </a>
          <p className="font-mono text-[10px] text-zinc-400">
            {row.cityName ? `${row.cityName} - ` : ""}
            {roleLabel} &middot; event {row.eventDate}
            {readiness.daysToEvent != null ? ` (${readiness.daysToEvent}d)` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {readiness.blocker ? (
            <span
              title={readiness.blockerReason ?? "Event-day readiness blocker"}
              className="rounded-full border border-red-400 bg-red-100 px-2 py-0.5 font-mono text-[9px] text-red-800 uppercase tracking-[0.08em] dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
            >
              Blocker
            </span>
          ) : null}
          <span
            title={pending.length > 0 ? `Pending: ${pending.join(", ")}` : "All prep complete"}
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${STATUS_STYLES[readiness.status]}`}
          >
            {readiness.statusLabel} {readiness.doneCount}/{readiness.totalCount}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {readiness.steps.map((s) => (
          <span
            key={s.key}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] ${
              s.done
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {s.done ? "+" : "-"} {s.label}
          </span>
        ))}
      </div>
    </li>
  );
}

import { cn } from "@/lib/cn";
import type { TodayDigest } from "@/lib/today-data";
import { AlertTriangle, CheckCircle2, Clock, Sparkles, Sunrise } from "lucide-react";
import Link from "next/link";

const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat·D",
  saturday_night: "Sat",
  sunday_day: "Sun·D",
  sunday_night: "Sun",
  other: "Other",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt Final",
};

const STATUS_LABEL: Record<string, string> = {
  email_sent: "emailed",
  follow_up_due: "follow-up due",
  called: "called",
  voicemail: "voicemail",
  no_answer: "no answer",
};

interface Props {
  digest: TodayDigest;
  /** When null, the widget hides — caller already shows the
   * "no campaign selected" empty state. */
  currentCampaign: { id: string; name: string } | null;
}

/**
 * Today digest widget for the operations dashboard.
 *
 * Three columns on desktop, stacked on mobile:
 *
 *   1. Need attention this week — urgent crawls with open slots,
 *      sorted by days_until ascending. Each row links into the
 *      city sheet so the operator goes from "Friday Crawl 2 in
 *      Chicago needs 2 venues" to filling them in one click.
 *
 *   2. Follow-ups overdue — cold outreach entries last touched 5+
 *      days ago in a non-terminal status. Links into the city
 *      sheet where the cold outreach table renders inline.
 *
 *   3. Recent wins — venue_events confirmed in the past 7 days.
 *      Pure morale signal; no action required. Reading "Bar X
 *      confirmed 2 days ago" makes the operator's day better.
 *
 * Empty states: each column hides itself when its bucket is empty,
 * and if all three buckets are empty the whole widget collapses to
 * a single calm "All caught up" line. That avoids the "wall of
 * zeros" anti-pattern.
 */
export function TodayWidget({ digest, currentCampaign }: Props) {
  if (!currentCampaign) return null;

  const totalCount =
    digest.urgentCrawls.length + digest.staleFollowUps.length + digest.recentWins.length;

  if (totalCount === 0) {
    return (
      <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50/40 p-5 shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:from-zinc-950/60 dark:to-zinc-900/60 dark:shadow-none">
        <header className="flex min-w-0 flex-wrap items-center gap-2">
          <Sunrise className="h-4 w-4 shrink-0 text-zinc-400" />
          <h2 className="shrink-0 font-semibold text-sm tracking-tight">Today</h2>
          <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            · {currentCampaign.name}
          </span>
        </header>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          All caught up. No urgent crawls, no stale follow-ups, no fresh confirmations to celebrate
          this week.
        </p>
      </section>
    );
  }

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex min-w-0 items-center gap-2">
          <Sunrise className="h-4 w-4 shrink-0 text-amber-500" />
          <h2 className="shrink-0 font-semibold text-sm tracking-tight">Today</h2>
          <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            · {currentCampaign.name}
          </span>
        </div>
        <p className="shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          live digest
        </p>
      </header>

      <div className="grid gap-px bg-zinc-200/60 md:grid-cols-3 dark:bg-zinc-800/40">
        {/* Urgent crawls */}
        <UrgentCrawlsColumn rows={digest.urgentCrawls} />
        {/* Stale follow-ups */}
        <StaleFollowUpsColumn rows={digest.staleFollowUps} />
        {/* Recent wins */}
        <RecentWinsColumn rows={digest.recentWins} />
      </div>
    </section>
  );
}

function UrgentCrawlsColumn({ rows }: { rows: TodayDigest["urgentCrawls"] }) {
  return (
    <div className="bg-white p-4 dark:bg-zinc-950/60">
      <header className="mb-3 flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-rose-500" />
        <h3 className="font-mono font-semibold text-[10px] text-zinc-700 uppercase tracking-[0.12em] dark:text-zinc-300">
          Need attention this week
        </h3>
      </header>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No imminent crawls with open slots — nice.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.eventId}>
              <Link
                href={`/city-campaigns/${r.cityCampaignId}`}
                className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-rose-500/[0.06] dark:hover:bg-rose-500/[0.1]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-xs text-zinc-900 dark:text-zinc-100">
                    {r.cityName}
                    <span className="ml-1.5 font-mono font-normal text-[10px] text-zinc-500">
                      {DAY_LABEL[r.dayPart] ?? r.dayPart} #{r.crawlNumber}
                    </span>
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                    {r.daysUntil === 0
                      ? "today"
                      : r.daysUntil === 1
                        ? "tomorrow"
                        : `in ${r.daysUntil} days`}
                  </p>
                </div>
                <UrgencyPill openSlots={r.openSlots} daysUntil={r.daysUntil} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaleFollowUpsColumn({ rows }: { rows: TodayDigest["staleFollowUps"] }) {
  return (
    <div className="bg-white p-4 dark:bg-zinc-950/60">
      <header className="mb-3 flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-amber-500" />
        <h3 className="font-mono font-semibold text-[10px] text-zinc-700 uppercase tracking-[0.12em] dark:text-zinc-300">
          Follow-ups overdue
        </h3>
      </header>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No stale follow-ups.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.entryId}>
              <Link
                href={`/city-campaigns/${r.cityCampaignId}`}
                className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-amber-500/[0.06] dark:hover:bg-amber-500/[0.1]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-xs text-zinc-900 dark:text-zinc-100">
                    {r.venueName}
                    <span className="ml-1.5 font-mono font-normal text-[10px] text-zinc-500">
                      · {r.cityName}
                    </span>
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                    {STATUS_LABEL[r.status] ?? r.status} ·{" "}
                    <span className="text-amber-600 dark:text-amber-400">
                      {r.daysSinceTouch}d ago
                    </span>
                    {r.assignedStaffName && (
                      <span className="ml-1.5 text-zinc-500">
                        · {r.assignedStaffName.split(" ")[0]}
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentWinsColumn({ rows }: { rows: TodayDigest["recentWins"] }) {
  return (
    <div className="bg-white p-4 dark:bg-zinc-950/60">
      <header className="mb-3 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-emerald-500" />
        <h3 className="font-mono font-semibold text-[10px] text-zinc-700 uppercase tracking-[0.12em] dark:text-zinc-300">
          Recent wins
        </h3>
      </header>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">
          No fresh confirmations this week yet — keep at it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.venueEventId}>
              <Link
                href={`/city-campaigns/${r.cityCampaignId}`}
                className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-emerald-500/[0.06] dark:hover:bg-emerald-500/[0.1]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-xs text-zinc-900 dark:text-zinc-100">
                    <CheckCircle2 className="mr-1 inline-block h-2.5 w-2.5 text-emerald-500" />
                    {r.venueName}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                    {ROLE_LABEL[r.role] ?? r.role}
                    {r.nights > 1 ? ` ×${r.nights} nights` : ""} · {r.cityName} ·{" "}
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {r.daysAgo === 0 ? "today" : `${r.daysAgo}d ago`}
                    </span>
                    {/* Who owns the win (operator request 2026-06-10). */}
                    {r.winnerName && (
                      <span className="text-zinc-600 dark:text-zinc-300"> · {r.winnerName}</span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UrgencyPill({ openSlots, daysUntil }: { openSlots: number; daysUntil: number }) {
  // Urgent = ≤3 days OR ≥3 open slots in ≤7 days
  const urgent = daysUntil <= 3 || (daysUntil <= 7 && openSlots >= 3);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset",
        urgent
          ? "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300"
          : "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300",
      )}
    >
      {openSlots} open
    </span>
  );
}

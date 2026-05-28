import Link from "next/link";

/**
 * Read-only "where has this venue been booked" history shown on the venue
 * details page. Lists every crawl this venue was confirmed/scheduled for,
 * across cities + campaigns, so operators get the useful booking history
 * without digging through each city sheet. Server component — no client JS.
 */

export interface CrawlHistoryRow {
  eventId: string;
  cityCampaignId: string;
  eventDate: string;
  dayPart: string | null;
  crawlNumber: number | null;
  routeLabel: string | null;
  role: string;
  status: string;
  cityName: string;
  campaignName: string;
}

const DAY_PART_LABEL: Record<string, string> = {
  thursday_night: "Thu Night",
  friday_night: "Fri Night",
  saturday_day: "Sat Day",
  saturday_night: "Sat Night",
  sunday_day: "Sun Day",
  sunday_night: "Sun Night",
  other: "Other",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt Final",
};

export function CrawlHistorySection({ rows }: { rows: CrawlHistoryRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold text-2xl tracking-tight">Crawl history</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Crawls this venue has been confirmed or scheduled for.
        </p>
      </div>
      <div className="card-surface divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
        {rows.map((r, i) => (
          <Link
            key={`${r.eventId}-${r.role}-${i}`}
            href={`/city-campaigns/${r.cityCampaignId}`}
            className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-sm">
                {r.cityName} · {r.campaignName}
              </span>
              <span className="truncate text-[12px] text-zinc-500">
                {r.dayPart ? (DAY_PART_LABEL[r.dayPart] ?? r.dayPart) : "Crawl"}
                {r.crawlNumber ? ` #${r.crawlNumber}` : ""}
                {r.routeLabel ? ` · ${r.routeLabel}` : ""} · {ROLE_LABEL[r.role] ?? r.role}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
                {r.status}
              </span>
              <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                {r.eventDate}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

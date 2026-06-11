import { requireStaff } from "@/lib/auth";
import { runCancellationReview } from "@/lib/cancellation-review";
import { loadCrawlGantt } from "@/lib/crawl-gantt";
import { loadCrawlHoursGantt } from "@/lib/crawl-hours-gantt";
import {
  loadCrawlIssues,
  loadCrawlSupport,
  loadRecentCalls,
  loadSupportStaff,
} from "@/lib/crawl-support";
import { CancellationReviewCard } from "./_components/cancellation-review-card";
import { CrawlGantt } from "./_components/crawl-gantt";
import { CrawlHoursGantt } from "./_components/crawl-hours-gantt";
import { CrawlSupportBoard } from "./_components/crawl-support-board";

export const dynamic = "force-dynamic";

export default async function CrawlSupportPage() {
  await requireStaff();
  const [data, issues, staff, calls, gantt, hoursGantt, cancelReview] = await Promise.all([
    loadCrawlSupport({ now: new Date() }),
    loadCrawlIssues(),
    loadSupportStaff(),
    loadRecentCalls(),
    loadCrawlGantt(),
    loadCrawlHoursGantt().catch(() => []),
    // Read-only scan (notify:false): same risk signals the cron flags,
    // rendered as a queue so the 7.9 review wave is visible, not just a
    // one-shot notification someone might miss.
    runCancellationReview({ notify: false }).catch(() => ({
      scanned: 0,
      flagged: 0,
      notified: 0,
      rows: [],
    })),
  ]);

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-6">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Live Operations</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Crawl Support</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500">
          Crawls running now, starting soon, or just completed — bucketed by each city's local time.
          Calls and urgent-issue logging arrive once their tables are migrated.
        </p>
      </header>

      {/* Crawls flagged for the event-week cancellation review (refdoc 7.9).
          Renders only when something is flagged. */}
      <CancellationReviewCard rows={cancelReview.rows} />

      {/* Crawl-night grid: one column per crawl night, one row per city,
          clickable chip per crawl. Overlap row + dark-night summary show
          which nights need support coverage and which don't. */}
      <CrawlGantt
        columns={gantt.columns}
        rows={gantt.rows}
        rangeLabel={gantt.rangeLabel}
        gapSummary={gantt.gapSummary}
        crawlNights={gantt.crawlNights}
        gapNights={gantt.gapNights}
      />

      {/* HOURS gantt (operator request x3): within each upcoming crawl,
          every venue slot as a bar on a scrollable time axis — coverage,
          overlaps and red no-coverage gaps at a glance. Bars come from
          slot times or parsed agreed-hours text. */}
      <CrawlHoursGantt crawls={hoursGantt} />

      <CrawlSupportBoard data={data} issues={issues} staff={staff} calls={calls} />
    </div>
  );
}

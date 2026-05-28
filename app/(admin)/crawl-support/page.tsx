import { requireStaff } from "@/lib/auth";
import {
  loadCrawlIssues,
  loadCrawlSupport,
  loadRecentCalls,
  loadSupportStaff,
} from "@/lib/crawl-support";
import { CrawlSupportBoard } from "./_components/crawl-support-board";

export const dynamic = "force-dynamic";

export default async function CrawlSupportPage() {
  await requireStaff();
  const [data, issues, staff, calls] = await Promise.all([
    loadCrawlSupport({ now: new Date() }),
    loadCrawlIssues(),
    loadSupportStaff(),
    loadRecentCalls(),
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

      <CrawlSupportBoard data={data} issues={issues} staff={staff} calls={calls} />
    </div>
  );
}

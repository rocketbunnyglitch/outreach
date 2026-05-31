import { requireAdmin } from "@/lib/auth";
import { loadBestSendTime } from "@/lib/template-analytics";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * /admin/analytics/send-time — 24-bar histogram of reply rate by
 * hour-of-day.
 *
 * Phase C.3 of the email-system audit. Helps operators answer
 * "what hour should I send at?" with their own data instead of
 * vibes. Renders bars proportional to reply rate (not send
 * volume) so a hour where you've sent 5 times with 80% reply
 * rate shows as taller than an hour where you've sent 50 times
 * with 20% reply rate.
 */
export default async function SendTimeAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { staff } = await requireAdmin();
  const params = await searchParams;
  const windowDays = Number(params.window ?? "90");
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 90;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const buckets = await loadBestSendTime({
    teamId: staff.teamId,
    timezone: "America/Toronto",
    from,
  });

  // Max reply rate across the day — used to normalize bar heights.
  // Falls back to 1 when all rates are zero so the chart doesn't
  // divide by zero.
  const maxRate = Math.max(0.01, ...buckets.map((b) => b.replyRate));

  const totalSends = buckets.reduce((sum, b) => sum + b.sentCount, 0);

  // Highlight the top hour(s) — every hour within 90% of the
  // peak reply rate. Helps operators see "send between 9-11am"
  // not "send at 10am sharp" since the data has noise.
  const topThreshold = maxRate * 0.9;

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
            admin · best send time
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">Send time</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Reply rate by hour of day, America/Toronto, last {days} days
            {totalSends > 0 && ` · ${totalSends.toLocaleString()} sends`}.
          </p>
        </div>
        <WindowPicker active={days} />
      </header>

      {totalSends === 0 ? (
        <div className="rounded-xl border border-zinc-200 border-dashed bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
          <p className="text-sm text-zinc-500">No cold sends in the last {days} days.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-64 items-end gap-1">
            {buckets.map((b) => {
              const heightPct = maxRate > 0 ? Math.max(2, (b.replyRate / maxRate) * 100) : 2;
              const isTop = b.replyRate > 0 && b.replyRate >= topThreshold;
              const isEmpty = b.sentCount === 0;
              return (
                <div key={b.hour} className="group relative flex flex-1 flex-col items-center">
                  <div className="absolute bottom-full mb-1 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 font-mono text-[10px] text-white shadow-lg group-hover:block dark:bg-zinc-100 dark:text-zinc-900">
                    {formatHour(b.hour)} · {b.sentCount} sent · {b.replyCount} replied (
                    {(b.replyRate * 100).toFixed(1)}%)
                  </div>
                  <div
                    className={`w-full rounded-t-sm transition-colors ${
                      isEmpty
                        ? "bg-zinc-100 dark:bg-zinc-900"
                        : isTop
                          ? "bg-emerald-500 dark:bg-emerald-400"
                          : "bg-violet-400 dark:bg-violet-500"
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1">
            {buckets.map((b) => (
              <div key={b.hour} className="flex flex-1 justify-center">
                {b.hour % 3 === 0 && (
                  <span className="font-mono text-[10px] text-zinc-500">{b.hour}</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              best hours (within 90% of peak)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" />
              other hours with sends
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-200 dark:bg-zinc-800" />
              no sends
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

function WindowPicker({ active }: { active: number }) {
  const opts = [30, 60, 90, 180];
  return (
    <nav className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
      {opts.map((d) => (
        <Link
          key={d}
          href={`/admin/analytics/send-time?window=${d}`}
          className={`rounded-md px-2.5 py-1 font-mono text-[11px] ${
            d === active
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {d}d
        </Link>
      ))}
    </nav>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

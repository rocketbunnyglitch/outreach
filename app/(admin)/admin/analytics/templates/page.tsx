import { requireAdmin } from "@/lib/auth";
import { loadTemplatePerformance } from "@/lib/template-analytics";
import { Sparkles } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * /admin/analytics/templates — per-template performance.
 *
 * Phase C.1 of the email-system audit. Shows reply rate, warm
 * rate, decline rate, median time-to-reply for every template
 * sent in the window. Sample-size aware: templates with fewer
 * than 10 sends are tagged low-sample so operators don't make
 * decisions on noise.
 */
export default async function TemplateAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { staff } = await requireAdmin();
  const params = await searchParams;
  const windowDays = Number(params.window ?? "90");
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 90;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await loadTemplatePerformance({
    teamId: staff.teamId,
    from,
  });

  // Pre-sort by reply rate among non-low-sample rows; low-sample
  // rows fall to the bottom so they don't crowd out trustworthy
  // performers. Ties broken by sentCount DESC.
  const sorted = [...rows].sort((a, b) => {
    if (a.lowSample !== b.lowSample) return a.lowSample ? 1 : -1;
    if (a.replyRate !== b.replyRate) return b.replyRate - a.replyRate;
    return b.sentCount - a.sentCount;
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
            admin · template performance
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Per-template reply, warm, and decline rates over the last {days} days.
          </p>
        </div>
        <WindowPicker active={days} />
      </header>

      {sorted.length === 0 ? (
        <EmptyState days={days} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="border-zinc-200 border-b bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
              <tr className="text-left text-zinc-500">
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider">
                  Template
                </th>
                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-wider">
                  Sent
                </th>
                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-wider">
                  Reply rate
                </th>
                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-wider">
                  Warm rate
                </th>
                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-wider">
                  Decline rate
                </th>
                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-wider">
                  Median h→reply
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.templateId ?? "none"}
                  className={`border-zinc-100 border-t text-zinc-900 dark:border-zinc-900 dark:text-zinc-100 ${
                    r.lowSample ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.templateName}</span>
                      {r.lowSample && (
                        <span
                          title={`Only ${r.sentCount} sends — too few for reliable comparison`}
                          className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[9px] text-amber-800 uppercase tracking-wider dark:bg-amber-950/40 dark:text-amber-200"
                        >
                          low sample
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.sentCount}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatPct(r.replyRate)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {formatPct(r.warmRate)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-rose-600 dark:text-rose-400">
                    {formatPct(r.declineRate)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {r.medianHoursToReply !== null ? `${r.medianHoursToReply.toFixed(1)}h` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        <span>
          Tip: a low decline rate AND high warm rate beats a high reply rate — replies that are
          mostly "not interested" hurt deliverability.
        </span>
      </div>
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
          href={`/admin/analytics/templates?window=${d}`}
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

function EmptyState({ days }: { days: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 border-dashed bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
      <p className="text-sm text-zinc-500">No template-attributed sends in the last {days} days.</p>
      <p className="mt-2 text-xs text-zinc-400">
        Template tracking starts when migration 0071 runs. Existing sends show as "(no template)"
        since the data wasn't captured at send time.
      </p>
    </div>
  );
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

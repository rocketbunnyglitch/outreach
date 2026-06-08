import { requireAdmin } from "@/lib/auth";
import {
  BOUNCE_RATE_LIMIT,
  COMPLAINT_RATE_LIMIT,
  loadInboxDeliverability,
} from "@/lib/inbox-deliverability";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AutoPauseButton, PauseToggle, WarmupToggle } from "./_components/inbox-controls";

export const metadata = { title: "Deliverability" };
export const dynamic = "force-dynamic";

function pct(n: number): string {
  return `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`;
}

export default async function DeliverabilityPage() {
  const ctx = await requireAdmin();
  const inboxes = await loadInboxDeliverability(ctx.staff.teamId, 7);
  const atRisk = inboxes.filter((i) => i.atRisk).length;

  return (
    <div className="mx-auto flex max-w-5xl animate-[fade-in_300ms_ease-out] flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3 w-3" /> Admin
        </Link>
        <h1 className="inline-flex items-center gap-2.5 font-semibold text-4xl tracking-tight">
          <ShieldCheck className="h-7 w-7 text-emerald-500" />
          Deliverability
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 leading-relaxed dark:text-zinc-400">
          Per-inbox send volume, bounce + spam-complaint rates (last 7 days), and warm-up status. A
          burning inbox can torch the whole sending domain. Bounce limit {pct(BOUNCE_RATE_LIMIT)},
          complaint limit {pct(COMPLAINT_RATE_LIMIT)}. Pausing an inbox blocks its COLD sends; warm
          replies still go.
        </p>
      </header>

      {atRisk > 0 && (
        <section className="flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/60 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-950/30">
          <p className="text-rose-900 text-sm dark:text-rose-100">
            <span className="font-semibold">
              {atRisk} inbox{atRisk === 1 ? "" : "es"} over a deliverability limit.
            </span>{" "}
            Pause cold sends until the rate recovers.
          </p>
          <AutoPauseButton />
        </section>
      )}

      <section className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
                <th className="px-4 py-2 font-normal">Inbox</th>
                <th className="px-3 py-2 text-right font-normal">Sent 7d</th>
                <th className="px-3 py-2 text-right font-normal">Bounce</th>
                <th className="px-3 py-2 text-right font-normal">Complaint</th>
                <th className="px-3 py-2 text-right font-normal">Daily cap</th>
                <th className="px-4 py-2 text-right font-normal">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
              {inboxes.map((i) => (
                <tr
                  key={i.id}
                  className={i.atRisk ? "bg-rose-50/40 dark:bg-rose-950/20" : undefined}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
                        {i.email}
                      </span>
                      {i.paused && (
                        <span className="rounded bg-rose-100 px-1 font-medium text-[9px] text-rose-700 uppercase dark:bg-rose-900/40 dark:text-rose-300">
                          paused
                        </span>
                      )}
                      {i.warming && (
                        <span className="rounded bg-amber-100 px-1 font-medium text-[9px] text-amber-800 uppercase dark:bg-amber-900/40 dark:text-amber-300">
                          warming d{i.warmupDaysIn}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                    {i.sent.toLocaleString()}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${
                      i.bounceRate > BOUNCE_RATE_LIMIT
                        ? "font-semibold text-rose-600 dark:text-rose-400"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {i.bounced > 0 ? `${pct(i.bounceRate)} (${i.bounced})` : "—"}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${
                      i.complaintRate > COMPLAINT_RATE_LIMIT
                        ? "font-semibold text-rose-600 dark:text-rose-400"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {i.complained > 0 ? `${pct(i.complaintRate)} (${i.complained})` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                    {i.effectiveCap}
                    {i.warming && <span className="text-zinc-400">/{i.configuredCap}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <WarmupToggle id={i.id} warming={i.warming} />
                      <PauseToggle id={i.id} paused={i.paused} />
                    </div>
                  </td>
                </tr>
              ))}
              {inboxes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                    No connected inboxes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Bounce/complaint rates are attributed to the inbox that sent the offending message (via the
        suppression's source thread). Newly-connected inboxes warm up automatically over ~3 weeks.
      </p>
    </div>
  );
}

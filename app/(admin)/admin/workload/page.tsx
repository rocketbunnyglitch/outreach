/**
 * /admin/workload — staff workload + accountability (CRM plan C3).
 *
 * One screen for the manager question "who is overloaded, who is idle,
 * and where do I reassign?": per active staffer — open/overdue tasks,
 * needs-reply load (with how many are rotting past 4h), cities led and
 * how many of those are at risk, what they cleared in the last 7 days,
 * and a 14-day median reply-time proxy. Rows are graded by the same
 * pure workload core the tests cover; worst rows sort first.
 *
 * Deliberately NO venues-confirmed leaderboard — confirmed-count
 * competition incentivizes fake confirms (the stage gates exist
 * because of exactly that).
 */

import { requireAdmin } from "@/lib/auth";
import { loadStaffWorkload } from "@/lib/workload-data";
import { AlertTriangle, ArrowRight, Users } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Workload · Admin" };
export const dynamic = "force-dynamic";

const COLOR_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
};

const COLOR_RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 };

export default async function WorkloadPage() {
  await requireAdmin();
  const rows = await loadStaffWorkload(null);
  rows.sort((a, b) => {
    const rank = (COLOR_RANK[a.health.color] ?? 3) - (COLOR_RANK[b.health.color] ?? 3);
    if (rank !== 0) return rank;
    return b.openTasks + b.needsReplyThreads - (a.openTasks + a.needsReplyThreads);
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Users className="h-5 w-5 text-zinc-400" />
        <div>
          <h1 className="font-semibold text-xl tracking-tight">Staff workload</h1>
          <p className="text-sm text-zinc-500">
            Who is overloaded, who has room, and what is rotting on whose plate. Reassign tasks from
            the{" "}
            <Link className="underline" href="/tasks">
              tasks board
            </Link>
            ; reassign threads from the{" "}
            <Link className="underline" href="/inbox">
              inbox
            </Link>
            ; city leads change on each city sheet.
          </p>
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-zinc-200 border-b bg-zinc-50 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] dark:border-zinc-800 dark:bg-zinc-900/60">
              <th className="px-4 py-2.5">Staffer</th>
              <th className="px-3 py-2.5">Open tasks</th>
              <th className="px-3 py-2.5">Overdue</th>
              <th className="px-3 py-2.5">Needs reply</th>
              <th className="px-3 py-2.5">Rotting &gt;4h</th>
              <th className="px-3 py-2.5">Cities led</th>
              <th className="px-3 py-2.5">At-risk cities</th>
              <th className="px-3 py-2.5">Cleared 7d</th>
              <th className="px-3 py-2.5">Median reply</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.staffId}
                className="border-zinc-100 border-b last:border-0 dark:border-zinc-900"
              >
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <span
                      className={`h-2 w-2 rounded-full ${COLOR_DOT[r.health.color] ?? "bg-zinc-300"}`}
                      title={`${r.health.statusLabel}${r.health.nextAction ? ` — ${r.health.nextAction}` : ""}`}
                    />
                    {r.displayName}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono">{r.openTasks}</td>
                <td className="px-3 py-2.5 font-mono">
                  {r.overdueTasks > 0 ? (
                    <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="h-3 w-3" />
                      {r.overdueTasks}
                    </span>
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono">{r.needsReplyThreads}</td>
                <td className="px-3 py-2.5 font-mono">
                  {r.rottingReplies > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400">{r.rottingReplies}</span>
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono">{r.citiesLed}</td>
                <td className="px-3 py-2.5 font-mono">
                  {r.riskyCities > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400">{r.riskyCities}</span>
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-zinc-500">{r.tasksCleared7d}</td>
                <td className="px-3 py-2.5 font-mono text-zinc-500">
                  {r.medianReplyHours == null ? "—" : `${r.medianReplyHours}h`}
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={`/admin/analytics/${r.staffId}`}
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    Detail <ArrowRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-zinc-500">
                  No active staff.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400">
        Median reply = median hours from a venue's last inbound to our outbound on threads assigned
        to the staffer, last 14 days. There is intentionally no confirmed-venues leaderboard here —
        speed-of-care metrics over volume metrics.
      </p>
    </div>
  );
}

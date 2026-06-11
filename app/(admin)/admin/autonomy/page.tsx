import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { AUTONOMY_THRESHOLDS, getAutonomyDashboard, isDispatchEnabled } from "@/lib/autonomy";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { ModeSelect } from "./_components/mode-select";

export const metadata = { title: "Autonomy" };
export const dynamic = "force-dynamic";

/**
 * The trust ladder dashboard (2026-06-11): per engine action type, how
 * often humans agreed with the engine's proposal over the last 30
 * days, against the graduation thresholds. Admins flip modes here —
 * the engine never grants itself autonomy, and actual autonomous
 * dispatch additionally requires AUTONOMY_DISPATCH_ENABLED on the
 * server (deliberately unset until the evidence review).
 */
export default async function AutonomyPage() {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) redirect("/");

  const rows = await getAutonomyDashboard();
  const dispatchOn = isDispatchEnabled();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Autonomy</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Every engine proposal gets a recorded human verdict. When an action type proves itself (
          {Math.round(AUTONOMY_THRESHOLDS.review_window.minAgreement * 100)}%+ agreement over{" "}
          {AUTONOMY_THRESHOLDS.review_window.minSamples}+ samples), it becomes eligible for the next
          rung. Graduation is always a human decision made here.
        </p>
      </header>

      <div
        className={`flex items-start gap-2.5 rounded-xl border p-4 text-sm ${
          dispatchOn
            ? "border-amber-300/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20"
            : "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-950/20"
        }`}
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold">
            Autonomous dispatch is {dispatchOn ? "ENABLED" : "OFF"} at the server level.
          </span>{" "}
          {dispatchOn
            ? "Policies set to review-window or auto can act."
            : "Mode flips below record intent and start nothing — the engine still drafts, humans still send, regardless of mode. Dispatch requires AUTONOMY_DISPATCH_ENABLED=1 on the server after an evidence review."}
        </p>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3 text-right">Verdicts (30d)</th>
              <th className="px-4 py-3 text-right">Agreement</th>
              <th className="px-4 py-3">Eligible for</th>
              <th className="px-4 py-3">Current mode</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
            {rows.map((row) => (
              <tr key={row.actionType}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.label}</p>
                  {row.notes && <p className="mt-0.5 text-xs text-zinc-500">{row.notes}</p>}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {row.samples30d}
                  {row.samples30d > 0 && (
                    <span className="ml-1.5 text-[10px] text-zinc-500">
                      ({row.accepted30d}✓ {row.edited30d}± {row.rejected30d}✗)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {row.agreementRate30d === null ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <span
                      className={
                        row.agreementRate30d >= AUTONOMY_THRESHOLDS.review_window.minAgreement
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-700 dark:text-zinc-300"
                      }
                    >
                      {(row.agreementRate30d * 100).toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset ${
                      row.eligibleFor === "auto"
                        ? "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                        : row.eligibleFor === "review_window"
                          ? "bg-blue-500/15 text-blue-700 ring-blue-500/25 dark:text-blue-300"
                          : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300"
                    }`}
                  >
                    {row.eligibleFor.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ModeSelect actionType={row.actionType} current={row.mode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-3xl text-xs text-zinc-500">
        Thresholds: review-window needs{" "}
        {Math.round(AUTONOMY_THRESHOLDS.review_window.minAgreement * 100)}% agreement over{" "}
        {AUTONOMY_THRESHOLDS.review_window.minSamples}+ verdicts; full auto needs{" "}
        {Math.round(AUTONOMY_THRESHOLDS.auto.minAgreement * 100)}% over{" "}
        {AUTONOMY_THRESHOLDS.auto.minSamples}+. Agreement = the human did not reject the engine's
        proposal (sent as-is or with edits / confirmed the label / kept the picked template).
      </p>
    </div>
  );
}

import { loadAiUsageSummary } from "@/lib/ai-usage";
import { requireAdmin } from "@/lib/auth";
import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "AI usage" };
export const dynamic = "force-dynamic";

/**
 * Admin AI spend log. Reads the append-only ai_usage_events table (one row per
 * Anthropic completion, written from lib/ai.ts) and shows where the money goes:
 * rolling-window totals, a 30-day projection, per-day, per-feature, and
 * per-model breakdowns.
 *
 * Cost is a snapshot computed at insert time from the price table in
 * lib/ai-usage.ts -- token counts are exact, the dollar figure is an estimate
 * tied to Anthropic's list prices.
 */
export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const windowDays = sp.window === "7" ? 7 : sp.window === "90" ? 90 : 30;
  const summary = await loadAiUsageSummary(windowDays);

  return (
    <div className="mx-auto flex max-w-5xl animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3 w-3" /> Admin
        </Link>
        <h1 className="inline-flex items-center gap-2.5 font-semibold text-4xl tracking-tight">
          <Sparkles className="h-7 w-7 text-violet-500" />
          AI usage
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 leading-relaxed dark:text-zinc-400">
          Every Anthropic call is logged with exact token counts. Dollar figures are estimates from
          list prices (editable in <code className="text-xs">lib/ai-usage.ts</code>). Token counts
          are exact.
        </p>
      </header>

      {/* Rolling-window headline cards */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SpendCard label="Last 24 hours" value={summary.cost24h} />
        <SpendCard label="Last 7 days" value={summary.cost7d} />
        <SpendCard label="Last 30 days" value={summary.cost30d} />
        <SpendCard
          label="Projected / month"
          value={summary.projectedMonthlyUsd}
          hint="7-day run-rate × 30"
          accent
        />
      </section>

      {/* Window switcher */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          Breakdown window
        </span>
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            href={`/admin/ai-usage?window=${d}`}
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
              windowDays === d
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {d}d
          </Link>
        ))}
        <span className="ml-auto font-mono text-[11px] text-zinc-500 tabular-nums">
          {summary.window.calls.toLocaleString()} calls ·{" "}
          {fmtTokens(summary.window.inputTokens + summary.window.outputTokens)} tok ·{" "}
          {fmtUsd(summary.window.costUsd)} · all-time {fmtUsd(summary.costAllTime)}
        </span>
      </div>

      {summary.window.calls === 0 ? (
        <section className="card-surface px-6 py-12 text-center">
          <p className="font-medium text-sm text-zinc-700 dark:text-zinc-300">
            No AI calls in this window yet
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Spend will appear here as the engine classifies replies, drafts emails, and runs other
            AI features.
          </p>
        </section>
      ) : (
        <>
          {/* By feature */}
          <BreakdownTable
            title="By feature"
            subtitle="Which AI features cost the most. inbox_auto_classify is usually the biggest after a send blast."
            rows={summary.byTag.map((t) => ({
              key: t.tag,
              label: t.tag,
              calls: t.calls,
              tokens: t.inputTokens + t.outputTokens,
              costUsd: t.costUsd,
            }))}
            totalCost={summary.window.costUsd}
          />

          {/* By model */}
          <BreakdownTable
            title="By model"
            subtitle="Opus is ~15× the price of Haiku per token — watch for unexpected Opus usage."
            rows={summary.byModel.map((m) => ({
              key: m.model,
              label: m.model,
              calls: m.calls,
              tokens: m.inputTokens + m.outputTokens,
              costUsd: m.costUsd,
            }))}
            totalCost={summary.window.costUsd}
          />

          {/* Per day */}
          <PerDayTable byDay={summary.byDay} />
        </>
      )}
    </div>
  );
}

function SpendCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex h-full flex-col justify-between rounded-2xl border p-4 shadow-sm ${
        accent
          ? "border-violet-300 bg-violet-50/60 dark:border-violet-900/40 dark:bg-violet-950/20"
          : "border-zinc-200/80 bg-white dark:border-zinc-800/60 dark:bg-zinc-950/60"
      }`}
    >
      <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">{label}</div>
      <div className="mt-3 font-mono font-semibold text-3xl text-zinc-900 tabular-nums tracking-tight dark:text-zinc-100">
        {fmtUsd(value)}
      </div>
      {hint && <div className="mt-1 font-mono text-[10px] text-zinc-400">{hint}</div>}
    </div>
  );
}

function BreakdownTable({
  title,
  subtitle,
  rows,
  totalCost,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ key: string; label: string; calls: number; tokens: number; costUsd: number }>;
  totalCost: number;
}) {
  return (
    <section className="card-surface overflow-hidden">
      <header className="border-zinc-200/60 border-b px-6 py-4 dark:border-zinc-800/40">
        <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{subtitle}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
              <th className="px-6 py-2 font-normal">Name</th>
              <th className="px-3 py-2 text-right font-normal">Calls</th>
              <th className="px-3 py-2 text-right font-normal">Tokens</th>
              <th className="px-3 py-2 text-right font-normal">Cost</th>
              <th className="px-6 py-2 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40">
                <td className="px-6 py-2.5 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                  {r.label}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  {r.calls.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  {fmtTokens(r.tokens)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                  {fmtUsd(r.costUsd)}
                </td>
                <td className="px-6 py-2.5 text-right font-mono text-[11px] tabular-nums text-zinc-500">
                  {totalCost > 0 ? `${Math.round((r.costUsd / totalCost) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PerDayTable({ byDay }: { byDay: Array<{ day: string; calls: number; costUsd: number }> }) {
  const max = Math.max(0.000001, ...byDay.map((d) => d.costUsd));
  return (
    <section className="card-surface overflow-hidden">
      <header className="border-zinc-200/60 border-b px-6 py-4 dark:border-zinc-800/40">
        <h2 className="font-semibold text-lg tracking-tight">Per day</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Daily spend (most recent first). Bars are relative to the peak day in the window.
        </p>
      </header>
      <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
        {byDay.map((d) => (
          <li key={d.day} className="flex items-center gap-3 px-6 py-2">
            <span className="w-24 font-mono text-[11px] text-zinc-500 tabular-nums">{d.day}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
              <div
                className="h-full rounded-full bg-violet-400 dark:bg-violet-500"
                style={{ width: `${Math.max(2, Math.round((d.costUsd / max) * 100))}%` }}
              />
            </div>
            <span className="w-20 text-right font-mono text-[11px] text-zinc-500 tabular-nums">
              {d.calls.toLocaleString()}
            </span>
            <span className="w-20 text-right font-mono text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {fmtUsd(d.costUsd)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

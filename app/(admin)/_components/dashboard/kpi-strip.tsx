import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Sparkline } from "./sparkline";

export interface Kpi {
  label: string;
  value: string;
  /** Trailing tiny indicator e.g. "+12%" or "8/12". */
  meta?: string;
  /** Direction badge color. */
  trend?: "up" | "down" | "flat";
  /** 14-day sparkline data. */
  series?: number[];
  /** Plain-language explanation shown on hover (for naive users). */
  tooltip?: string;
}

interface Props {
  kpis: Kpi[];
}

/**
 * The strip of compact metric cards across the top of the dashboard.
 * Visual model lifted from financial trading dashboards — each card has:
 *   - small uppercase label
 *   - big number
 *   - subtle trend badge + sparkline
 */
export function KpiStrip({ kpis }: Props) {
  return (
    <div className="card-surface grid grid-cols-2 gap-px overflow-hidden bg-zinc-200 sm:grid-cols-4 lg:grid-cols-5 dark:bg-zinc-800/40">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} kpi={kpi} />
      ))}
    </div>
  );
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const sparkColor = kpi.trend === "down" ? "text-rose-500" : "text-emerald-500";

  return (
    <div className="flex flex-col gap-3 bg-zinc-50 p-4 dark:bg-transparent" title={kpi.tooltip}>
      <div className="flex items-start justify-between gap-2">
        <p
          className={`font-mono text-[10px] text-zinc-500 uppercase tracking-widest${kpi.tooltip ? " cursor-help decoration-dotted underline-offset-2 hover:underline" : ""}`}
        >
          {kpi.label}
        </p>
        {kpi.trend && kpi.trend !== "flat" && <TrendBadge trend={kpi.trend} meta={kpi.meta} />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="font-medium font-mono text-2xl tabular-nums leading-none tracking-tight">
          {kpi.value}
        </p>
        {kpi.series && kpi.series.length > 0 && (
          <Sparkline
            values={kpi.series}
            colorClass={sparkColor}
            width={80}
            showEndDot
            label={`${kpi.label} trend`}
          />
        )}
      </div>
      {kpi.meta && (!kpi.trend || kpi.trend === "flat") && (
        <p className="font-mono text-[11px] text-zinc-500">{kpi.meta}</p>
      )}
    </div>
  );
}

function TrendBadge({ trend, meta }: { trend: "up" | "down"; meta?: string }) {
  const colors =
    trend === "up" ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10";
  const Icon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${colors}`}
    >
      <Icon className="h-3 w-3" />
      {meta}
    </span>
  );
}

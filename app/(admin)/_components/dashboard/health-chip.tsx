import type { HealthColor } from "@/lib/health-score-core";

/**
 * Small status chip for a health color. Presentational + dependency-free (only
 * the pure HealthColor type), so it is safe in server OR client components and
 * carries no hydration risk. Matches the tracker aesthetic: mono, tabular
 * score, a dot rather than a noisy filled banner.
 */

const CHIP: Record<HealthColor, string> = {
  green:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400 dark:ring-emerald-400/20",
  yellow:
    "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400 dark:ring-amber-400/20",
  red: "bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-400 dark:ring-rose-400/20",
};

const DOT: Record<HealthColor, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
};

export function HealthChip({
  color,
  label,
  score,
}: {
  color: HealthColor;
  label?: string;
  score?: number;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset ${CHIP[color]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[color]}`} />
      {label ?? color}
      {typeof score === "number" && <span className="tabular-nums opacity-70">{score}</span>}
    </span>
  );
}

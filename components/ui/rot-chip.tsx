"use client";

/**
 * RotChip — in-place "this row is rotting" indicator (CRM plan C2).
 *
 * Renders nothing until the row crosses its kind's warn threshold
 * (lib/rot.ts — the SAME thresholds the aging-watchdog cron uses), then
 * a compact amber → orange → red age chip. Drop it next to any list-row
 * title; it's intentionally quiet so a healthy list shows no chips at
 * all.
 */

import { type RotKind, formatRotAge, rotSeverity } from "@/lib/rot";
import { Hourglass } from "lucide-react";

const SEVERITY_CLASS: Record<string, string> = {
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  late: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  critical: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

const SEVERITY_TITLE: Record<string, string> = {
  warn: "Waiting longer than it should",
  late: "Clearly late — handle today",
  critical: "Critical — the watchdog is escalating this",
};

export function RotChip({
  kind,
  ageHours,
  className,
}: {
  kind: RotKind;
  ageHours: number;
  className?: string;
}) {
  const severity = rotSeverity(kind, ageHours);
  if (severity === "none") return null;
  return (
    <span
      title={SEVERITY_TITLE[severity]}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] ${SEVERITY_CLASS[severity]} ${className ?? ""}`}
    >
      <Hourglass className="h-2.5 w-2.5" />
      {formatRotAge(ageHours)}
    </span>
  );
}

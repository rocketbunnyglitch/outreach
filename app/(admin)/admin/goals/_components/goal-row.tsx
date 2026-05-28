"use client";

/**
 * GoalRow — one editable row on /admin/goals.
 *
 * Inline form per row (rather than one big form for all rows) so
 * each save is independent: an error on one campaign doesn't lose
 * unsaved input on others. The pattern mirrors the inline-cell
 * edits used elsewhere in the admin.
 */

import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/form-utils";
import { Check, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";

interface Props {
  campaignId: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  current: number;
  target: number | null;
  action: (prev: unknown, formData: FormData) => Promise<ActionResult<{ campaignId: string }>>;
}

const STATUS_TONE: Record<string, string> = {
  planning: "text-zinc-500",
  active: "text-emerald-600 dark:text-emerald-400",
  completed: "text-blue-600 dark:text-blue-400",
  archived: "text-zinc-400 line-through",
};

export function GoalRow({
  campaignId,
  name,
  status,
  startDate,
  endDate,
  current,
  target,
  action,
}: Props) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ campaignId: string }> | null,
    FormData
  >(action, null);

  // Local state for the input so the operator's edits don't get
  // clobbered by a parent re-render before they save.
  const [draft, setDraft] = useState<string>(target != null ? String(target) : "");

  const showJustSaved = state?.ok === true;

  // Progress percentage — capped at 100% for display purposes.
  // The underlying number can exceed target (a campaign can over-sell).
  let progressLabel = "—";
  let progressTone = "text-zinc-400";
  if (target != null && target > 0) {
    const pct = Math.round((current / target) * 100);
    progressLabel = `${pct}%`;
    progressTone =
      pct >= 100
        ? "text-emerald-600 dark:text-emerald-400"
        : pct >= 75
          ? "text-blue-600 dark:text-blue-400"
          : pct >= 50
            ? "text-amber-600 dark:text-amber-400"
            : "text-rose-600 dark:text-rose-400";
  }

  return (
    <tr className="border-zinc-200/60 border-b last:border-b-0 dark:border-zinc-800/40">
      <td className="px-4 py-2.5 align-top">
        <div className="font-medium">{name}</div>
        {(startDate || endDate) && (
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {startDate ?? "—"} → {endDate ?? "—"}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 align-top">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-widest",
            STATUS_TONE[status] ?? "text-zinc-500",
          )}
        >
          {status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono tabular-nums">
        {current.toLocaleString()}
      </td>
      <td className="px-4 py-2.5 text-right align-top">
        <form action={formAction} className="inline-flex items-center justify-end gap-1.5">
          <input type="hidden" name="campaignId" value={campaignId} />
          <input
            type="number"
            name="targetTicketSalesCount"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            min={0}
            max={1_000_000}
            placeholder="—"
            disabled={pending}
            className={cn(
              "w-24 rounded-md border border-zinc-200 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          />
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "rounded-md p-1 text-zinc-400 transition-colors",
              "hover:bg-zinc-100 hover:text-zinc-700",
              "dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
              pending && "cursor-not-allowed opacity-50",
            )}
            title="Save"
            aria-label="Save goal"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : showJustSaved ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
        </form>
      </td>
      <td className={cn("px-4 py-2.5 text-right align-top font-mono tabular-nums", progressTone)}>
        {progressLabel}
      </td>
      <td className="px-4 py-2.5 text-right align-top">
        {state && !state.ok && state.error && (
          <span
            className="font-mono text-[10px] text-rose-600 dark:text-rose-400"
            title={state.error}
          >
            error
          </span>
        )}
      </td>
    </tr>
  );
}

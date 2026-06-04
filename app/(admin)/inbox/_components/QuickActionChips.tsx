"use client";

/**
 * Quick-action chips (Phase 2.11) above the reply controls. One-click common
 * state transitions that combine classification + thread state + cadence_state
 * so the operator can triage and move on; the thread drops out of their
 * worklist immediately. Backed by the applyQuickAction server action.
 *
 * Assignment ("Assign to...") is intentionally NOT duplicated here -- the
 * thread header already carries the AssignmentPicker control.
 *
 * DEFERRED: "Cancelled" records the cancelled_by_them state; the downstream
 * cancellation cascade is Phase 4. "Hard no" sets opt_out_permanent for this
 * thread but not a venue-wide do-not-contact. [ReferenceDoc Section 6]
 */

import { cn } from "@/lib/cn";
import { CalendarX, CircleCheck, Clock, Loader2, MessageSquareX, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyQuickAction } from "../_actions";

type QuickAction = "engaged" | "soft_no" | "hard_no" | "cancelled" | "snooze_5d";

const CHIPS: Array<{
  action: QuickAction;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    action: "engaged",
    label: "Engaged",
    icon: CircleCheck,
    tone: "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
  },
  {
    action: "soft_no",
    label: "Soft no",
    icon: MessageSquareX,
    tone: "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
  },
  {
    action: "hard_no",
    label: "Hard no",
    icon: Shield,
    tone: "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
  },
  {
    action: "cancelled",
    label: "Cancelled",
    icon: CalendarX,
    tone: "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-950/40",
  },
  {
    action: "snooze_5d",
    label: "Snooze 5 days",
    icon: Clock,
    tone: "border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-950/40",
  },
];

export function QuickActionChips({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [active, setActive] = useState<QuickAction | null>(null);

  function run(action: QuickAction) {
    setActive(action);
    startTx(async () => {
      const res = await applyQuickAction(threadId, action);
      setActive(null);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-zinc-200/60 border-t bg-zinc-50/40 px-5 py-2 dark:border-zinc-800/60 dark:bg-zinc-900/30">
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
        Quick actions
      </span>
      {CHIPS.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.action}
            type="button"
            onClick={() => run(c.action)}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50",
              c.tone,
            )}
          >
            {pending && active === c.action ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Icon className="h-3 w-3" />
            )}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

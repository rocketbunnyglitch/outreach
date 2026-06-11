"use client";

/**
 * ClassificationPicker — inline dropdown on the thread header for the
 * operator to override the triage classifier's guess (or pick one when
 * the thread is still 'unclassified').
 *
 * Mirrors Gmail's category chips: small colored pill, click to swap.
 * The classifier sets an initial value on ingestion; this only changes
 * something if the operator disagrees. Once changed, the Gmail poller
 * won't overwrite it (it only auto-updates threads that are still
 * 'unclassified').
 */

import { cn } from "@/lib/cn";
import {
  AlertCircle,
  CalendarCheck,
  CalendarX,
  Check,
  CircleHelp,
  Flame,
  Hourglass,
  Loader2,
  Mail,
  MessageSquareX,
  Phone,
  Shield,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { setThreadClassification } from "../_actions";

type Classification =
  | "interested"
  | "warm"
  | "confirmed"
  | "question"
  | "callback_requested"
  | "decline"
  | "unsubscribe"
  | "auto_reply"
  | "spam"
  | "stalled_warm"
  | "cancelled_by_them"
  | "unclassified";

interface Props {
  threadId: string;
  current: Classification;
  /** AI-suggested classification — Phase A.1. When present AND
   *  the operator-confirmed value is 'unclassified', the picker
   *  renders a tiny pill next to the current value with the
   *  suggestion + a one-click confirm. Disappears once the
   *  operator confirms or overrides. */
  aiSuggestion?: {
    classification: Classification;
    confidence: number;
  } | null;
}

const OPTIONS: Array<{
  value: Classification;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    value: "interested",
    label: "Interested",
    icon: Sparkles,
    tone: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "warm",
    label: "Warm (questions)",
    icon: Flame,
    tone: "text-orange-600 dark:text-orange-400",
  },
  {
    value: "confirmed",
    label: "Confirmed",
    icon: CalendarCheck,
    tone: "text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "question",
    label: "Question",
    icon: CircleHelp,
    tone: "text-blue-600 dark:text-blue-400",
  },
  {
    value: "callback_requested",
    label: "Wants a call",
    icon: Phone,
    tone: "text-violet-600 dark:text-violet-400",
  },
  {
    value: "decline",
    label: "Decline",
    icon: MessageSquareX,
    tone: "text-rose-600 dark:text-rose-400",
  },
  {
    value: "unsubscribe",
    label: "Unsubscribe",
    icon: Shield,
    tone: "text-zinc-700 dark:text-zinc-300",
  },
  {
    value: "auto_reply",
    label: "Auto-reply",
    icon: Mail,
    tone: "text-zinc-500 dark:text-zinc-400",
  },
  {
    value: "spam",
    label: "Spam / bounce",
    icon: AlertCircle,
    tone: "text-zinc-500 dark:text-zinc-400",
  },
  {
    value: "stalled_warm",
    label: "Stalled warm",
    icon: Hourglass,
    tone: "text-amber-600 dark:text-amber-400",
  },
  {
    value: "cancelled_by_them",
    label: "Cancelled",
    icon: CalendarX,
    tone: "text-rose-600 dark:text-rose-400",
  },
  {
    value: "unclassified",
    label: "Unclassified",
    icon: CircleHelp,
    tone: "text-zinc-400 dark:text-zinc-600",
  },
];

export function ClassificationPicker({ threadId, current, aiSuggestion }: Props) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<Classification>(current);
  const [pending, startTx] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Sync when the server-side value changes (e.g. another tab updated it)
  useEffect(() => {
    setOptimistic(current);
  }, [current]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function choose(c: Classification) {
    setOpen(false);
    // Click the same classification again to toggle BACK to
    // "unclassified" — operators need a fast undo when they
    // misclick. Matches the same pattern as the state buttons
    // (Interested/Declined toggle off on second click).
    const next = c === optimistic ? "unclassified" : c;
    if (next === optimistic) return;
    setOptimistic(next);
    startTx(async () => {
      const result = await setThreadClassification(threadId, next);
      if (!result.ok) {
        // Revert on failure
        setOptimistic(current);
      }
    });
  }

  const currentOption = OPTIONS.find((o) => o.value === optimistic) ?? OPTIONS[OPTIONS.length - 1];
  if (!currentOption) return null;
  const CurrentIcon = currentOption.icon;

  // AI suggestion pill renders alongside the main picker, but only
  // when the thread is still unclassified AND the suggestion isn't
  // itself 'unclassified'. Disappears the instant the operator
  // confirms or overrides — clearing the suggestion is part of the
  // setThreadClassification server action.
  // 90% threshold (Phase 2.8): a confident suggestion gets a one-click
  // confirm pill; a low-confidence one drops to an all-categories triage
  // row so the operator classifies fast. Both only show while the thread
  // is still unclassified.
  const highConfidence = !!aiSuggestion && aiSuggestion.confidence >= 0.9;
  const showSuggestion =
    !!aiSuggestion &&
    highConfidence &&
    optimistic === "unclassified" &&
    aiSuggestion.classification !== "unclassified";
  const showLowConfTriage = !!aiSuggestion && !highConfidence && optimistic === "unclassified";
  const suggestedOption = showSuggestion
    ? OPTIONS.find((o) => o.value === aiSuggestion.classification)
    : null;
  const SuggestedIcon = suggestedOption?.icon ?? null;

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
          "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900",
          currentOption.tone,
        )}
        title="Change classification"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CurrentIcon className="h-3 w-3" />
        )}
        <span>{currentOption.label}</span>
      </button>

      {/* AI-suggested classification pill. One-click confirms.
          Renders only when the thread is unclassified + the AI
          actually returned a useful suggestion. Violet tone marks
          this as AI-assisted (per project color convention). */}
      {showSuggestion && suggestedOption && SuggestedIcon && aiSuggestion && (
        <button
          type="button"
          onClick={() => choose(suggestedOption.value)}
          disabled={pending}
          title={`AI suggests ${suggestedOption.label} (${Math.round(
            aiSuggestion.confidence * 100,
          )}% confident). Click to confirm.`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
            "border-violet-300/70 bg-violet-50 text-violet-700",
            "hover:bg-violet-100",
            "dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60",
          )}
        >
          <Sparkles className="h-2.5 w-2.5" />
          <SuggestedIcon className="h-2.5 w-2.5" />
          <span>{suggestedOption.label}</span>
          <span className="font-mono opacity-70">{Math.round(aiSuggestion.confidence * 100)}%</span>
        </button>
      )}

      {/* Low-confidence (<90%) triage row (Phase 2.8). The engine wasn't
          sure, so surface the categories as one-click buttons instead of a
          single confirm pill. */}
      {showLowConfTriage && aiSuggestion && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-3 w-3" />
            Engine unsure ({Math.round(aiSuggestion.confidence * 100)}%) - triage:
          </span>
          {(
            [
              ["interested", "Engaged"],
              ["decline", "Soft no"],
              ["unsubscribe", "Hard no"],
              ["stalled_warm", "Stalled warm"],
              ["cancelled_by_them", "Cancelled"],
              ["question", "Question"],
            ] as Array<[Classification, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => choose(value)}
              disabled={pending}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={pending}
            className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Other
          </button>
        </div>
      )}

      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-1 shadow-lg",
            "dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <p className="px-2.5 py-1.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
            Classify this thread
          </p>
          <ul className="flex flex-col">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = opt.value === optimistic;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => choose(opt.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                      "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    )}
                  >
                    <span className={cn("inline-flex items-center gap-2", opt.tone)}>
                      <Icon className="h-3 w-3" />
                      {opt.label}
                    </span>
                    {selected && <Check className="h-3 w-3 text-emerald-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

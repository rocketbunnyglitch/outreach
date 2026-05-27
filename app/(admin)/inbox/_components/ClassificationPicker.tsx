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
  Check,
  CircleHelp,
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
  | "question"
  | "callback_requested"
  | "decline"
  | "unsubscribe"
  | "auto_reply"
  | "spam"
  | "unclassified";

interface Props {
  threadId: string;
  current: Classification;
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
    value: "unclassified",
    label: "Unclassified",
    icon: CircleHelp,
    tone: "text-zinc-400 dark:text-zinc-600",
  },
];

export function ClassificationPicker({ threadId, current }: Props) {
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
    if (c === optimistic) return;
    setOptimistic(c);
    startTx(async () => {
      const result = await setThreadClassification(threadId, c);
      if (!result.ok) {
        // Revert on failure
        setOptimistic(current);
      }
    });
  }

  const currentOption = OPTIONS.find((o) => o.value === optimistic) ?? OPTIONS[OPTIONS.length - 1];
  if (!currentOption) return null;
  const CurrentIcon = currentOption.icon;

  return (
    <div ref={ref} className="relative">
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
      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg",
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

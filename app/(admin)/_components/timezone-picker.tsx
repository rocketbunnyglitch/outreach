"use client";

/**
 * TimezonePicker — small dropdown of common timezones the operators
 * actually use, plus a free-text fallback for anything else.
 *
 * The team's current makeup is Toronto + Manila, so those are the top
 * two. Other common business hubs included so it covers most calls.
 *
 * When the operator picks one, we hit setStaffTimezone server action,
 * which validates via Intl.DateTimeFormat (any IANA tz the runtime
 * knows is acceptable). On success the page revalidates so all
 * "in your time" displays update without a refresh.
 */

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Check, Globe, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { setStaffTimezone } from "../_actions";

const COMMON_TIMEZONES: Array<{ id: string; label: string }> = [
  { id: "America/Toronto", label: "Toronto (Eastern)" },
  { id: "America/New_York", label: "New York (Eastern)" },
  { id: "America/Chicago", label: "Chicago (Central)" },
  { id: "America/Denver", label: "Denver (Mountain)" },
  { id: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
  { id: "Asia/Manila", label: "Manila (PHT)" },
  { id: "Europe/London", label: "London (GMT/BST)" },
  { id: "Australia/Sydney", label: "Sydney (AET)" },
];

interface Props {
  currentTimezone: string;
}

export function TimezonePicker({ currentTimezone }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTx] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();

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

  function choose(tz: string) {
    if (tz === currentTimezone) {
      setOpen(false);
      return;
    }
    const label = COMMON_TIMEZONES.find((t) => t.id === tz)?.label ?? tz;
    startTx(async () => {
      const result = await setStaffTimezone(tz);
      if (!result.ok) {
        setFeedback(result.error ?? "Couldn't save.");
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't change timezone.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      setOpen(false);
      setFeedback(null);
      toast.show({ kind: "success", message: `Timezone set to ${label}.` });
    });
  }

  const currentLabel =
    COMMON_TIMEZONES.find((tz) => tz.id === currentTimezone)?.label ?? currentTimezone;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Set your timezone"
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors",
          "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
      >
        <Globe className="h-3 w-3" />
        {currentLabel.split(" (")[0]}
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-60 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg",
            "dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <p className="px-2.5 py-1.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
            Your timezone
          </p>
          <ul className="flex flex-col">
            {COMMON_TIMEZONES.map((tz) => {
              const selected = tz.id === currentTimezone;
              return (
                <li key={tz.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => choose(tz.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                      "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                      selected && "font-medium",
                    )}
                  >
                    <span>{tz.label}</span>
                    {selected && <Check className="h-3 w-3 text-emerald-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {feedback && <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-rose-600">{feedback}</p>}
          {pending && (
            <p className="flex items-center gap-1 px-2.5 pb-1.5 text-[11px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

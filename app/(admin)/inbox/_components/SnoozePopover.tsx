"use client";

/**
 * SnoozePopover — Gmail-style snooze picker with presets + custom.
 *
 * Presets:
 *   • Later today  — +3h
 *   • Tomorrow     — next 9am local
 *   • Next week    — next Monday 9am local
 *   • Custom       — reveals a datetime-local input
 *
 * Click outside or Esc closes. Server action setThreadSnooze persists
 * + revalidatePath updates the visible list.
 */

import { AlarmClock, ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { setThreadSnooze } from "../_actions";

interface Props {
  threadId: string;
  /** Existing snooze if any (ISO). Lets the popover show "Unsnooze". */
  currentSnoozeUntil: string | null;
  onClose: () => void;
  onSnoozed: () => void;
}

export function SnoozePopover({ threadId, currentSnoozeUntil, onClose, onSnoozed }: Props) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  // Initialize empty, fill in a mount effect: defaultCustom() -> tomorrow9am()
  // constructs a new Date(), and reading the wall clock in a useState
  // initializer is the banned #418 pattern. The submit guard already
  // handles an empty value (NaN check), so an empty initial is safe.
  const [custom, setCustom] = useState("");
  useEffect(() => {
    setCustom(defaultCustom());
  }, []);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function snooze(date: Date | null) {
    setError(null);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("snoozeUntil", date ? date.toISOString() : "");
      const res = await setThreadSnooze(null, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSnoozed();
      onClose();
    });
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Snooze thread"
      className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Snooze until
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        <Preset label="Later today" sub="+3 hours" onClick={() => snooze(laterToday())} />
        <Preset label="Tomorrow" sub="9:00 AM" onClick={() => snooze(tomorrow9am())} />
        <Preset label="Next week" sub="Mon 9:00 AM" onClick={() => snooze(nextMonday9am())} />
        <li>
          <button
            type="button"
            onClick={() => setShowCustom((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span>Custom</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showCustom ? "rotate-180" : ""}`}
            />
          </button>
        </li>
        {showCustom && (
          <li className="px-1 py-1">
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => {
                const d = new Date(custom);
                if (Number.isNaN(d.getTime())) {
                  setError("Invalid date.");
                  return;
                }
                snooze(d);
              }}
              disabled={pending}
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md bg-zinc-900 px-2 py-1 font-medium text-[11px] text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <AlarmClock className="h-2.5 w-2.5" />
              )}
              Snooze
            </button>
          </li>
        )}
        {currentSnoozeUntil && (
          <>
            <li className="my-1 border-zinc-200/70 border-t dark:border-zinc-800" />
            <li>
              <button
                type="button"
                onClick={() => snooze(null)}
                disabled={pending}
                className="w-full rounded px-2 py-1.5 text-left text-rose-700 text-xs hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
              >
                Unsnooze now
              </button>
            </li>
          </>
        )}
      </ul>
      {error && <p className="mt-1 px-1 text-[10px] text-rose-600">{error}</p>}
    </div>
  );
}

function Preset({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span>{label}</span>
        <span className="font-mono text-[10px] text-zinc-500">{sub}</span>
      </button>
    </li>
  );
}

function laterToday(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 3);
  return d;
}

function tomorrow9am(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function nextMonday9am(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 1 : 8 - day; // days until next Monday
  d.setDate(d.getDate() + offset);
  d.setHours(9, 0, 0, 0);
  return d;
}

function defaultCustom(): string {
  // Default the custom input to tomorrow 9am local in datetime-local format.
  const d = tomorrow9am();
  // Format as YYYY-MM-DDTHH:mm in local timezone.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

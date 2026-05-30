"use client";

/**
 * DateRangePicker — explicit from/to date picker for /admin/analytics.
 *
 * Sits next to the preset window selector (7d / 14d / 30d / 90d).
 * Opens a popover with two <input type="date"> fields plus an
 * "Apply" button. Selecting an explicit range routes to
 * /admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD which the page
 * passes through to loadTeamAnalytics — that helper honors the
 * explicit range over windowDays when both ends are valid.
 *
 * The current `from`/`to` (if any) seed the fields so reopening
 * the picker shows the active range. The picker doesn't enforce
 * from <= to client-side; the server clamps to a 365-day max.
 */

import { Calendar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Props {
  /** Currently-applied from date (ISO YYYY-MM-DD), if any. */
  activeFrom?: string;
  /** Currently-applied to date (ISO YYYY-MM-DD), if any. */
  activeTo?: string;
  /** Optional staff id — when set, routes to /admin/analytics/[staffId]
   *  instead of /admin/analytics so the picker can be re-used on the
   *  per-staff drill-down. */
  staffId?: string;
}

export function DateRangePicker({ activeFrom, activeTo, staffId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(activeFrom ?? defaultFrom());
  const [to, setTo] = useState(activeTo ?? defaultTo());
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const basePath = staffId ? `/admin/analytics/${staffId}` : "/admin/analytics";

  function apply() {
    setOpen(false);
    router.push(`${basePath}?from=${from}&to=${to}`);
  }

  function clear() {
    setOpen(false);
    router.push(basePath);
  }

  const isCustomActive = Boolean(activeFrom && activeTo);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Pick a custom date range"
        aria-label="Pick a custom date range"
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
          isCustomActive
            ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
            : "border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        }`}
      >
        <Calendar className="h-3 w-3" />
        {isCustomActive ? `${activeFrom} → ${activeTo}` : "Custom"}
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="mb-2 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Custom date range
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-zinc-500">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-zinc-500">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-between gap-2">
            {isCustomActive ? (
              <button
                type="button"
                onClick={clear}
                className="rounded px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={apply}
              disabled={!from || !to}
              className="rounded bg-zinc-900 px-3 py-1 font-mono text-[10px] text-zinc-50 uppercase tracking-widest hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

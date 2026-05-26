"use client";

import { type ActivityEntry, loadRowActivity } from "@/lib/activity-history";
import { cn } from "@/lib/cn";
import { Clock, History, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  table: string;
  recordId: string;
  alsoTable?: string;
  alsoRecordId?: string;
  /** Inline summary text (already computed server-side) — e.g. 'JC · 2h ago' */
  summaryLabel?: string;
  /** Compact (just the icon) vs expanded with the label */
  compact?: boolean;
}

/**
 * Inline "last edit · JC · 2h ago" badge that, when clicked, opens
 * a popover with the full row history as a diff timeline.
 *
 * The summary label is pre-computed server-side by the parent (one
 * cheap LIMIT 1 join in the rows loader) so the inline badge is
 * just decoration — no extra query per row. The popover does the
 * deeper load lazily on first open.
 *
 * Field-level diffs render as 'status: called → email_sent' so
 * scanning is fast. Empty fields render as a dim em-dash.
 */
export function ActivityHistoryButton({
  table,
  recordId,
  alsoTable,
  alsoRecordId,
  summaryLabel,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Lazy load on first open
  useEffect(() => {
    if (!open || entries) return;
    setLoading(true);
    setError(null);
    loadRowActivity({ table, recordId, alsoTable, alsoRecordId, limit: 50 })
      .then((rows) => setEntries(rows))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load history."))
      .finally(() => setLoading(false));
  }, [open, entries, table, recordId, alsoTable, alsoRecordId]);

  // Click outside + Escape close
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
          compact
            ? "p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            : "px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
        title="Show edit history"
        aria-label="Show edit history"
      >
        <Clock className="h-2.5 w-2.5" />
        {!compact && summaryLabel && <span>{summaryLabel}</span>}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 z-50 mt-1 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          <header className="flex items-center justify-between border-zinc-200/60 border-b bg-zinc-50/40 px-3 py-2 dark:border-zinc-800/40 dark:bg-zinc-900/40">
            <div className="flex items-center gap-1.5">
              <History className="h-3 w-3 text-zinc-500" />
              <h3 className="font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] dark:text-zinc-300">
                Edit history
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </header>

          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Loading…
                </p>
              </div>
            )}

            {error && (
              <div className="px-3 py-4 text-rose-600 text-xs dark:text-rose-400">{error}</div>
            )}

            {entries && entries.length === 0 && (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-zinc-500">No tracked changes for this row yet.</p>
              </div>
            )}

            {entries && entries.length > 0 && (
              <ul className="divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
                {entries.map((e) => (
                  <EntryRow key={e.id} entry={e} />
                ))}
              </ul>
            )}
          </div>

          <footer className="border-zinc-200/60 border-t bg-zinc-50/40 px-3 py-1.5 text-center font-mono text-[9px] text-zinc-500 uppercase tracking-[0.08em] dark:border-zinc-800/40 dark:bg-zinc-900/40">
            Audit log · most recent 50
          </footer>
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const when = formatRelativeTime(entry.changedAt);
  const who = entry.changedByDisplayName ?? "System";

  return (
    <li className="px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-[11px] text-zinc-900 dark:text-zinc-100">{who}</span>
        <span
          className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.08em]"
          title={entry.changedAt}
        >
          {when}
        </span>
      </div>

      {entry.operation === "INSERT" && (
        <p className="font-mono text-[10px] text-emerald-600 uppercase tracking-[0.08em] dark:text-emerald-400">
          Created
        </p>
      )}

      {entry.operation === "DELETE" && (
        <p className="font-mono text-[10px] text-rose-600 uppercase tracking-[0.08em] dark:text-rose-400">
          Deleted
        </p>
      )}

      {entry.operation === "UPDATE" && entry.changes.length > 0 && (
        <dl className="space-y-1">
          {entry.changes.map((c) => (
            <div
              key={`${entry.id}-${c.field}`}
              className="grid grid-cols-[max-content_1fr] items-baseline gap-x-2"
            >
              <dt className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                {humanizeField(c.field)}
              </dt>
              <dd className="font-mono text-[10px]">
                {c.from === null || c.from === "" ? (
                  <span className="text-zinc-400">—</span>
                ) : (
                  <span className="text-zinc-500 line-through">{truncate(c.from)}</span>
                )}
                <span className="mx-1 text-zinc-400">→</span>
                {c.to === null || c.to === "" ? (
                  <span className="text-zinc-400">—</span>
                ) : (
                  <span className="text-zinc-900 dark:text-zinc-100">{truncate(c.to)}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function humanizeField(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\bemail e164\b/i, "email")
    .replace(/\bphone e164\b/i, "phone")
    .replace(/\bid$/i, "")
    .trim();
}

function truncate(s: string, max = 50): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

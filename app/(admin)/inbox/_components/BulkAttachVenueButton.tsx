"use client";

/**
 * BulkAttachVenueButton - attach one venue to ALL currently-selected
 * unmatched threads in a single action.
 *
 * Mirrors AttachVenueButton's search dropdown UX (debounced server search,
 * "Venue Name . City" results, outside-click close) but fires the batched
 * bulkAttachVenueToThreads action over a list of thread ids instead of one.
 *
 * The parent (ThreadListWithBulk) renders this in the bulk-action toolbar
 * only when 1+ threads are selected AND every selected thread is unmatched
 * (venueId === null). On success it shows a brief banner with the attached
 * count and then calls onDone so the parent can clear the selection and
 * refresh.
 */

import { Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { type VenueSearchResult, searchVenuesForThread } from "../_attach-venue-action";
import { bulkAttachVenueToThreads } from "../_bulk-attach-venue-action";

export function BulkAttachVenueButton({
  threadIds,
  disabled,
  onDone,
}: {
  threadIds: string[];
  disabled?: boolean;
  /** Called after a successful attach (parent clears selection + refreshes). */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VenueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTx] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Outside-click closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Auto-focus the input when the dropdown opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced server search (same helper the single-attach picker uses).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchVenuesForThread(q)
        .then((rows) => {
          setResults(rows);
          setSearching(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Search failed.");
          setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  function attach(venueId: string) {
    setError(null);
    setPendingId(venueId);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadIds", threadIds.join(","));
      fd.set("venueId", venueId);
      const result = await bulkAttachVenueToThreads(null, fd);
      setPendingId(null);
      if (result.ok) {
        const { attached, skipped, retroactivelyAttached } = result.data;
        const parts = [`Attached ${attached} thread${attached === 1 ? "" : "s"}`];
        if (retroactivelyAttached > 0) {
          parts.push(`+${retroactivelyAttached} more with the same sender linked too`);
        }
        if (skipped > 0) parts.push(`${skipped} skipped`);
        setSuccessMessage(`${parts.join(". ")}.`);
        // Hold the banner briefly so the operator sees the result, then
        // hand control back to the parent (clear selection + refresh).
        setTimeout(() => {
          setOpen(false);
          onDone?.();
        }, 1500);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <span className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          setOpen((o) => {
            if (!o) setSuccessMessage(null);
            return !o;
          })
        }
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 border-dashed bg-amber-50 px-2 py-0.5 font-medium text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
      >
        <MapPin className="h-3 w-3" aria-hidden="true" />
        Attach venue ({threadIds.length})
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-80 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 border-zinc-200/80 border-b px-2 py-1.5 dark:border-zinc-800/60">
            <Search className="h-3 w-3 text-zinc-400" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search venues..."
              className="flex-1 bg-transparent text-xs focus:outline-none"
            />
            {searching && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {query.trim().length < 2 ? (
            <p className="px-3 py-3 text-xs text-zinc-500">Type at least 2 characters.</p>
          ) : results.length === 0 && !searching ? (
            <p className="px-3 py-3 text-xs text-zinc-500">No venues match "{query.trim()}".</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => attach(v.id)}
                    disabled={pendingId !== null}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate font-medium text-sm">{v.name}</span>
                      {pendingId === v.id && (
                        <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                      )}
                    </span>
                    {(v.cityName || v.address) && (
                      <span className="truncate text-[10px] text-zinc-500">
                        {[v.cityName, v.address].filter(Boolean).join(" . ")}
                      </span>
                    )}
                    {v.aliasMatch && (
                      <span className="truncate text-[10px] text-blue-600 dark:text-blue-400">
                        matches alias: {v.aliasMatch}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="border-rose-200 border-t bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="border-emerald-200 border-t bg-emerald-50 px-3 py-2 text-emerald-700 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              {successMessage}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

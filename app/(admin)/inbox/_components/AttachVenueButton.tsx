"use client";

/**
 * AttachVenueButton — small inline picker for assigning a venue to
 * an unassigned thread. Renders as a "+ Venue" pill that, when
 * clicked, opens a dropdown with a search input and live results.
 *
 * Search is debounced (250ms) since each keystroke hits the server.
 * Results show "Venue Name · City Name" so an operator can pick the
 * right one across multiple cities with the same venue name.
 *
 * On success the parent ThreadPane will re-render via revalidatePath
 * and the "Unassigned" indicator disappears. Local optimistic state
 * isn't needed here because the visual after-state is a different
 * component (Link to venue) than the trigger.
 */

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type VenueSearchResult,
  attachVenueToThread,
  clearVenueFromThread,
  searchVenuesForThread,
} from "../_attach-venue-action";

export function AttachVenueButton({
  threadId,
  assigned = false,
}: {
  threadId: string;
  /** True when the thread already has a venue -> show "Fix venue" + a
   *  "Remove venue match" option (for a wrong auto-match). */
  assigned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VenueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Brief success banner shown on attach. Carries the count of
   *  OTHER threads that got retroactively linked so operators see
   *  the satisfying batch effect ("+3 more threads linked"). */
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

  // Debounced server search.
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

  function clear() {
    setError(null);
    setPendingId("__clear__");
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      const result = await clearVenueFromThread(null, fd);
      setPendingId(null);
      if (result.ok) setOpen(false);
      else setError(result.error);
    });
  }

  function attach(venueId: string) {
    setError(null);
    setPendingId(venueId);
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("venueId", venueId);
      const result = await attachVenueToThread(null, fd);
      setPendingId(null);
      if (result.ok) {
        const extra = result.data.retroactivelyAttached;
        if (extra > 0) {
          // Show a brief banner before closing so the operator sees
          // the bonus effect. Close after a beat. Without this they'd
          // never realize the engine just saved them N more clicks.
          setSuccessMessage(
            `Attached. ${extra} more thread${extra === 1 ? "" : "s"} with the same sender linked too.`,
          );
          setTimeout(() => setOpen(false), 1800);
        } else {
          setOpen(false);
        }
        // ThreadPane will re-render via revalidatePath; the
        // "Unassigned" pill disappears and a Link to the venue
        // replaces it.
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <span className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() =>
          setOpen((o) => {
            // Clear stale success state on re-open so an old
            // batch-attach toast doesn't linger from a previous
            // session of the dropdown.
            if (!o) setSuccessMessage(null);
            return !o;
          })
        }
        className={
          assigned
            ? "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-medium text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            : "inline-flex items-center gap-1 rounded-full border border-amber-300 border-dashed bg-amber-50 px-2 py-0.5 font-medium text-[11px] text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
        }
      >
        {assigned ? "Fix venue" : "+ Attach venue"}
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

          {assigned && (
            <button
              type="button"
              onClick={clear}
              disabled={pendingId !== null}
              className="flex w-full items-center gap-2 border-zinc-200/80 border-b px-3 py-2 text-left text-rose-600 text-xs hover:bg-rose-50 disabled:opacity-50 dark:border-zinc-800/60 dark:text-rose-400 dark:hover:bg-rose-950/30"
            >
              {pendingId === "__clear__" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Remove venue match (wrong auto-match)
            </button>
          )}

          {query.trim().length < 2 ? (
            <p className="px-3 py-3 text-xs text-zinc-500">
              {assigned ? "Or search a venue to re-point it." : "Type at least 2 characters."}
            </p>
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
                        {[v.cityName, v.address].filter(Boolean).join(" · ")}
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

          {/* Success banner — appears only when the retroactive
              attach picked up extra threads. Closing of the dropdown
              is delayed 1.8s by the handler so this is actually
              visible. Emerald per the color-reservation palette
              (emerald = done/healthy). */}
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

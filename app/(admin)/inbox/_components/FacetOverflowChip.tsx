"use client";

/**
 * FacetOverflowChip — "+N more" affordance that opens a modal
 * listing every brand or campaign facet beyond the inline cap.
 *
 * Mounted in FolderList directly under the last visible chip in
 * each section (brands / campaigns). When fewer facets exist than
 * the cap, this chip doesn't render at all — the wrapping
 * FolderList only mounts it when overflowCount > 0.
 *
 * Modal contents:
 *   - Search box that filters facets by label substring
 *   - Full sortable list — facets stay ordered by descending count
 *     (most-active first); the search just filters in place
 *   - Click a facet to navigate; the modal closes + the inbox
 *     page renders with the new filter via standard URL routing
 *
 * Behavior:
 *   - Esc closes
 *   - Click-outside on the backdrop closes
 *   - The "+N more" trigger button blends visually with surrounding
 *     chips so the overflow doesn't disrupt the rail's rhythm
 */

import { Search, Tag, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FacetItem {
  id: string;
  label: string;
  count: number;
}

interface Props {
  /** Title for the modal header — "Brands" or "Campaigns". */
  groupLabel: string;
  /** All facets, including the ones already shown inline. The modal
   *  shows the full list so the operator can also see context. */
  allFacets: FacetItem[];
  /** How many are already rendered inline; the chip label says
   *  "+{N} more" where N = allFacets.length - visibleCount. */
  visibleCount: number;
  /** Build the href to navigate to when a facet is picked. */
  buildHref: (facetId: string) => string;
  /** Currently-active facet id, if any. Highlighted in the modal. */
  activeId?: string;
}

export function FacetOverflowChip({
  groupLabel,
  allFacets,
  visibleCount,
  buildHref,
  activeId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const overflowCount = Math.max(0, allFacets.length - visibleCount);
  if (overflowCount === 0) return null;

  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          title={`Show all ${allFacets.length} ${groupLabel.toLowerCase()}`}
        >
          <Tag className="h-3 w-3 shrink-0 opacity-50" />
          <span className="flex-1 truncate">+{overflowCount} more</span>
        </button>
      </li>
      {open && (
        <Modal
          groupLabel={groupLabel}
          allFacets={allFacets}
          query={query}
          setQuery={setQuery}
          buildHref={buildHref}
          activeId={activeId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Modal({
  groupLabel,
  allFacets,
  query,
  setQuery,
  buildHref,
  activeId,
  onClose,
}: {
  groupLabel: string;
  allFacets: FacetItem[];
  query: string;
  setQuery: (s: string) => void;
  buildHref: (id: string) => string;
  activeId?: string;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Auto-focus the search input on open.
    inputRef.current?.focus();
  }, []);

  const lower = query.trim().toLowerCase();
  const filtered = lower
    ? allFacets.filter((f) => f.label.toLowerCase().includes(lower))
    : allFacets;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`All ${groupLabel.toLowerCase()}`}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between gap-2 border-zinc-200 border-b px-4 py-2.5 dark:border-zinc-800">
          <h2 className="font-semibold text-sm tracking-tight">{groupLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="border-zinc-200 border-b px-3 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
            <Search className="h-3 w-3 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${groupLabel.toLowerCase()}…`}
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-zinc-500">No matches.</li>
          ) : (
            filtered.map((f) => (
              <li key={f.id}>
                <Link
                  href={buildHref(f.id)}
                  onClick={onClose}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                    activeId === f.id
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  <Tag className="h-3 w-3 shrink-0 opacity-50" />
                  <span className="flex-1 truncate">{f.label}</span>
                  {f.count > 0 && (
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        activeId === f.id ? "text-zinc-300" : "text-zinc-500"
                      }`}
                    >
                      {f.count}
                    </span>
                  )}
                </Link>
              </li>
            ))
          )}
        </ul>
        <footer className="border-zinc-200 border-t bg-zinc-50 px-4 py-2 text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {filtered.length} of {allFacets.length} {groupLabel.toLowerCase()}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

"use client";

/**
 * SavedSearchesDropdown — small button that opens a popover with:
 *   - one-click "Save current" (when the search box has a non-empty
 *     value not already saved)
 *   - list of saved searches (click to load)
 *   - per-row delete affordance
 *
 * Anchored next to the inbox search input. Closes on outside-click
 * or Escape. Triggers a router.push when an entry is picked so the
 * URL drives the search (existing pattern in InboxFilterBar).
 *
 * Phase B.2 of the email-system audit.
 */

import { cn } from "@/lib/cn";
import type { SavedSearch } from "@/lib/inbox-saved-searches";
import { Bookmark, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createSavedSearchAction, deleteSavedSearchAction } from "../_actions-saved-searches";

interface Props {
  /** All saved searches for the current operator (server-loaded). */
  saved: SavedSearch[];
  /** Current value of the search input. Used for "save current." */
  currentQuery: string;
  /** Apply a picked saved search by writing it back into the parent
   *  search state and triggering a URL push. */
  onApply: (queryText: string) => void;
}

export function SavedSearchesDropdown({ saved, currentQuery, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveForm(false);
        setError(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setShowSaveForm(false);
        setError(null);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The "save current" form auto-shows when the operator clicks the
  // button while the search box has a non-empty value AND that
  // value isn't already saved.
  const trimmed = currentQuery.trim();
  const canSave = trimmed.length > 0 && !saved.some((s) => s.queryText === trimmed);

  function handleSave() {
    if (!canSave) return;
    setError(null);
    startTx(async () => {
      const res = await createSavedSearchAction({
        label: labelDraft.trim() || trimmed.slice(0, 60),
        queryText: trimmed,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setShowSaveForm(false);
      setLabelDraft("");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTx(async () => {
      const res = await deleteSavedSearchAction({ id });
      if (!res.ok) setError(res.error ?? "Couldn't delete.");
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Saved searches"
        aria-label="Saved searches"
        className={cn(
          "inline-flex h-[26px] items-center gap-1 rounded-md border px-1.5 text-xs",
          "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900",
          saved.length > 0
            ? "text-zinc-700 dark:text-zinc-300"
            : "text-zinc-400 dark:text-zinc-500",
        )}
      >
        <Bookmark className="h-3 w-3" />
        {saved.length > 0 && <span className="font-mono text-[10px]">{saved.length}</span>}
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg",
            "dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
              Saved searches
            </p>
            {canSave && !showSaveForm && (
              <button
                type="button"
                onClick={() => {
                  setShowSaveForm(true);
                  setLabelDraft(trimmed.slice(0, 60));
                }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
              >
                <Plus className="h-2.5 w-2.5" />
                Save current
              </button>
            )}
          </div>

          {showSaveForm && (
            <div className="border-zinc-200 border-t px-2 py-2 dark:border-zinc-800">
              <p className="mb-1 font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                Save: {trimmed.slice(0, 60)}
                {trimmed.length > 60 && "…"}
              </p>
              <input
                type="text"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder="Name this search…"
                // biome-ignore lint/a11y/noAutofocus: explicit form open
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") {
                    setShowSaveForm(false);
                    setError(null);
                  }
                }}
                disabled={pending}
                className="w-full rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-xs focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="mt-1 flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowSaveForm(false);
                    setError(null);
                  }}
                  className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending || !labelDraft.trim()}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Check className="h-2.5 w-2.5" />
                  )}
                  Save
                </button>
              </div>
              {error && (
                <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">{error}</p>
              )}
            </div>
          )}

          {saved.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-zinc-400">
              No saved searches yet. Type a query and click "Save current."
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {saved.map((s) => (
                <li key={s.id} className="group flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(s.queryText);
                      setOpen(false);
                    }}
                    className="flex-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <p className="truncate font-medium">{s.label}</p>
                    <p className="truncate font-mono text-[10px] text-zinc-500">{s.queryText}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    disabled={pending}
                    title="Delete saved search"
                    className="invisible shrink-0 rounded p-1 text-zinc-400 hover:text-rose-600 group-hover:visible dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

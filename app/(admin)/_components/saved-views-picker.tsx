"use client";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { BookmarkCheck, ChevronDown, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type SavedView,
  deleteSavedView,
  listSavedViews,
  saveCurrentView,
} from "../_actions/saved-views";

/**
 * Saved-views picker for any URL-backed filtered table.
 *
 * Props:
 *   surface     — 'cold_outreach', 'all_crawls', etc.
 *   contextId   — optional scoping (e.g. city_campaign_id)
 *   filterKeys  — which URL params count as 'view params' (we ignore
 *                 everything else when saving so transient state like
 *                 a selected row doesn't get baked in)
 *   pathname    — what to revalidate after save/delete
 *
 * Behavior:
 *   • On mount, server-renders the dropdown with the list of saved
 *     views (lazy-loaded on first open)
 *   • Clicking a view replaces the URL with its params
 *   • 'Save current view' opens an inline name input
 *   • Saving updates the URL highlight to mark the matching view
 *     active
 *   • Each view in the dropdown has a 🗑 affordance on hover
 *
 * The whole control is one chip in the filter strip. When no views
 * exist yet, the chip says 'Save view'; when views exist, it shows
 * the currently-active view name (or 'Custom view' if filters
 * don't match any saved view).
 */
export function SavedViewsPicker({
  surface,
  contextId,
  filterKeys,
  pathname,
}: {
  surface: string;
  contextId: string | null;
  filterKeys: string[];
  pathname: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const livePathname = usePathname();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [pending, startTx] = useTransition();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Current view = subset of URL params filtered to filterKeys
  const currentParams: Record<string, string> = {};
  for (const k of filterKeys) {
    const v = searchParams.get(k);
    if (v) currentParams[k] = v;
  }
  const currentParamsKey = JSON.stringify(
    Object.keys(currentParams)
      .sort()
      .reduce<Record<string, string>>((acc, k) => {
        acc[k] = currentParams[k] ?? "";
        return acc;
      }, {}),
  );

  // Find the saved view that matches the current params
  const activeView = (views ?? []).find(
    (v) =>
      JSON.stringify(
        Object.keys(v.params)
          .sort()
          .reduce<Record<string, string>>((acc, k) => {
            acc[k] = v.params[k] ?? "";
            return acc;
          }, {}),
      ) === currentParamsKey,
  );

  // Lazy-load views on first open
  useEffect(() => {
    if (!open || views) return;
    setLoading(true);
    listSavedViews(surface, contextId)
      .then((v) => setViews(v))
      .catch(() => setViews([]))
      .finally(() => setLoading(false));
  }, [open, views, surface, contextId]);

  // Click-outside close
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function applyView(view: SavedView) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(view.params)) sp.set(k, v);
    router.replace(sp.toString() ? `${livePathname}?${sp}` : livePathname, { scroll: false });
    setOpen(false);
  }

  function saveCurrent() {
    if (!draftName.trim()) return;
    if (Object.keys(currentParams).length === 0) {
      toast.show({
        kind: "error",
        message: "Apply at least one filter or sort before saving a view.",
      });
      return;
    }
    const fd = new FormData();
    fd.set("surface", surface);
    if (contextId) fd.set("contextId", contextId);
    fd.set("name", draftName.trim());
    fd.set("paramsJson", JSON.stringify(currentParams));
    fd.set("revalidate", pathname);
    startTx(async () => {
      const result = await saveCurrentView(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't save view.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      toast.show({ kind: "success", message: `Saved view "${draftName.trim()}"` });
      // Reset + force a re-fetch on next open
      setNaming(false);
      setDraftName("");
      setViews(null);
    });
  }

  function deleteView(view: SavedView) {
    const fd = new FormData();
    fd.set("viewId", view.id);
    fd.set("revalidate", pathname);
    startTx(async () => {
      const result = await deleteSavedView(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't delete.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      setViews(null); // Re-fetch on next open
      toast.show({ kind: "success", message: `Deleted "${view.name}"` });
    });
  }

  const hasParams = Object.keys(currentParams).length > 0;
  const chipLabel = activeView ? activeView.name : hasParams ? "Custom view" : "Views";

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
          activeView
            ? "border-blue-500/40 bg-blue-500/[0.08] text-blue-700 dark:text-blue-300"
            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
        )}
      >
        {activeView ? (
          <Star className="h-2.5 w-2.5 fill-current" />
        ) : (
          <BookmarkCheck className="h-2.5 w-2.5" />
        )}
        <span className="max-w-[120px] truncate">{chipLabel}</span>
        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <header className="border-zinc-200/60 border-b bg-zinc-50/40 px-3 py-2 dark:border-zinc-800/40 dark:bg-zinc-900/40">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Saved views
            </p>
          </header>

          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Loading…
                </p>
              </div>
            )}

            {!loading && views && views.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-zinc-500">No saved views yet</p>
            )}

            {!loading && views && views.length > 0 && (
              <ul className="py-1">
                {views.map((v) => {
                  const isActive = activeView?.id === v.id;
                  return (
                    <li key={v.id} className="group flex items-stretch">
                      <button
                        type="button"
                        onClick={() => applyView(v)}
                        className={cn(
                          "flex flex-1 items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors",
                          isActive
                            ? "bg-blue-500/[0.08] text-blue-700 dark:text-blue-300"
                            : "hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40",
                        )}
                      >
                        <span className="truncate text-sm">{v.name}</span>
                        {isActive && <Star className="h-3 w-3 shrink-0 fill-current" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteView(v)}
                        disabled={pending}
                        className="px-2 text-zinc-400 opacity-0 transition-all hover:bg-rose-500/[0.08] hover:text-rose-600 group-hover:opacity-100 pointer-coarse:opacity-100"
                        aria-label={`Delete view ${v.name}`}
                        title="Delete view"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Save current view */}
          <footer className="border-zinc-200/60 border-t px-3 py-2 dark:border-zinc-800/40">
            {naming ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveCurrent();
                    }
                    if (e.key === "Escape") {
                      setNaming(false);
                      setDraftName("");
                    }
                  }}
                  // biome-ignore lint/a11y/noAutofocus: inline form pattern expects focus
                  autoFocus
                  placeholder="Name this view…"
                  className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={saveCurrent}
                  disabled={pending || !draftName.trim()}
                  className="rounded-md bg-blue-600 px-2 py-1 font-mono text-[10px] text-white uppercase tracking-[0.08em] transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNaming(false);
                    setDraftName("");
                  }}
                  className="rounded-md p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  aria-label="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNaming(true)}
                disabled={!hasParams}
                className={cn(
                  "inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
                  hasParams
                    ? "text-zinc-600 hover:bg-blue-500/[0.08] hover:text-blue-700 dark:text-zinc-400 dark:hover:text-blue-300"
                    : "cursor-not-allowed text-zinc-400 dark:text-zinc-600",
                )}
                title={
                  hasParams
                    ? "Save current filter/sort as a named view"
                    : "Apply a filter or sort first"
                }
              >
                <Plus className="h-3 w-3" />
                {hasParams ? "Save current view" : "No filters to save"}
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}

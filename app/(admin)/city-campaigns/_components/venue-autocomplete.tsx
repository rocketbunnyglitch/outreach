"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Loader2, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { quickCreateVenue, searchVenues } from "../_slot-actions";

interface VenueHit {
  id: string;
  name: string;
  email: string | null;
  capacity: number | null;
  address: string | null;
}

interface Props {
  cityId: string;
  /** Currently selected venue (parent controls). */
  selectedName: string | null;
  onSelect: (venue: { id: string; name: string }) => void;
  placeholder?: string;
  /** Compact mode for inline table cells. */
  compact?: boolean;
}

/**
 * Venue autocomplete for the slot picker.
 *
 * Search is debounced 200ms server-side. Hits are city-scoped so a
 * Toronto venue can't be assigned to a Buffalo crawl by mistake.
 *
 * Below the hits, a "Create '{query}' as a new venue" affordance fires
 * quickCreateVenue and immediately calls onSelect with the new id.
 *
 * Designed for inline use in slot tables — the input style is invisible
 * until hover/focus, matching the rest of the spreadsheet-feel UX.
 */
export function VenueAutocomplete({
  cityId,
  selectedName,
  onSelect,
  placeholder = "Pick a venue…",
  compact = true,
}: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VenueHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, startSearch] = useTransition();
  const [creating, startCreate] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || !open) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startSearch(async () => {
        const result = await searchVenues({ cityId, query, limit: 8 });
        setHits(result);
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, cityId, open]);

  // Outside click
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function handleSelect(v: VenueHit) {
    onSelect({ id: v.id, name: v.name });
    setOpen(false);
    setQuery("");
  }

  function handleCreate() {
    if (!query.trim()) return;
    const fd = new FormData();
    fd.set("name", query.trim());
    fd.set("cityId", cityId);
    startCreate(async () => {
      const result = await quickCreateVenue(null, fd);
      if (result.ok && result.data) {
        onSelect({ id: result.data.venueId, name: query.trim() });
        setOpen(false);
        setQuery("");
      }
    });
  }

  const showCreate =
    query.trim().length > 1 &&
    !hits.some((h) => h.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div ref={containerRef} className="relative w-full">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "w-full rounded-md border border-transparent px-2 py-1 text-left text-xs transition-colors",
            "hover:border-zinc-300 hover:bg-white dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
            compact ? "h-7" : "h-9",
            selectedName ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-400",
          )}
        >
          {selectedName ?? placeholder}
        </button>
      ) : (
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-3 w-3 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && hits[0]) {
                e.preventDefault();
                handleSelect(hits[0]);
              }
            }}
            placeholder="Search venues…"
            autoFocus
            className={cn("pl-7 text-xs", compact && "h-7")}
          />
          <div className="-translate-y-1/2 absolute top-1/2 right-2">
            {(searching || creating) && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
          </div>

          {/* Results dropdown */}
          {(hits.length > 0 || showCreate) && (
            <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              {hits.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => handleSelect(v)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{v.name}</span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {v.email ?? "no email"}
                    {v.capacity != null && ` · ${v.capacity} cap`}
                    {v.address && ` · ${v.address.slice(0, 40)}`}
                  </span>
                </button>
              ))}
              {showCreate && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex w-full items-center gap-2 border-zinc-200 border-t px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-emerald-500/[0.06] dark:border-zinc-800 dark:text-zinc-300"
                >
                  <Plus className="h-3 w-3" />
                  Create "<span className="font-medium">{query.trim()}</span>" as new venue
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

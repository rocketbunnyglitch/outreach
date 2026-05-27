"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Loader2, MapPin, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createVenueFromMapsUrl, quickCreateVenue, searchVenues } from "../_slot-actions";

interface VenueHit {
  id: string;
  name: string;
  email: string | null;
  capacity: number | null;
  address: string | null;
}

interface Props {
  cityId: string;
  selectedName: string | null;
  onSelect: (venue: { id: string; name: string }) => void;
  placeholder?: string;
  compact?: boolean;
}

/**
 * Venue autocomplete for the slot picker.
 *
 * Three input paths in one input:
 *   1. Type a name → searches existing venues (debounced 200ms,
 *      city-scoped)
 *   2. Paste a Google Maps URL → detected automatically, single CTA
 *      pulls name/address/phone/website/coords from Places API and
 *      creates the venue
 *   3. Type a fully new name → "Create '{name}' as new venue" creates
 *      a barebones row
 *
 * URL detection: query.startsWith('http') AND host matches google.com/
 * maps OR goo.gl OR maps.app.goo.gl. When detected, the search dropdown
 * collapses and a blue Maps-tinted CTA appears.
 *
 * Without GOOGLE_MAPS_API_KEY: Maps URL path shows the "not configured"
 * hint; quick-create still works as fallback.
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
  const [mapsPending, startMaps] = useTransition();
  const [mapsError, setMapsError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portal positioning state. We render the dropdown into document.body
  // (escaping the table cell's stacking context that was causing the
  // operator's "transparent dropdown" / "can't click venue" bug) so it
  // always paints above sibling rows. The position is computed from the
  // input's getBoundingClientRect — refreshed on scroll + resize so the
  // dropdown stays glued to the input.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const recomputePos = useCallback(() => {
    const el = inputWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      // Position BELOW the input. Add a small 4px gap.
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Recompute every time the dropdown opens, the query changes (results
  // grow/shrink), or the viewport scrolls/resizes. useLayoutEffect runs
  // synchronously before paint so we don't see the dropdown flicker
  // in a stale position. query + hits.length aren't read directly
  // inside the effect, but their changes correlate with the dropdown's
  // height changing — we intentionally re-run to recompute position
  // after results grow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    if (!open) return;
    recomputePos();
    function onScrollOrResize() {
      recomputePos();
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, query, hits.length, recomputePos]);

  const isMapsUrl =
    /^https?:\/\//i.test(query) && /google\.com\/maps|goo\.gl|maps\.app\.goo\.gl/i.test(query);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || !open || isMapsUrl) {
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
  }, [query, cityId, open, isMapsUrl]);

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
    setMapsError(null);
  }

  function handleCreate() {
    if (!query.trim() || isMapsUrl) return;
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

  function handleMapsUrl() {
    if (!isMapsUrl) return;
    setMapsError(null);
    const fd = new FormData();
    fd.set("url", query.trim());
    fd.set("cityId", cityId);
    startMaps(async () => {
      const result = await createVenueFromMapsUrl(null, fd);
      if (result.ok && result.data) {
        if (result.data.notConfigured) {
          setMapsError(
            "Maps autopopulate not configured — set GOOGLE_MAPS_API_KEY on the server, or paste the venue name instead to quick-create.",
          );
          return;
        }
        onSelect({ id: result.data.venueId, name: result.data.venueName });
        setOpen(false);
        setQuery("");
      } else if (!result.ok) {
        setMapsError(result.error ?? "Couldn't resolve Maps URL.");
      }
    });
  }

  const showCreate =
    !isMapsUrl &&
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
        <div ref={inputWrapRef} className="relative">
          {isMapsUrl ? (
            <MapPin className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-3 w-3 text-blue-500" />
          ) : (
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-3 w-3 text-zinc-400" />
          )}
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMapsError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                e.preventDefault();
                if (isMapsUrl) handleMapsUrl();
                else if (hits[0]) handleSelect(hits[0]);
                else if (showCreate) handleCreate();
              }
            }}
            placeholder="Search or paste Maps URL…"
            autoFocus
            className={cn("pl-7 text-xs", compact && "h-7")}
          />
          <div className="-translate-y-1/2 absolute top-1/2 right-2">
            {(searching || creating || mapsPending) && (
              <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
            )}
          </div>

          {/*
            Dropdowns rendered via React Portal into document.body so they
            escape the table cell's stacking context. Previously rendered
            with z-50 INSIDE the cell — but a sibling table row's
            position:relative content creates its own stacking context at
            the same level, drawing over our z-50. That gave the operator
            the "transparent dropdown, can't click venue" bug from session
            11. Portal renders at document.body root → z-50 wins against
            anything else in the page.

            We compute the absolute position via getBoundingClientRect on
            inputWrapRef + listen for scroll/resize so the dropdown
            stays glued to the input.
          */}
          {pos != null &&
            isMapsUrl &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                style={{
                  position: "fixed",
                  top: pos.top,
                  left: pos.left,
                  width: pos.width,
                }}
                className="z-50 overflow-hidden rounded-lg border border-blue-200 bg-white shadow-lg dark:border-blue-900/50 dark:bg-zinc-900"
              >
                <button
                  type="button"
                  onClick={handleMapsUrl}
                  disabled={mapsPending}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-blue-500/[0.08] dark:hover:bg-blue-500/[0.12]"
                >
                  <MapPin className="h-3.5 w-3.5 text-blue-500" />
                  <span className="flex-1">
                    <strong className="font-medium text-zinc-900 dark:text-zinc-100">
                      Autopopulate from Maps link
                    </strong>
                    <br />
                    <span className="text-[10px] text-zinc-500">
                      Pulls name, address, phone, website, coords
                    </span>
                  </span>
                  {mapsPending ? (
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                  ) : (
                    <Plus className="h-3 w-3 text-blue-500" />
                  )}
                </button>
                {mapsError && (
                  <div className="border-zinc-200 border-t bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:border-zinc-800 dark:bg-amber-950/30 dark:text-amber-300">
                    {mapsError}
                  </div>
                )}
              </div>,
              document.body,
            )}

          {pos != null &&
            !isMapsUrl &&
            (hits.length > 0 || showCreate) &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                style={{
                  position: "fixed",
                  top: pos.top,
                  left: pos.left,
                  width: pos.width,
                }}
                className="z-50 max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
              >
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
              </div>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}

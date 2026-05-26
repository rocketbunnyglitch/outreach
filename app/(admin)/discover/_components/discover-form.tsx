"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import type { DiscoveredPlace, PlaceSearchResult } from "@/lib/google-places";
import { CheckCircle2, ExternalLink, MapPin, Phone, Search, Star } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

interface CityOpt {
  id: string;
  label: string;
  hasCoords: boolean;
}

type SearchResult = {
  ok: boolean;
  result?: PlaceSearchResult;
  cityId?: string;
  existingPlaceIds?: string[];
  error?: string;
} | null;

type ImportResult = {
  ok: boolean;
  inserted?: number;
  skipped?: number;
  error?: string;
} | null;

interface Props {
  cities: CityOpt[];
  searchAction: (prev: unknown, fd: FormData) => Promise<NonNullable<SearchResult>>;
  importAction: (prev: unknown, fd: FormData) => Promise<NonNullable<ImportResult>>;
}

const TYPE_OPTIONS = [
  { value: "bar", label: "Bars" },
  { value: "night_club", label: "Nightclubs" },
  { value: "restaurant", label: "Restaurants" },
  { value: "pub", label: "Pubs" },
  { value: "wine_bar", label: "Wine bars" },
  { value: "cocktail_lounge", label: "Cocktail lounges" },
];

export function DiscoverForm({ cities, searchAction, importAction }: Props) {
  const [searchState, runSearch] = useActionState(searchAction, null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<NonNullable<ImportResult> | null>(null);
  const [isImporting, startImportTransition] = useTransition();

  function toggleSelected(placeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }
  function selectAllNonExisting() {
    if (!searchState?.ok || !searchState.result) return;
    const existing = new Set(searchState.existingPlaceIds ?? []);
    setSelected(
      new Set(
        searchState.result.places
          .filter((p) => !existing.has(p.googlePlaceId))
          .map((p) => p.googlePlaceId),
      ),
    );
  }
  function clearSelected() {
    setSelected(new Set());
  }

  async function handleImport() {
    if (!searchState?.ok || !searchState.cityId || selected.size === 0) return;
    const places = searchState.result?.places ?? [];
    const fd = new FormData();
    fd.set("cityId", searchState.cityId);
    for (const p of places) {
      if (selected.has(p.googlePlaceId)) {
        // Stash full JSON payload so the server doesn't have to re-fetch.
        fd.append("place", JSON.stringify(p));
      }
    }

    startImportTransition(async () => {
      const result = await importAction(null, fd);
      setImportResult(result);
      if (result.ok) {
        // Clear selection so the operator can search again cleanly.
        setSelected(new Set());
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Search form */}
      <Card className="flex flex-col gap-5 p-6">
        <header>
          <h2 className="font-semibold text-2xl tracking-tight ">Search</h2>
        </header>
        {searchState && !searchState.ok && searchState.error && (
          <Alert tone="error">{searchState.error}</Alert>
        )}
        <form action={runSearch} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cityId">City</Label>
              <Select name="cityId" required>
                <SelectTrigger id="cityId">
                  <SelectValue placeholder="Pick a city" />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={!c.hasCoords}>
                      {c.label}
                      {!c.hasCoords && " (no coords)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="radiusMeters">Radius (meters)</Label>
              <Input
                id="radiusMeters"
                name="radiusMeters"
                type="number"
                min="100"
                max="50000"
                step="100"
                defaultValue="2000"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Place types</Label>
            <div className="flex flex-wrap gap-3">
              {TYPE_OPTIONS.map((t) => (
                <label
                  key={t.value}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                >
                  <input
                    type="checkbox"
                    name="types"
                    value={t.value}
                    defaultChecked={
                      t.value === "bar" || t.value === "night_club" || t.value === "pub"
                    }
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
          <SearchButton />
        </form>
      </Card>

      {/* Results */}
      {searchState?.ok && searchState.result && (
        <Card className="flex flex-col gap-5 p-6">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="font-semibold text-2xl tracking-tight ">Results</h2>
              <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                {searchState.result.places.length} found ·{" "}
                {searchState.result.source === "mock" ? "mock data" : "google_places"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllNonExisting}
                className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Select all new
              </button>
              <button
                type="button"
                onClick={clearSelected}
                className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Clear
              </button>
            </div>
          </header>

          {importResult && (
            <Alert tone={importResult.ok ? "success" : "error"}>
              {importResult.ok
                ? `Imported ${importResult.inserted ?? 0} new venues${
                    importResult.skipped ? ` · skipped ${importResult.skipped} existing` : ""
                  }.`
                : importResult.error}
            </Alert>
          )}

          <ol className="flex flex-col gap-2">
            {searchState.result.places.map((p) => (
              <PlaceRow
                key={p.googlePlaceId}
                place={p}
                selected={selected.has(p.googlePlaceId)}
                alreadyImported={(searchState.existingPlaceIds ?? []).includes(p.googlePlaceId)}
                onToggle={() => toggleSelected(p.googlePlaceId)}
              />
            ))}
          </ol>

          {selected.size > 0 && (
            <div className="sticky bottom-4 flex items-center justify-between rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-sm">
                <span className="font-medium font-mono">{selected.size}</span> selected
              </span>
              <Button type="button" disabled={isImporting} onClick={handleImport}>
                {isImporting
                  ? "Importing…"
                  : `Import ${selected.size} ${selected.size === 1 ? "venue" : "venues"}`}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function SearchButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="self-end">
      <Search className="h-4 w-4" />
      {pending ? "Searching…" : "Search Places"}
    </Button>
  );
}

function PlaceRow({
  place,
  selected,
  alreadyImported,
  onToggle,
}: {
  place: DiscoveredPlace;
  selected: boolean;
  alreadyImported: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 px-4 py-3 transition-colors dark:border-zinc-800",
          selected && "border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900",
          alreadyImported && "opacity-60",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={alreadyImported}
          className="mt-1 h-4 w-4 rounded border-zinc-300"
        />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{place.name}</h3>
            {alreadyImported && (
              <Badge tone="muted">
                <CheckCircle2 className="h-3 w-3" />
                already in venues
              </Badge>
            )}
            {place.rating != null && (
              <span className="inline-flex items-center gap-0.5 text-amber-700 text-xs dark:text-amber-400">
                <Star className="h-3 w-3 fill-amber-500 stroke-amber-500" />
                {place.rating.toFixed(1)}
                <span className="ml-1 text-zinc-400">({place.userRatingCount})</span>
              </span>
            )}
          </div>
          {place.formattedAddress && (
            <p className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <MapPin className="h-3 w-3" />
              {place.formattedAddress}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            {place.phoneE164 && (
              <span className="inline-flex items-center gap-1 font-mono">
                <Phone className="h-3 w-3" />
                {place.phoneE164}
              </span>
            )}
            {place.websiteUri && (
              <a
                href={place.websiteUri}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 underline hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                website
              </a>
            )}
            {place.types.length > 0 && (
              <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
                {place.types.slice(0, 3).join(" · ")}
              </span>
            )}
          </div>
        </div>
      </label>
    </li>
  );
}

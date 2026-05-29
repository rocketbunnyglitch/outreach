"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Globe, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface CityItem {
  id: string;
  name: string;
  region: string | null;
  countryCode: string;
  countryName: string;
  timezone: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Master cities list — grouped by country with a live search filter.
 *
 * Search is a case-insensitive substring match against city name,
 * region, country, or timezone. Hits as you type; no debounce needed
 * for sub-100-row datasets.
 *
 * Each group has a sticky-feeling country header band with the count
 * inline. Rows are dense but breathe — single-line, mono-tabular
 * coordinates trailing, hover slides the chevron in.
 */
export function CitiesListClient({ items }: { items: CityItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.region ?? "").toLowerCase().includes(q) ||
        c.countryName.toLowerCase().includes(q) ||
        c.timezone.toLowerCase().includes(q),
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, { country: string; items: CityItem[] }>();
    for (const c of filtered) {
      const k = c.countryCode;
      const entry = map.get(k) ?? { country: c.countryName, items: [] };
      entry.items.push(c);
      map.set(k, entry);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].country.localeCompare(b[1].country));
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 text-zinc-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search city, region, country, or timezone…"
          className="h-10 pl-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="-translate-y-1/2 absolute top-1/2 right-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            clear
          </button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-zinc-300/80 border-dashed px-6 py-16 text-center dark:border-zinc-700/60">
          <p className="font-medium text-sm text-zinc-700 dark:text-zinc-300">
            No cities match "{query}"
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Try a shorter substring, or{" "}
            <Link
              href="/cities/new"
              className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              add a new city
            </Link>
            .
          </p>
        </div>
      )}

      {/* Groups */}
      {grouped.map(([code, group]) => (
        <section key={code} className="card-surface overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b bg-zinc-50/60 px-5 py-3 dark:border-zinc-800/40 dark:bg-zinc-900/40">
            <h2 className="inline-flex items-center gap-2 font-semibold text-sm tracking-tight">
              <Globe className="h-3.5 w-3.5 text-zinc-500" />
              {group.country}
            </h2>
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              {group.items.length} {group.items.length === 1 ? "city" : "cities"}
            </span>
          </header>
          <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
            {group.items.map((c) => (
              <CityRow key={c.id} city={c} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CityRow({ city }: { city: CityItem }) {
  const hasCoords = city.lat !== null && city.lng !== null;
  return (
    <li>
      <Link
        href={`/cities/${city.id}`}
        className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-blue-500/[0.04] dark:hover:bg-blue-400/[0.04]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{city.name}</h3>
            {city.region && (
              <span className="font-mono text-[10px] text-zinc-500 tracking-wide">
                {city.region}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            <span>{city.timezone}</span>
            {hasCoords && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-2.5 w-2.5" />
                  {(city.lat ?? 0).toFixed(3)}, {(city.lng ?? 0).toFixed(3)}
                </span>
              </>
            )}
            {!hasCoords && (
              <>
                <span aria-hidden>·</span>
                <span className="text-amber-600 dark:text-amber-500">no coords</span>
              </>
            )}
          </div>
        </div>
        <span
          className={cn(
            "font-mono text-[10px] text-zinc-400 tracking-widest",
            "translate-x-1 opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100",
          )}
        >
          edit →
        </span>
      </Link>
    </li>
  );
}

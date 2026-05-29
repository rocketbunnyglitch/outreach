"use client";

import { cn } from "@/lib/cn";
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from "@react-google-maps/api";
import { ExternalLink, Loader2, MapPin, Plus, Search, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  type MapsSearchResult,
  mapsAddPlaceAsVenue,
  mapsLoadPlaceDetails,
  mapsSearchPlaces,
} from "../_actions";

interface City {
  id: string;
  name: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
}

interface PlaceDetails {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  existsAsVenue: boolean;
  venueId: string | null;
}

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };
const MAP_LIBRARIES: ("places" | "geometry")[] = [];

/**
 * Standalone Maps surface. Search any place, see results pinned on the
 * map, click to view details and add to the venue directory. Layout is
 * Google-Maps-like: results on the left, full-bleed map on the right.
 */
export function MapsApp({
  googleMapsApiKey,
  cities,
  defaultCenter,
}: {
  googleMapsApiKey: string;
  cities: City[];
  defaultCenter: { lat: number; lng: number };
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey,
    libraries: MAP_LIBRARIES,
  });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapsSearchResult[]>([]);
  const [searching, startSearch] = useTransition();
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapsSearchResult | null>(null);
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();
  const [chosenCityId, setChosenCityId] = useState<string>(cities[0]?.id ?? "");
  /** True once the operator has manually picked a city from the dropdown.
   *  Used to stop the auto-suggest-closest-city effect from overriding
   *  their explicit choice when they move between places. */
  const [cityManuallyPicked, setCityManuallyPicked] = useState(false);
  const [addedVenueId, setAddedVenueId] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  const mapRef = useRef<google.maps.Map | null>(null);

  // When the operator clicks a different result/pin, clear the manual
  // city-override flag so the auto-suggest kicks in again for the new
  // place. Their previous manual pick was tied to the prior place, not
  // a global preference.
  useEffect(() => {
    setCityManuallyPicked(false);
  }, [selected?.placeId]);

  // Auto-suggest the closest active city when a place's details land.
  // Only runs while the operator hasn't manually picked a city; once they
  // touch the dropdown we respect their choice for the rest of the
  // session. Closest = lowest great-circle distance from the place's
  // (lat,lng) to the city's centroid. Falls back to the first city in
  // the list if no city has coords yet.
  useEffect(() => {
    if (cityManuallyPicked) return;
    if (!details || details.lat == null || details.lng == null) return;
    if (cities.length === 0) return;
    const pLat = details.lat;
    const pLng = details.lng;
    let bestId = cities[0]?.id ?? "";
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of cities) {
      if (c.lat == null || c.lng == null) continue;
      const d = haversineKm(pLat, pLng, c.lat, c.lng);
      if (d < bestDist) {
        bestDist = d;
        bestId = c.id;
      }
    }
    if (bestId && bestId !== chosenCityId) {
      setChosenCityId(bestId);
    }
  }, [details, cities, cityManuallyPicked, chosenCityId]);

  // gm_authFailure can't be caught by useJsApiLoader's loadError — surface
  // the auth failure as a friendly in-app error instead of Google's overlay.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => setAuthFailed(true);
    return () => {
      window.gm_authFailure = prev;
    };
  }, []);

  const runSearch = useCallback((q: string) => {
    setSearchError(null);
    setSelected(null);
    setDetails(null);
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      // Bias to the current map view so "bars" doesn't return Tokyo
      // when the user is looking at Toronto.
      let bias: { lat: number; lng: number; radiusM: number } | undefined;
      const center = mapRef.current?.getCenter();
      if (center) {
        bias = { lat: center.lat(), lng: center.lng(), radiusM: 50_000 };
      }
      const res = await mapsSearchPlaces({ query: trimmed, bias });
      if (!res.ok) {
        setSearchError(res.error ?? "Search failed.");
        setResults([]);
        return;
      }
      setResults(res.results ?? []);
      // Center the map on the first result to give the operator feedback.
      const first = res.results?.[0];
      if (first && mapRef.current) {
        mapRef.current.panTo({ lat: first.lat, lng: first.lng });
      }
    });
  }, []);

  function pickResult(r: MapsSearchResult) {
    setSelected(r);
    setDetails(null);
    setAddError(null);
    setAddedVenueId(null);
    setLoadingDetails(true);
    mapRef.current?.panTo({ lat: r.lat, lng: r.lng });
    mapsLoadPlaceDetails(r.placeId)
      .then((res) => {
        if (res.ok && res.details) {
          setDetails(res.details);
        } else {
          setAddError(res.error ?? "Couldn't load details.");
        }
      })
      .finally(() => setLoadingDetails(false));
  }

  function handleAdd() {
    if (!selected || !chosenCityId) return;
    setAddError(null);
    startAdd(async () => {
      const res = await mapsAddPlaceAsVenue({
        placeId: selected.placeId,
        cityId: chosenCityId,
      });
      if (!res.ok) {
        setAddError(res.error ?? "Couldn't add.");
        return;
      }
      setAddedVenueId(res.venueId ?? null);
    });
  }

  if (authFailed) {
    return (
      <div className="rounded-lg border border-rose-300 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <p className="font-medium">Google rejected the map key.</p>
        <p className="mt-2 text-sm">
          Check that Maps JavaScript API is enabled on GOOGLE_MAPS_BROWSER_KEY and that this domain
          is in the key's HTTP-referrer restrictions.
        </p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Map failed to load: {loadError.message}
      </div>
    );
  }
  if (!isLoaded) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-14rem)] grid-cols-1 gap-4 md:grid-cols-[360px_1fr]">
      {/* Results column */}
      <div className="flex flex-col gap-3 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <form
          className="border-zinc-200 border-b p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
        >
          <div className="relative">
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bars, restaurants, anything…"
              className="w-full rounded-md border border-zinc-300 bg-white py-1.5 pr-3 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <p className="mt-1.5 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.12em]">
            Press Enter to search · biased to current map view
          </p>
        </form>

        <div className="flex-1 overflow-y-auto">
          {searching && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}
          {searchError && (
            <p className="m-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {searchError}
            </p>
          )}
          {!searching && results.length === 0 && !searchError && (
            <p className="px-4 py-6 text-center text-xs text-zinc-500">
              Search to see results pinned on the map.
            </p>
          )}
          <ul className="flex flex-col">
            {results.map((r) => (
              <li key={r.placeId} className="border-zinc-200/60 border-b dark:border-zinc-800/40">
                <button
                  type="button"
                  onClick={() => pickResult(r)}
                  className={cn(
                    "block w-full px-3 py-2.5 text-left transition-colors",
                    selected?.placeId === r.placeId
                      ? "bg-blue-50 dark:bg-blue-950/20"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900/40",
                  )}
                >
                  <p className="font-medium text-sm">{r.name}</p>
                  {r.rating != null && (
                    <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {r.rating.toFixed(1)}
                      {r.userRatingCount != null && (
                        <span className="text-zinc-400">({r.userRatingCount})</span>
                      )}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Map column */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={defaultCenter}
          zoom={12}
          onLoad={(m) => {
            mapRef.current = m;
          }}
          options={{
            disableDefaultUI: false,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          }}
        >
          {results.map((r) => (
            <Marker
              key={r.placeId}
              position={{ lat: r.lat, lng: r.lng }}
              title={r.name}
              onClick={() => pickResult(r)}
            />
          ))}
          {selected && (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => {
                setSelected(null);
                setDetails(null);
              }}
            >
              <div className="min-w-[260px] max-w-[300px] p-1 text-zinc-900">
                <p className="font-semibold text-sm">{selected.name}</p>
                {loadingDetails && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading details…
                  </p>
                )}
                {details && (
                  <>
                    {details.address && (
                      <p className="mt-1 text-xs text-zinc-600">{details.address}</p>
                    )}
                    {details.rating != null && (
                      <p className="mt-1 flex items-center gap-1 text-xs">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {details.rating.toFixed(1)}
                        {details.userRatingCount != null && (
                          <span className="text-zinc-500">({details.userRatingCount})</span>
                        )}
                      </p>
                    )}
                    {details.phone && <p className="mt-1 text-xs">📞 {details.phone}</p>}
                    {details.website && (
                      <a
                        href={details.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-blue-600 text-xs hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Website
                      </a>
                    )}

                    <div className="mt-3 border-zinc-200 border-t pt-2">
                      {details.existsAsVenue ? (
                        <a
                          href={`/venues/${details.venueId}`}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-white text-xs hover:bg-emerald-700"
                        >
                          <MapPin className="h-3 w-3" /> Already in venues — open
                        </a>
                      ) : addedVenueId ? (
                        <a
                          href={`/venues/${addedVenueId}`}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-white text-xs hover:bg-emerald-700"
                        >
                          <MapPin className="h-3 w-3" /> Added — open
                        </a>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-baseline justify-between">
                            <label
                              htmlFor="maps-city-picker"
                              className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
                            >
                              City
                            </label>
                            {!cityManuallyPicked &&
                              details?.lat != null &&
                              details?.lng != null && (
                                <span className="font-mono text-[9px] text-emerald-600 dark:text-emerald-400">
                                  auto-suggested (closest)
                                </span>
                              )}
                          </div>
                          <select
                            id="maps-city-picker"
                            value={chosenCityId}
                            onChange={(e) => {
                              setChosenCityId(e.target.value);
                              setCityManuallyPicked(true);
                            }}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                          >
                            {cities.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.region ? `, ${c.region}` : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleAdd}
                            disabled={adding || !chosenCityId}
                            className="inline-flex items-center justify-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1.5 text-white text-xs hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {adding ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                            Add to venues
                          </button>
                          {addError && <p className="text-rose-600 text-xs">{addError}</p>}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>
    </div>
  );
}

// Augment window for gm_authFailure
declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

/**
 * Great-circle distance in kilometers between two (lat,lng) points
 * using the haversine formula. Good enough for "which city is this
 * place closest to" — accurate to under a percent at city scales.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's mean radius, km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

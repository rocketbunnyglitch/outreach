"use client";
import { cn } from "@/lib/cn";
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from "@react-google-maps/api";
import { ExternalLink, Loader2, MapPin, Plus, Search, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  type CityMapPlace,
  type CityMapResult,
  addPlaceToCampaign,
  fetchCityMapBestCenter,
  fetchCityMapPlaces,
} from "../_actions/city-map-actions";

interface Props {
  cityCampaignId: string;
  cityId: string;
  /** Publishable Google Maps JavaScript API key (HTTP-referrer restricted). */
  googleMapsApiKey: string;
}

const MAP_CONTAINER_STYLE = {
  width: "100%",
  height: "480px",
};

// Sweep across all the Maps libraries upfront so the loader only fires once
const MAP_LIBRARIES: ("places" | "geometry")[] = [];

export function CityVenueMap({ cityCampaignId, cityId, googleMapsApiKey }: Props) {
  const { isLoaded: mapsLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey,
    libraries: MAP_LIBRARIES,
  });

  const router = useRouter();
  const [data, setData] = useState<CityMapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlace, setSelectedPlace] = useState<CityMapPlace | null>(null);
  const [addPending, startAddTx] = useTransition();
  const [addError, setAddError] = useState<string | null>(null);
  // Google calls window.gm_authFailure when the Maps JS API rejects the
  // browser key at auth time (RefererNotAllowedMapError,
  // ApiNotActivatedMapError, BillingNotEnabledMapError, InvalidKeyMapError).
  // useJsApiLoader's loadError does NOT catch these because the script DID
  // load successfully; Google overlays its own 'Oops!' message instead. We
  // wire up the global so failures become a clear in-app error instead.
  const [authFailed, setAuthFailed] = useState(false);
  useEffect(() => {
    const win = window as unknown as { gm_authFailure?: () => void };
    const prev = win.gm_authFailure;
    win.gm_authFailure = () => {
      setAuthFailed(true);
    };
    return () => {
      win.gm_authFailure = prev;
    };
  }, []);

  // Holds the map's current visible center. Updated on dragend so we know
  // where to send the "Search this area" override coords. The mapRef holds
  // a reference to the Google Map instance so we can read .getCenter().
  const mapRef = useRef<google.maps.Map | null>(null);
  const [hasPanned, setHasPanned] = useState(false);
  // Set true on first load so we don't re-pan to best-center every refresh
  const initialCenterAppliedRef = useRef(false);

  // The center the LAST search used. We compare to the current map center
  // to know whether the user has panned enough to warrant a re-search.
  const [lastSearchedCenter, setLastSearchedCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  /**
   * Search for places at a given center. If null, uses the city's recorded
   * center (the original behavior).
   */
  const load = useCallback(
    async (override?: { lat: number; lng: number }) => {
      setLoading(true);
      try {
        const result = await fetchCityMapPlaces({
          cityCampaignId,
          centerLat: override?.lat,
          centerLng: override?.lng,
        });
        setData(result);
        if (result.center) {
          setLastSearchedCenter(result.center);
        }
      } catch (_err) {
        setData({
          ok: false,
          center: null,
          radiusKm: 0,
          places: [],
          reason: "unknown",
        });
      } finally {
        setLoading(false);
        setHasPanned(false);
      }
    },
    [cityCampaignId],
  );

  /**
   * First-load orchestration:
   *   1. Ask the server for the "best center" via Text Search ("bars in {city}")
   *   2. If found, search around THAT center instead of the city's centroid
   *   3. If not, fall through to the default fetchCityMapPlaces behavior
   *
   * Runs exactly once on mount. Subsequent loads (refresh, search-this-area)
   * skip the best-center query.
   */
  useEffect(() => {
    if (initialCenterAppliedRef.current) return;
    initialCenterAppliedRef.current = true;

    (async () => {
      try {
        const bc = await fetchCityMapBestCenter({ cityCampaignId });
        if (bc.center) {
          await load(bc.center);
          return;
        }
      } catch {
        // fall through to default load
      }
      await load();
    })();
  }, [cityCampaignId, load]);

  function handleAdd(place: CityMapPlace) {
    setAddError(null);
    startAddTx(async () => {
      let result: { ok: boolean; venueId?: string; error?: string };
      try {
        result = await addPlaceToCampaign({
          cityCampaignId,
          cityId,
          place: {
            placeId: place.placeId,
            name: place.name,
            lat: place.lat,
            lng: place.lng,
            address: place.address,
            phone: place.phone,
            website: place.website,
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            types: place.types,
          },
        });
      } catch (err) {
        // Server may have actually succeeded (venue created) before failing
        // on a downstream step like revalidate or realtime publish; treat as
        // recoverable, prompt a refresh.
        console.error("[CityVenueMap] addPlaceToCampaign threw", err);
        setAddError("Saved, but the page needs a refresh to show it.");
        // Defer the refresh past the current React transition so any
        // in-flight render doesn't collide with the route invalidation.
        setTimeout(() => router.refresh(), 0);
        return;
      }
      if (!result.ok) {
        setAddError(result.error ?? "Couldn't add.");
        return;
      }
      // Close the InfoWindow BEFORE updating the underlying place list
      // and BEFORE triggering router.refresh(). The InfoWindow holds a
      // reference to the place via `selectedPlace`; if its parent place
      // object mutates between open and a refresh-driven re-render,
      // @react-google-maps/api occasionally throws when re-syncing the
      // overlay's position. Closing first removes that hazard.
      setSelectedPlace(null);

      // Optimistic: flip this pin to "inDirectory" so the user sees the
      // change immediately. Server revalidation re-fetches the page list;
      // we re-mark on next load. Guarded against shape drift + wrapped
      // in try/catch so a stale shape doesn't blow up the whole render.
      try {
        setData((prev) => {
          if (!prev || !Array.isArray(prev.places)) return prev;
          return {
            ...prev,
            places: prev.places.map((p) =>
              p.placeId === place.placeId
                ? { ...p, inDirectory: true, venueId: result.venueId ?? null }
                : p,
            ),
          };
        });
      } catch (err) {
        console.error("[CityVenueMap] optimistic update failed", err);
      }
      // Defer router.refresh() so it runs AFTER the React transition has
      // committed the state updates above. Without this, the refresh
      // can re-render the page while the InfoWindow / overlay is still
      // being torn down, and a downstream component (e.g. one of the
      // cold-outreach cells that just got a new row) can throw with the
      // "client-side exception" boundary catching it.
      setTimeout(() => router.refresh(), 0);
    });
  }

  if (authFailed) {
    return (
      <MapShell title="City venue map">
        <ErrorBanner>
          Google rejected the map key. Check that the Maps JavaScript API is enabled on
          GOOGLE_MAPS_BROWSER_KEY and that this domain is in the key's HTTP-referrer restrictions
          (e.g. https://outreach.barcrawlconnect.com/*).
        </ErrorBanner>
      </MapShell>
    );
  }

  if (loadError) {
    return (
      <MapShell title="City venue map">
        <ErrorBanner>
          Couldn't load Google Maps. Check the GOOGLE_MAPS_API_KEY and that the domain is allowed in
          the API key's referrer restrictions.
        </ErrorBanner>
      </MapShell>
    );
  }

  if (loading || !data || !mapsLoaded) {
    return (
      <MapShell title="City venue map">
        <div
          className="flex items-center justify-center bg-zinc-100 dark:bg-zinc-900"
          style={MAP_CONTAINER_STYLE}
        >
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading map…
          </div>
        </div>
      </MapShell>
    );
  }

  if (data.reason === "not_configured") {
    return (
      <MapShell title="City venue map">
        <InfoBanner>
          Map isn't configured. Add{" "}
          <code className="font-mono text-[11px]">GOOGLE_MAPS_API_KEY</code> to the server env to
          enable.
        </InfoBanner>
      </MapShell>
    );
  }

  if (data.reason === "no_city_coords" || !data.center) {
    return (
      <MapShell title="City venue map">
        <InfoBanner>
          This city doesn't have a lat/lng on its master record. Open the city in the admin and set
          its coordinates first, then come back.
        </InfoBanner>
      </MapShell>
    );
  }

  const inDirectoryCount = data.places.filter((p) => p.inDirectory).length;
  const newCount = data.places.length - inDirectoryCount;

  return (
    <MapShell
      title="City venue map"
      subtitle={
        data.places.length > 0
          ? `${newCount} new · ${inDirectoryCount} in directory · within ${data.radiusKm}km`
          : `searched within ${data.radiusKm}km`
      }
      onRefresh={() => load()}
      refreshing={loading}
      cached={data.cached}
    >
      {addError && <ErrorBanner>{addError}</ErrorBanner>}
      {data.places.length === 0 && (
        <InfoBanner tone={data.reason === "google_error" ? "error" : "info"}>
          {data.reason === "google_error" ? (
            <>
              <strong className="font-medium">Google Places call failed.</strong>{" "}
              {data.errorDetail ?? "See server logs."}
            </>
          ) : data.reason === "google_returned_nothing" ? (
            "Google has no bars / restaurants / nightclubs registered around this center. Try 'Search this area' after panning the map, or verify the city's lat/lng."
          ) : (
            // not_configured + no_city_coords are handled by the early-return
            // screens above (lines 187 + 199). 'unknown' lands here when the
            // load promise threw outside the action.
            "No places to show yet — give it a moment, or pan to search a new area."
          )}
        </InfoBanner>
      )}
      <div className="relative">
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={data.center}
          zoom={13}
          options={{
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          }}
          onLoad={(map) => {
            mapRef.current = map;
          }}
          onUnmount={() => {
            mapRef.current = null;
          }}
          onDragEnd={() => {
            // Mark that the user moved the viewport. The 'Search this area'
            // button only appears after this, so we don't clutter the UI
            // on initial load.
            if (!mapRef.current) return;
            const c = mapRef.current.getCenter();
            if (!c) return;
            const newLat = c.lat();
            const newLng = c.lng();
            // Only show the button if they panned a meaningful distance
            // (~500m as a rough heuristic against accidental drags).
            if (lastSearchedCenter) {
              const dLat = newLat - lastSearchedCenter.lat;
              const dLng = newLng - lastSearchedCenter.lng;
              const approxKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
              if (approxKm < 0.5) {
                setHasPanned(false);
                return;
              }
            }
            setHasPanned(true);
          }}
        >
          {data.places.map((p) => (
            <Marker
              key={p.placeId}
              position={{ lat: p.lat, lng: p.lng }}
              onClick={() => setSelectedPlace(p)}
              icon={{
                path: 0, // google.maps.SymbolPath.CIRCLE
                scale: 8,
                fillColor: p.inDirectory ? "#94a3b8" : "#10b981", // gray vs green
                fillOpacity: 0.9,
                strokeWeight: 2,
                strokeColor: "#ffffff",
              }}
              title={p.name}
            />
          ))}
          {selectedPlace && (
            <InfoWindow
              position={{ lat: selectedPlace.lat, lng: selectedPlace.lng }}
              onCloseClick={() => setSelectedPlace(null)}
            >
              {/*
                Google's InfoWindow hardcodes a white background even in
                dark mode. The body's `dark:text-zinc-100` would otherwise
                bleed in and render the heading as light-grey-on-white
                (operator session 11: "bar name shows up in light grey on
                a white pop up screen"). So we force `text-zinc-900` here
                with NO dark variant — dark text on white always.
              */}
              <div className="min-w-[200px] max-w-[260px] p-1 text-zinc-900">
                <h4 className="font-semibold text-sm text-zinc-900">{selectedPlace.name}</h4>
                {selectedPlace.address && (
                  <p className="mt-0.5 text-[11px] text-zinc-600">{selectedPlace.address}</p>
                )}
                {selectedPlace.rating != null && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-700">
                    <Star className="h-3 w-3 fill-rose-400 text-rose-400" />
                    {selectedPlace.rating.toFixed(1)}
                    {selectedPlace.userRatingCount != null && (
                      <span className="text-zinc-500">
                        {" "}
                        · {selectedPlace.userRatingCount} reviews
                      </span>
                    )}
                  </p>
                )}
                {selectedPlace.types.length > 0 && (
                  <p className="mt-1 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.08em]">
                    {selectedPlace.types.slice(0, 3).join(" · ").replace(/_/g, " ")}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {selectedPlace.inDirectory && selectedPlace.venueId ? (
                    <a
                      href={`/venues/${selectedPlace.venueId}`}
                      className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-[11px] text-white"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open venue
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAdd(selectedPlace)}
                      disabled={addPending}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-[11px] text-white",
                        "hover:bg-emerald-700 disabled:opacity-60",
                      )}
                    >
                      {addPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      Add to campaign
                    </button>
                  )}
                  {selectedPlace.website && (
                    <a
                      href={selectedPlace.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-600 underline-offset-2 hover:underline"
                    >
                      website
                    </a>
                  )}
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
        {/* Floating "Search this area" button — appears after the operator
            pans the map a meaningful distance from the last-searched center.
            Disappears on click (load resets hasPanned). */}
        {hasPanned && (
          <button
            type="button"
            onClick={() => {
              if (!mapRef.current) return;
              const c = mapRef.current.getCenter();
              if (!c) return;
              load({ lat: c.lat(), lng: c.lng() });
            }}
            disabled={loading}
            className={cn(
              "-translate-x-1/2 absolute bottom-4 left-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-white text-xs shadow-lg",
              "hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
            )}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            Search this area
          </button>
        )}
      </div>
    </MapShell>
  );
}

// =========================================================================
// Sub-components
// =========================================================================

function MapShell({
  title,
  subtitle,
  children,
  onRefresh,
  refreshing,
  cached,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  cached?: boolean;
}) {
  return (
    <section className="card-surface overflow-hidden p-0">
      <header className="flex items-baseline justify-between border-zinc-200 border-b px-5 py-3 dark:border-zinc-800">
        <div className="flex items-baseline gap-3">
          <h2 className="flex items-center gap-1.5 font-semibold text-sm">
            <MapPin className="h-3.5 w-3.5 text-zinc-400" />
            {title}
          </h2>
          {subtitle && (
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              {subtitle}
            </p>
          )}
          {cached && (
            <span
              className="rounded-md bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] text-zinc-600 uppercase tracking-[0.08em] dark:bg-zinc-800 dark:text-zinc-400"
              title="Showing cached Google Places results (re-cached every 24h)"
            >
              cached
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
          >
            {refreshing ? "loading…" : "refresh"}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-rose-200 border-b bg-rose-50 px-4 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
      {children}
    </div>
  );
}

function InfoBanner({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "error";
}) {
  if (tone === "error") {
    return (
      <div className="border-rose-300 border-b bg-rose-50 px-4 py-2 text-rose-900 text-xs dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        {children}
      </div>
    );
  }
  return (
    <div className="border-zinc-200 border-b bg-zinc-50 px-4 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {children}
    </div>
  );
}

// Marker icon path 0 = google.maps.SymbolPath.CIRCLE. We reference it
// numerically to avoid pulling the SymbolPath enum at module-eval time
// (the maps API isn't ready until useJsApiLoader resolves).

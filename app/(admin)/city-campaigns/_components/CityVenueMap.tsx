"use client";
import { cn } from "@/lib/cn";
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from "@react-google-maps/api";
import { ExternalLink, Loader2, MapPin, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  type CityMapPlace,
  type CityMapResult,
  addPlaceToCampaign,
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchCityMapPlaces({ cityCampaignId });
      setData(result);
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
    }
  }, [cityCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  function handleAdd(place: CityMapPlace) {
    setAddError(null);
    startAddTx(async () => {
      const result = await addPlaceToCampaign({
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
      if (!result.ok) {
        setAddError(result.error ?? "Couldn't add.");
        return;
      }
      // Optimistic: flip this pin to "inDirectory" so the user sees
      // the change immediately. Server revalidation re-fetches the
      // page list; we re-mark on next load.
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          places: prev.places.map((p) =>
            p.placeId === place.placeId
              ? { ...p, inDirectory: true, venueId: result.venueId ?? null }
              : p,
          ),
        };
      });
      setSelectedPlace(null);
      router.refresh();
    });
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
      onRefresh={load}
      refreshing={loading}
      cached={data.cached}
    >
      {addError && <ErrorBanner>{addError}</ErrorBanner>}
      {data.places.length === 0 && (
        <InfoBanner>
          {data.reason === "google_returned_nothing"
            ? "Google has no bars / restaurants / nightclubs registered in this city. Either the lat/lng pin is wrong, or the city actually has none."
            : "No places to show."}
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
            // A muted style would be nicer but requires a Map ID + the
            // Cloud Console-based styling. Default styling is fine.
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
              <div className="min-w-[200px] max-w-[260px] p-1">
                <h4 className="font-semibold text-sm">{selectedPlace.name}</h4>
                {selectedPlace.address && (
                  <p className="mt-0.5 text-[11px] text-zinc-600">{selectedPlace.address}</p>
                )}
                {selectedPlace.rating != null && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-700">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {selectedPlace.rating.toFixed(1)}
                    {selectedPlace.userRatingCount != null && (
                      <span className="text-zinc-400">
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

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-zinc-200 border-b bg-zinc-50 px-4 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {children}
    </div>
  );
}

// Marker icon path 0 = google.maps.SymbolPath.CIRCLE. We reference it
// numerically to avoid pulling the SymbolPath enum at module-eval time
// (the maps API isn't ready until useJsApiLoader resolves).

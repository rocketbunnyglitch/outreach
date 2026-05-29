import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { mapsLoadCities } from "./_actions";
import { MapsApp } from "./_components/maps-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maps" };

/**
 * Google-Maps-like surface for the directory: search any place, drop pins,
 * click a pin → add to the venue directory under a chosen city. NOT
 * scoped to a campaign (that's what CityVenueMap on the city sheet is
 * for).
 */
export default async function MapsPage() {
  await requireStaff();

  const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? null;
  if (!browserKey) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Maps</h1>
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900 text-sm dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          Google Maps API isn&apos;t configured. Set GOOGLE_MAPS_BROWSER_KEY (preferred) or
          GOOGLE_MAPS_API_KEY in the env, then restart.
        </div>
      </div>
    );
  }

  // Pick a reasonable initial map center — the centroid of the operator's
  // active cities so the first view shows territory they actually work in.
  // Falls back to Toronto if there are no cities with coordinates yet.
  const FALLBACK = { lat: 43.6532, lng: -79.3832 };
  let defaultCenter = FALLBACK;
  try {
    const rows = await db.execute<{ lat: number; lng: number }>(sql`
      SELECT AVG(ST_Y(location::geometry)) AS lat,
             AVG(ST_X(location::geometry)) AS lng
        FROM cities
       WHERE archived_at IS NULL AND location IS NOT NULL
    `);
    type Row = { lat: number; lng: number };
    const list: Row[] = Array.isArray(rows)
      ? (rows as unknown as Row[])
      : ((rows as unknown as { rows: Row[] }).rows ?? []);
    const c = list[0];
    if (c && c.lat != null && c.lng != null) {
      defaultCenter = { lat: c.lat, lng: c.lng };
    }
  } catch {
    // fall back to the default — non-fatal
  }

  const cities = await mapsLoadCities();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">Maps</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Search anywhere, click a pin, add it to the venue directory.
        </p>
      </header>
      <MapsApp googleMapsApiKey={browserKey} cities={cities} defaultCenter={defaultCenter} />
    </div>
  );
}

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { cities, countries } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { asc, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { importDiscoveredPlaces, searchPlaces } from "./_actions";
import { DiscoverForm } from "./_components/discover-form";

export const metadata = { title: "Discover · Crawl Engine" };
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const citiesWithCoords = await db
    .select({
      id: cities.id,
      name: cities.name,
      region: cities.region,
      countryName: countries.name,
      location: cities.location,
    })
    .from(cities)
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .where(isNull(cities.archivedAt))
    .orderBy(asc(cities.name));

  const isMockMode = !env.GOOGLE_MAPS_API_KEY;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-semibold text-4xl tracking-tight ">
          <Sparkles className="-mt-1 mr-2 inline-block h-7 w-7 text-zinc-400" />
          Discover venues
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Search Google Places near a city to find candidate venues, then bulk-import the ones you
          want. Dedup by Google Place ID is automatic.
        </p>
      </header>

      {isMockMode && (
        <Alert tone="info">
          <strong>Mock mode.</strong> No{" "}
          <code className="font-mono text-xs">GOOGLE_MAPS_API_KEY</code> configured — search returns
          deterministic sample data so the import flow is testable. Set the key in your environment
          to run real Places API queries.
        </Alert>
      )}

      {citiesWithCoords.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center">
          <p className="font-semibold text-2xl tracking-tight ">No cities yet.</p>
          <p className="mt-2 text-sm text-zinc-500">
            <Link href="/cities/new" className="underline">
              Create a city
            </Link>{" "}
            with coordinates before searching for venues.
          </p>
        </Card>
      ) : (
        <DiscoverForm
          cities={citiesWithCoords.map((c) => ({
            id: c.id,
            label: `${c.name}${c.region ? ` (${c.region})` : ""}, ${c.countryName}`,
            hasCoords: c.location !== null,
          }))}
          searchAction={searchPlaces}
          importAction={importDiscoveredPlaces}
        />
      )}
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cities, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { bulkUpdateVenues } from "./_actions";
import { VenuesListClient } from "./_components/venues-list-client";

export const dynamic = "force-dynamic";

export default async function VenuesListPage() {
  const rows = await db
    .select({
      venue: venues,
      city: cities,
    })
    .from(venues)
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .where(isNull(venues.archivedAt))
    .orderBy(asc(cities.name), asc(venues.name));

  // Group venues by city
  const byCity = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.city.name;
    const existing = byCity.get(key);
    if (existing) existing.push(row);
    else byCity.set(key, [row]);
  }
  const groups = Array.from(byCity.entries()).map(([cityName, cityRows]) => ({
    cityName,
    venues: cityRows.map((r) => ({
      id: r.venue.id,
      name: r.venue.name,
      address: r.venue.address,
      capacity: r.venue.capacity,
      doNotContact: r.venue.doNotContact,
    })),
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">Venues</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Bars, restaurants, and event spaces — grouped by city. Select rows to bulk-update DNC or
            archive.
          </p>
        </div>
        <Button asChild>
          <Link href="/venues/new">
            <Plus className="h-4 w-4" /> New venue
          </Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center">
          <p className="font-semibold text-2xl tracking-tight ">No venues yet.</p>
          <p className="mt-2 text-sm text-stone-500">
            Phase 5 will populate venues automatically from Google Maps; for now add them manually
            or import from CSV via /import.
          </p>
        </Card>
      ) : (
        <VenuesListClient groups={groups} bulkAction={bulkUpdateVenues} />
      )}
    </div>
  );
}

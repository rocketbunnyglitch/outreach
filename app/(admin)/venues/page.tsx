import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cities, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { Building2, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { bulkUpdateVenues } from "./_actions";
import { VenuesTable } from "./_components/venues-table";

export const dynamic = "force-dynamic";

export default async function VenuesListPage() {
  const { staff } = await requireStaff();
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
  const _groups = Array.from(byCity.entries()).map(([cityName, cityRows]) => ({
    cityName,
    venues: cityRows.map((r) => ({
      id: r.venue.id,
      name: r.venue.name,
      address: r.venue.address,
      capacity: r.venue.capacity,
      doNotContact: r.venue.doNotContact,
    })),
  }));

  // Flatten rows for the table; build distinct city list for the filter
  const flatRows = rows.map((r) => ({
    id: r.venue.id,
    name: r.venue.name,
    cityName: r.city.name,
    address: r.venue.address,
    capacity: r.venue.capacity,
    doNotContact: r.venue.doNotContact,
  }));
  const cityOptions = Array.from(new Set(flatRows.map((r) => r.cityName)))
    .sort()
    .map((name) => ({ value: name, label: name }));

  // Full list of cities (id + name) for the "+ Add row" affordance.
  const allCities = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(isNull(cities.archivedAt))
    .orderBy(asc(cities.name));
  const addRowCities = allCities.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">Venues</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Bars, restaurants, and event spaces. Click a column header to sort; use the filter row
            for a quick narrow. Inline-edit name, capacity, and DNC on any row.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* CSV import — moved off the left nav (session-12 P2
              declutter) to a button here, next to the venue data it
              feeds. */}
          <Button asChild variant="outline">
            <Link href="/import">
              <Upload className="h-4 w-4" /> Import
            </Link>
          </Button>
          <Button asChild>
            <Link href="/venues/new">
              <Plus className="h-4 w-4" /> New venue
            </Link>
          </Button>
        </div>
      </header>

      {rows.length === 0 ? (
        <Card className="border-dashed bg-transparent p-2">
          <EmptyState
            icon={Building2}
            title="No venues yet"
            description="Venues will populate automatically from Google Maps once Phase 5 ships. In the meantime, add them manually or import a CSV."
            action={{ label: "Add a venue", href: "/venues/new" }}
            secondaryAction={{ label: "Import CSV", href: "/import" }}
          />
        </Card>
      ) : (
        <VenuesTable
          rows={flatRows}
          cityOptions={cityOptions}
          addRowCities={addRowCities}
          bulkAction={bulkUpdateVenues}
          currentStaffId={staff.id}
        />
      )}
    </div>
  );
}

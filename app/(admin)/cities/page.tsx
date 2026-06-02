import { Button } from "@/components/ui/button";
import { cities, countries } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { CitiesListClient } from "./_components/cities-list-client";

export const dynamic = "force-dynamic";

/**
 * Master cities directory.
 *
 * Apple-grade pass: groups cities by country with a sticky country
 * header band, a search filter that narrows the list as you type
 * (client-side; the dataset is small), and pill annotations showing
 * timezone + coordinate completeness at a glance.
 *
 * Data loads server-side; the client component handles search +
 * grouping interactively.
 */
export default async function CitiesListPage() {
  const { staff } = await requireStaff();

  const rows = await db
    .select({
      city: cities,
      country: countries,
    })
    .from(cities)
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .where(isNull(cities.archivedAt))
    .orderBy(asc(countries.name), asc(cities.name), asc(cities.region));

  // Flatten to simple shape for the client
  const items = rows.map(({ city, country }) => ({
    id: city.id,
    name: city.name,
    region: city.region,
    countryCode: country.code,
    countryName: country.name,
    timezone: city.timezone,
    lat: city.location?.lat ?? null,
    lng: city.location?.lng ?? null,
  }));

  return (
    <div className="mx-auto flex max-w-5xl animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em]">
            Master directory
          </p>
          <h1 className="mt-2 font-semibold text-4xl tracking-tight">Cities</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 leading-relaxed dark:text-zinc-400">
            {items.length} cit{items.length === 1 ? "y" : "ies"} with timezone + coordinates. Reused
            across every campaign — keep this list clean.
          </p>
        </div>
        <Button asChild>
          <Link href="/cities/new">
            <Plus className="h-3.5 w-3.5" /> New city
          </Link>
        </Button>
      </header>

      <CitiesListClient items={items} currentStaffIsAdmin={hasMinimumRole(staff, "admin")} />
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cities, countries } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CitiesListPage() {
  const rows = await db
    .select({
      city: cities,
      country: countries,
    })
    .from(cities)
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .where(isNull(cities.archivedAt))
    .orderBy(asc(cities.name));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Cities</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Geographic destinations. Each has a timezone and an optional coordinate for venue
            clustering.
          </p>
        </div>
        <Button asChild>
          <Link href="/cities/new">
            <Plus className="h-4 w-4" /> New city
          </Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center">
          <p className="font-serif text-2xl tracking-tight">No cities yet.</p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {rows.map(({ city, country }) => (
            <Link key={city.id} href={`/cities/${city.id}`} className="group">
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors group-hover:bg-stone-50 dark:group-hover:bg-stone-900">
                <div className="flex flex-col gap-0.5">
                  <h2 className="font-medium">{city.name}</h2>
                  <p className="text-stone-500 text-xs">
                    {country.name}
                    {city.region ? ` · ${city.region}` : ""} · {city.timezone}
                    {city.location && (
                      <>
                        {" · "}
                        <span className="font-mono">
                          {city.location.lat.toFixed(4)}, {city.location.lng.toFixed(4)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

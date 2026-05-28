import { Button } from "@/components/ui/button";
import { cities, countries } from "@/db/schema";
import { getSuperUserOrNull } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HardDeleteButton } from "../../_components/hard-delete-button";
import { archiveCity, hardDeleteCity, updateCity } from "../_actions";
import { CityForm } from "../_components/city-form";

export const dynamic = "force-dynamic";

export default async function EditCityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [city, countriesList, superUser] = await Promise.all([
    db
      .select()
      .from(cities)
      .where(eq(cities.id, id))
      .limit(1)
      .then((r) => r[0]),
    db.select().from(countries).orderBy(asc(countries.name)),
    getSuperUserOrNull(),
  ]);
  if (!city) notFound();

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateCity(id, prev, fd);
  }
  async function boundArchive() {
    "use server";
    await archiveCity(id);
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/cities"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All cities
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight ">{city.name}</h1>
      </header>

      <CityForm
        mode="edit"
        initial={{
          countryCode: city.countryCode,
          name: city.name,
          region: city.region,
          timezone: city.timezone,
          location: city.location,
        }}
        countries={countriesList}
        action={boundUpdate}
      />

      <form
        action={boundArchive}
        className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
      >
        <div>
          <p className="font-medium text-amber-900 text-sm dark:text-amber-200">
            Archive this city
          </p>
          <p className="mt-1 text-amber-800 text-xs dark:text-amber-300">
            Venues in this city remain queryable; the city stops appearing in pickers and lists.
          </p>
        </div>
        <Button type="submit" variant="destructive">
          Archive
        </Button>
      </form>

      {superUser ? (
        <HardDeleteButton
          label={`city "${city.name}"`}
          matchText={city.name}
          redirectTo="/cities"
          action={async () => {
            "use server";
            return hardDeleteCity(id);
          }}
        />
      ) : null}
    </div>
  );
}

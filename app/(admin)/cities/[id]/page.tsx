import { cities, countries } from "@/db/schema";
import { getMinimumRoleOrNull, getSuperUserOrNull } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HardDeleteButton } from "../../_components/hard-delete-button";
import { archiveCity, hardDeleteCity, updateCity } from "../_actions";
import { ArchiveWithReason } from "../_components/archive-with-reason";
import { CityForm } from "../_components/city-form";

export const dynamic = "force-dynamic";

export default async function EditCityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [city, countriesList, superUser, leadOrAbove] = await Promise.all([
    db
      .select()
      .from(cities)
      .where(eq(cities.id, id))
      .limit(1)
      .then((r) => r[0]),
    db.select().from(countries).orderBy(asc(countries.name)),
    getSuperUserOrNull(),
    // Archiving a city is a lead+ override; gate the UI with the same bar
    // the action enforces server-side.
    getMinimumRoleOrNull("lead"),
  ]);
  if (!city) notFound();

  const canArchive = leadOrAbove !== null;

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateCity(id, prev, fd);
  }
  async function boundArchive(fd: FormData) {
    "use server";
    const reason = (fd.get("reason") as string | null) ?? "";
    await archiveCity(id, reason);
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

      <ArchiveWithReason
        action={boundArchive}
        title="Archive this city"
        description="Venues in this city remain queryable; the city stops appearing in pickers and lists."
        triggerLabel="Archive"
        confirmLabel="Archive city"
        reasonPlaceholder="Why is this city being archived?"
        canArchive={canArchive}
        disabledHint="Archiving a city requires lead or admin role."
      />

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

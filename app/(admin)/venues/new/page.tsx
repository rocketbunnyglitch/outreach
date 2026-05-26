import { Alert } from "@/components/ui/alert";
import { cities } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createVenue } from "../_actions";
import { VenueForm } from "../_components/venue-form";

export const dynamic = "force-dynamic";

export default async function NewVenuePage() {
  const citiesList = await db
    .select({
      id: cities.id,
      name: cities.name,
      region: cities.region,
    })
    .from(cities)
    .where(isNull(cities.archivedAt))
    .orderBy(asc(cities.name));

  // Can't create a venue without at least one city
  if (citiesList.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/venues"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          <ChevronLeft className="h-3 w-3" /> All venues
        </Link>
        <Alert tone="info">
          You need at least one active city before you can add a venue.{" "}
          <Link href="/cities/new" className="underline">
            Create a city
          </Link>{" "}
          first.
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/venues"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          <ChevronLeft className="h-3 w-3" /> All venues
        </Link>
        <h1 className="mt-3 font-serif text-4xl tracking-tight">New venue</h1>
      </header>

      <VenueForm mode="create" cities={citiesList} action={createVenue} />
    </div>
  );
}

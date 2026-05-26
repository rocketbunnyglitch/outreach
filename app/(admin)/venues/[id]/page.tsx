import { Button } from "@/components/ui/button";
import { cities, venues } from "@/db/schema";
import { listOutreachBrands } from "@/lib/brand-context";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveVenue, getVenueOutreachLog, logOutreach, updateVenue } from "../_actions";
import { OutreachLogSection } from "../_components/outreach-log-section";
import { VenueForm } from "../_components/venue-form";

export const dynamic = "force-dynamic";

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [venue, citiesList, outreachBrandsList, outreachEntries, currentCampaign] =
    await Promise.all([
      db
        .select()
        .from(venues)
        .where(eq(venues.id, id))
        .limit(1)
        .then((r) => r[0]),
      db
        .select({ id: cities.id, name: cities.name, region: cities.region })
        .from(cities)
        .where(isNull(cities.archivedAt))
        .orderBy(asc(cities.name)),
      listOutreachBrands(),
      getVenueOutreachLog(id),
      getCurrentCampaign(),
    ]);
  if (!venue) notFound();

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateVenue(id, prev, fd);
  }
  async function boundArchive() {
    "use server";
    await archiveVenue(id);
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-8">
        <header>
          <Link
            href="/venues"
            className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            <ChevronLeft className="h-3 w-3" /> All venues
          </Link>
          <h1 className="mt-3 font-serif text-4xl tracking-tight">{venue.name}</h1>
        </header>

        <VenueForm
          mode="edit"
          initial={{
            cityId: venue.cityId,
            name: venue.name,
            googlePlaceId: venue.googlePlaceId,
            address: venue.address,
            location: venue.location,
            phoneE164: venue.phoneE164,
            email: venue.email,
            websiteUrl: venue.websiteUrl,
            instagramHandle: venue.instagramHandle,
            capacity: venue.capacity,
            servesAlcohol: venue.servesAlcohol,
            internalNotes: venue.internalNotes,
            doNotContact: venue.doNotContact,
            doNotContactReason: venue.doNotContactReason,
          }}
          cities={citiesList}
          action={boundUpdate}
        />
      </div>

      <OutreachLogSection
        venueId={id}
        outreachBrands={outreachBrandsList.map((b) => ({
          id: b.id,
          displayName: b.displayName,
        }))}
        entries={outreachEntries}
        action={logOutreach}
        defaultOutreachBrandId={currentCampaign?.outreachBrand.id}
      />

      <form
        action={boundArchive}
        className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
      >
        <div>
          <p className="font-medium text-amber-900 text-sm dark:text-amber-200">
            Archive this venue
          </p>
          <p className="mt-1 text-amber-800 text-xs dark:text-amber-300">
            Existing outreach history is preserved. The venue stops appearing in pickers.
          </p>
        </div>
        <Button type="submit" variant="destructive">
          Archive
        </Button>
      </form>
    </div>
  );
}

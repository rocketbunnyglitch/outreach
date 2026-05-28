import { Button } from "@/components/ui/button";
import { cities, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { loadComposerData } from "@/lib/composer-data";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { listNotes } from "@/lib/notes";
import { logManualSend, sendOutreachEmail } from "@/lib/send-outreach";
import { acceptSuggestion, dismissSuggestion } from "@/lib/smart-notes-actions";
import { loadPendingSuggestionsForNotes } from "@/lib/smart-notes-queries";
import { asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createNote, deleteNote } from "../../_components/notes-actions";
import { NotesSection } from "../../_components/notes-section";
import { archiveVenue, getVenueOutreachLog, logOutreach, updateVenue } from "../_actions";
import { OutreachLogSection } from "../_components/outreach-log-section";
import { SendComposer } from "../_components/send-composer";
import { VenueForm } from "../_components/venue-form";

export const dynamic = "force-dynamic";

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { staff } = await requireStaff();

  const [venue, citiesList, outreachBrandsList, outreachEntries, currentCampaign, notesList] =
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
      listNotes("venue", id, staff.id),
    ]);
  if (!venue) notFound();

  // Composer data — templates + inbox throttle status per brand for THIS staffer
  const composerBrandConfig = await loadComposerData({
    staffMemberId: staff.id,
    outreachBrandIds: outreachBrandsList.map((b) => b.id),
  });

  // Smart-note suggestions for these notes
  const suggestionsMap = await loadPendingSuggestionsForNotes(notesList.map((n) => n.id));
  const suggestionsByNote: Record<
    string,
    typeof suggestionsMap extends Map<string, infer V> ? V : never
  > = {};
  for (const [k, v] of suggestionsMap.entries()) suggestionsByNote[k] = v;

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
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> All venues
          </Link>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight ">{venue.name}</h1>
        </header>

        <VenueForm
          mode="edit"
          initial={{
            id: venue.id,
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
            hours: venue.hours,
            internalNotes: venue.internalNotes,
            doNotContact: venue.doNotContact,
            doNotContactReason: venue.doNotContactReason,
          }}
          cities={citiesList}
          action={boundUpdate}
        />
      </div>

      <SendComposer
        venueId={id}
        venueEmail={venue.email}
        brands={outreachBrandsList.map((b) => ({
          id: b.id,
          displayName: b.displayName,
          outreachPhase: (b.outreachPhase as 1 | 2 | 3 | 4) ?? 1,
        }))}
        defaultBrandId={outreachBrandsList[0]?.id ?? null}
        initialPreviewVars={{
          venueName: venue.name,
          cityName: citiesList.find((c) => c.id === venue.cityId)?.name ?? "",
          venueAddress: venue.address,
          venueWebsite: venue.websiteUrl,
          staffFirstName: (staff.displayName ?? "").split(" ")[0] ?? "",
          staffFullName: staff.displayName ?? "",
        }}
        brandConfig={composerBrandConfig}
        sendAction={sendOutreachEmail}
        manualLogAction={logManualSend}
      />

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

      <NotesSection
        targetType="venue"
        targetId={id}
        notes={notesList}
        suggestionsByNote={suggestionsByNote}
        acceptSuggestionAction={acceptSuggestion}
        dismissSuggestionAction={dismissSuggestion}
        createAction={createNote}
        deleteAction={deleteNote}
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

import { Button } from "@/components/ui/button";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { getSuperUserOrNull, requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { loadComposerData } from "@/lib/composer-data";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { listNotes } from "@/lib/notes";
import { logManualSend, sendOutreachEmail } from "@/lib/send-outreach";
import { acceptSuggestion, dismissSuggestion } from "@/lib/smart-notes-actions";
import { loadPendingSuggestionsForNotes } from "@/lib/smart-notes-queries";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HardDeleteButton } from "../../_components/hard-delete-button";
import { createNote, deleteNote } from "../../_components/notes-actions";
import { NotesSection } from "../../_components/notes-section";
import type { WristbandRowData } from "../../wristbands/_components/wristband-shipping-row";
import {
  archiveVenue,
  getVenueOutreachLog,
  hardDeleteVenue,
  logOutreach,
  updateVenue,
} from "../_actions";
import { type CrawlHistoryRow, CrawlHistorySection } from "../_components/crawl-history-section";
import { OutreachLogSection } from "../_components/outreach-log-section";
import { SendComposer } from "../_components/send-composer";
import { VenueForm } from "../_components/venue-form";
import { VenueQuickLinks, VenueSummaryStrip } from "../_components/venue-summary-strip";
import { VenueWristbandSection } from "../_components/venue-wristband-section";

export const dynamic = "force-dynamic";

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { staff } = await requireStaff();
  const superUser = await getSuperUserOrNull();

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

  // Confirmed/scheduled crawl history for this venue. Guarded so a query
  // failure (e.g. an enum value not yet migrated) degrades to an empty
  // section instead of 500-ing the whole venue page (CLAUDE.md §12.3/§12.4).
  // NOTE: 'scheduled' is intentionally omitted from the filter until the
  // venue_event_status enum migration is deployed — querying for an enum
  // label the DB doesn't have yet throws. Add it here once migrated.
  let crawlHistory: CrawlHistoryRow[] = [];
  try {
    crawlHistory = await db
      .select({
        eventId: events.id,
        cityCampaignId: cityCampaigns.id,
        eventDate: events.eventDate,
        dayPart: events.dayPart,
        crawlNumber: events.crawlNumber,
        routeLabel: events.routeLabel,
        role: venueEvents.role,
        status: venueEvents.status,
        cityName: cities.name,
        campaignName: campaigns.name,
      })
      .from(venueEvents)
      .innerJoin(events, eq(venueEvents.eventId, events.id))
      .innerJoin(cityCampaigns, eq(events.cityCampaignId, cityCampaigns.id))
      .innerJoin(campaigns, eq(cityCampaigns.campaignId, campaigns.id))
      .innerJoin(cities, eq(cityCampaigns.cityId, cities.id))
      .where(
        and(
          eq(venueEvents.venueId, id),
          inArray(venueEvents.status, ["confirmed", "contract_signed"]),
        ),
      )
      .orderBy(desc(events.eventDate));
  } catch (err) {
    console.error("[venue] crawl history query failed", err);
  }

  // Wristband shipping rows — only the wristband-role venue_events for this
  // venue. Guarded like crawlHistory so a query failure degrades gracefully.
  let wristbandRows: WristbandRowData[] = [];
  try {
    const rows = await db
      .select({
        venueEventId: venueEvents.id,
        venueId: venues.id,
        venueName: venues.name,
        cityName: cities.name,
        campaignName: campaigns.name,
        eventDate: events.eventDate,
        veStatus: venueEvents.status,
        wristbandId: wristbands.id,
        quantity: wristbands.quantity,
        status: wristbands.status,
        recipientName: wristbands.recipientName,
        recipientPhone: wristbands.recipientPhone,
        shippingAddress: wristbands.shippingAddress,
        carrier: wristbands.carrier,
        trackingNumber: wristbands.trackingNumber,
        shippedAt: wristbands.shippedAt,
        deliveredAt: wristbands.deliveredAt,
        expectedDeliveryDate: wristbands.expectedDeliveryDate,
      })
      .from(venueEvents)
      .innerJoin(venues, eq(venues.id, venueEvents.venueId))
      .innerJoin(cities, eq(cities.id, venues.cityId))
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
      .where(and(eq(venueEvents.venueId, id), eq(venueEvents.role, "wristband")))
      .orderBy(desc(events.eventDate));
    wristbandRows = rows.map((r) => ({
      ...r,
      eventDate: String(r.eventDate),
      expectedDeliveryDate: r.expectedDeliveryDate ? String(r.expectedDeliveryDate) : null,
    }));
  } catch (err) {
    console.error("[venue] wristband shipping query failed", err);
  }

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateVenue(id, prev, fd);
  }
  async function boundArchive() {
    "use server";
    await archiveVenue(id);
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Header — name, breadcrumb, at-a-glance summary, quick links */}
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/venues"
              className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <ChevronLeft className="h-3 w-3" /> All venues
            </Link>
            <h1 className="mt-3 truncate font-semibold text-4xl tracking-tight">{venue.name}</h1>
            {venue.address && <p className="mt-1 text-sm text-zinc-500">{venue.address}</p>}
          </div>
          <VenueQuickLinks
            phoneE164={venue.phoneE164}
            email={venue.email}
            websiteUrl={venue.websiteUrl}
            instagramHandle={venue.instagramHandle}
            googlePlaceId={venue.googlePlaceId}
            address={venue.address}
            venueName={venue.name}
          />
        </div>
        <VenueSummaryStrip
          lastTouchAt={outreachEntries[0]?.createdAt ?? null}
          lastTouchChannel={outreachEntries[0]?.channel ?? null}
          touchCount={outreachEntries.length}
          crawlsCount={crawlHistory.length}
          doNotContact={venue.doNotContact}
          doNotContactReason={venue.doNotContactReason}
          archivedAt={venue.archivedAt}
        />
      </header>

      {/* Activity-first: what staffers reach for the moment they open the page */}
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

      <CrawlHistorySection rows={crawlHistory} />

      <VenueWristbandSection rows={wristbandRows} />

      {/* Edit form is moved below activity — staffers see/change the record's
          fields when they need to, but the journal is the primary surface. */}
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

      {superUser ? (
        <HardDeleteButton
          label={`venue "${venue.name}"`}
          matchText={venue.name}
          redirectTo="/venues"
          action={async () => {
            "use server";
            return hardDeleteVenue(id);
          }}
        />
      ) : null}
    </div>
  );
}

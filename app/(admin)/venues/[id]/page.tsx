import { Button } from "@/components/ui/button";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  outreachBrands,
  users,
  venueDomainAliases,
  venueDomainRelationships,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { getSuperUserOrNull, requireStaff } from "@/lib/auth";
import { listOutreachBrands } from "@/lib/brand-context";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listNotes } from "@/lib/notes";
import { acceptSuggestion, dismissSuggestion } from "@/lib/smart-notes-actions";
import { loadPendingSuggestionsForNotes } from "@/lib/smart-notes-queries";
import {
  loadVenueCommunication,
  loadVenueConfirmationCalls,
  loadVenueConfirmationMessages,
} from "@/lib/venue-communication";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { addDomainAlias, removeDomainAlias } from "../_alias-actions";
import { type CrawlHistoryRow, CrawlHistorySection } from "../_components/crawl-history-section";
import { DomainAliasList } from "../_components/domain-alias-list";
import { OutreachLogSection } from "../_components/outreach-log-section";
import { VenueCommunicationSection } from "../_components/venue-communication-section";
import { VenueConfirmationSection } from "../_components/venue-confirmation-section";
import { VenueDealRoom } from "../_components/venue-deal-room";
import { VenueEmailButton } from "../_components/venue-email-button";
import { VenueEnrichButton } from "../_components/venue-enrich-button";
import { VenueForm } from "../_components/venue-form";
import {
  type VenueRelationshipRow,
  VenueRelationshipsSection,
} from "../_components/venue-relationships-section";
import { VenueQuickLinks, VenueSummaryStrip } from "../_components/venue-summary-strip";
import { VenueWristbandSection } from "../_components/venue-wristband-section";
import { removeVenueRelationship, setVenueRelationship } from "../_relationship-actions";

export const dynamic = "force-dynamic";

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { staff } = await requireStaff();
  const superUser = await getSuperUserOrNull();

  const [
    venue,
    citiesList,
    outreachBrandsList,
    outreachEntries,
    currentCampaign,
    notesList,
    venueCommunication,
  ] = await Promise.all([
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
    // Pulls every email thread tied to this venue across all
    // matching signals (venue_id direct, sender-email match,
    // website-domain match). Renders the Communication Timeline
    // section below. CLAUDE.md §12.3 — wrap in try/catch so an
    // email-side issue degrades the section instead of 500-ing the
    // whole venue page.
    loadVenueCommunication(id, staff.teamId).catch((err) => {
      // Surface the failure (CLAUDE.md 12.4) -- a silently-empty timeline
      // reads to the operator as "the log is broken".
      logger.error({ err, venueId: id }, "loadVenueCommunication failed");
      return {
        threads: [],
        summary: {
          totalThreads: 0,
          totalMessages: 0,
          lastInboundAt: null,
          lastOutboundAt: null,
          needsReplyCount: 0,
          staleCount: 0,
          staffEmails: [],
          staffOwnerNames: [],
        },
      };
    }),
  ]);
  if (!venue) notFound();

  // Inbound replies for this venue's threads, with their written-confirmation
  // flag, for the confirmation section. Reuses the thread ids already resolved
  // above so we don't re-run the venue match. Degrades to empty on error.
  const confirmationMessages = await loadVenueConfirmationMessages(
    venueCommunication.threads.map((t) => t.threadId),
  ).catch((err) => {
    logger.error({ err, venueId: id }, "loadVenueConfirmationMessages failed");
    return [];
  });

  // Logged calls for this venue with their verbal-confirmation flag (phone
  // channel of the same confirmation section). Degrades to empty on error.
  const confirmationCalls = await loadVenueConfirmationCalls(id).catch((err) => {
    logger.error({ err, venueId: id }, "loadVenueConfirmationCalls failed");
    return [];
  });

  // Smart-note suggestions for these notes
  const suggestionsMap = await loadPendingSuggestionsForNotes(notesList.map((n) => n.id));
  const suggestionsByNote: Record<
    string,
    typeof suggestionsMap extends Map<string, infer V> ? V : never
  > = {};
  for (const [k, v] of suggestionsMap.entries()) suggestionsByNote[k] = v;

  // Domain aliases for cross-domain sender matching, newest first,
  // with the adder's name + a per-alias count of threads matched
  // (via inbound mail from a sender on that alias's domain that
  // landed on this venue). The count reinforces the alias's value
  // -- "we've seen 7 threads from this domain" is a clearer signal
  // than just "Alice added this alias 3 weeks ago."
  //
  // createdAt is formatted here (server-side) so the client
  // component renders a plain string -- no client-side date/locale
  // work that could trip hydration.
  const domainAliasRows = await db
    .select({
      id: venueDomainAliases.id,
      domain: venueDomainAliases.domain,
      notes: venueDomainAliases.notes,
      createdAt: venueDomainAliases.createdAt,
      createdByName: users.displayName,
      // Threads attached to THIS venue with at least one inbound
      // message whose from-address ends in @<this alias's domain>.
      // LEFT JOIN through email_threads -> email_messages with a
      // suffix LIKE on from_email_normalized so the count is
      // proportional to the alias's actual triage value.
      matchedThreadCount: sql<number>`(
        SELECT COUNT(DISTINCT t.id)::int
        FROM email_threads t
        JOIN email_messages m ON m.thread_id = t.id
        WHERE t.venue_id = ${id}
          AND t.deleted_at IS NULL
          AND m.direction = 'inbound'
          AND m.from_email_normalized LIKE '%@' || ${venueDomainAliases.domain}
      )`,
    })
    .from(venueDomainAliases)
    .leftJoin(users, eq(users.id, venueDomainAliases.createdBy))
    .where(eq(venueDomainAliases.venueId, id))
    .orderBy(desc(venueDomainAliases.createdAt));
  const domainAliases = domainAliasRows.map((a) => ({
    id: a.id,
    domain: a.domain,
    notes: a.notes,
    createdByName: a.createdByName,
    createdAtLabel: a.createdAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    matchedThreadCount: Number(a.matchedThreadCount ?? 0),
  }));

  // Per-brand relationship flags (Phase 3.8). One row per outreach brand this
  // venue has a recorded relationship with. Guarded like crawlHistory so a
  // query failure (e.g. table not yet migrated on this env) degrades to an
  // empty section instead of 500-ing the page. Dates are formatted server-side
  // (pinned tz) so the client component renders plain strings.
  let relationshipRows: VenueRelationshipRow[] = [];
  try {
    const fmtDate = (d: Date) =>
      d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "America/Toronto",
      });
    const rows = await db
      .select({
        id: venueDomainRelationships.id,
        outreachBrandId: venueDomainRelationships.outreachBrandId,
        brandName: outreachBrands.displayName,
        status: venueDomainRelationships.status,
        setBy: venueDomainRelationships.setBy,
        notes: venueDomainRelationships.notes,
        setAt: venueDomainRelationships.setAt,
        autoClearAt: venueDomainRelationships.autoClearAt,
        setByName: users.displayName,
      })
      .from(venueDomainRelationships)
      .innerJoin(outreachBrands, eq(outreachBrands.id, venueDomainRelationships.outreachBrandId))
      .leftJoin(users, eq(users.id, venueDomainRelationships.setByStaffId))
      .where(eq(venueDomainRelationships.venueId, id))
      .orderBy(asc(outreachBrands.displayName));
    relationshipRows = rows.map((r) => ({
      id: r.id,
      outreachBrandId: r.outreachBrandId,
      brandName: r.brandName,
      status: r.status,
      setBy: r.setBy,
      notes: r.notes,
      setByName: r.setByName,
      setAtLabel: fmtDate(r.setAt),
      autoClearAtLabel: r.autoClearAt ? fmtDate(r.autoClearAt) : null,
    }));
  } catch (err) {
    console.error("[venue] relationship query failed", err);
  }

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
    <div className="flex flex-col gap-6">
      {/* Header -- breadcrumb + name + address. The old top-right quick links +
          enrich live in the right "Quick actions" column now. */}
      <header className="flex flex-col gap-1">
        <Link
          href="/venues"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All venues
        </Link>
        <h1 className="mt-2 truncate font-semibold text-3xl tracking-tight">{venue.name}</h1>
        {venue.address && <p className="text-sm text-zinc-500">{venue.address}</p>}
      </header>

      {/* Deal-room layout: venue info left, modules (email thread default)
          center, quick actions right. All sections + their data/actions are
          unchanged -- just rearranged into slots/tabs. */}
      <VenueDealRoom
        left={
          <>
            <VenueSummaryStrip
              lastTouchAt={outreachEntries[0]?.createdAt ?? null}
              lastTouchChannel={outreachEntries[0]?.channel ?? null}
              touchCount={outreachEntries.length}
              crawlsCount={crawlHistory.length}
              doNotContact={venue.doNotContact}
              doNotContactReason={venue.doNotContactReason}
              archivedAt={venue.archivedAt}
            />
            <VenueRelationshipsSection
              venueId={id}
              brands={outreachBrandsList.map((b) => ({ id: b.id, displayName: b.displayName }))}
              relationships={relationshipRows}
              setAction={setVenueRelationship}
              removeAction={removeVenueRelationship}
            />
          </>
        }
        right={
          <div className="card-surface flex flex-col gap-3 p-4">
            <h3 className="font-semibold text-sm tracking-tight">Quick actions</h3>
            <VenueEmailButton venueId={venue.id} email={venue.email} />
            <VenueEnrichButton venueId={venue.id} />
            <VenueQuickLinks
              venueId={venue.id}
              phoneE164={venue.phoneE164}
              email={venue.email}
              websiteUrl={venue.websiteUrl}
              instagramHandle={venue.instagramHandle}
              googlePlaceId={venue.googlePlaceId}
              address={venue.address}
              venueName={venue.name}
            />
          </div>
        }
        tabs={[
          {
            id: "email",
            label: "Email thread",
            count: venueCommunication.threads.length,
            content: (
              <div className="flex flex-col gap-6">
                <VenueConfirmationSection
                  venueId={id}
                  messages={confirmationMessages}
                  calls={confirmationCalls}
                />
                <VenueCommunicationSection data={venueCommunication} />
              </div>
            ),
          },
          {
            id: "notes",
            label: "Notes",
            count: notesList.length,
            content: (
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
            ),
          },
          {
            id: "calls",
            label: "Calls & log",
            count: outreachEntries.length,
            content: (
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
            ),
          },
          {
            id: "crawls",
            label: "Crawls",
            count: crawlHistory.length,
            content: (
              <div className="flex flex-col gap-6">
                <CrawlHistorySection rows={crawlHistory} />
                <VenueWristbandSection rows={wristbandRows} />
              </div>
            ),
          },
          {
            id: "details",
            label: "Details",
            content: (
              <div className="flex flex-col gap-6">
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
                    contactName: venue.contactName,
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
                <DomainAliasList
                  venueId={id}
                  aliases={domainAliases}
                  addAction={addDomainAlias}
                  removeAction={removeDomainAlias}
                />
                <form
                  action={boundArchive}
                  className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950"
                >
                  <div>
                    <p className="font-medium text-rose-900 text-sm dark:text-rose-200">
                      Archive this venue
                    </p>
                    <p className="mt-1 text-rose-800 text-xs dark:text-rose-300">
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
            ),
          },
        ]}
      />
    </div>
  );
}

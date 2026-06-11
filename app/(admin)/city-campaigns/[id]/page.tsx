import { MapsApp } from "@/app/(admin)/maps/_components/maps-app";
import { Button } from "@/components/ui/button";
import { events, campaigns, cities, cityCampaigns, staffMembers, venueEvents } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { loadCitySheet } from "@/lib/city-sheet-data";
import { loadCityThreadFeed } from "@/lib/city-thread-feed";
import { loadCityVenues } from "@/lib/city-venues-data";
import { db } from "@/lib/db";
import { listNotes } from "@/lib/notes";
import { acceptSuggestion, dismissSuggestion } from "@/lib/smart-notes-actions";
import { loadPendingSuggestionsForNotes } from "@/lib/smart-notes-queries";
import type { CityStatusPill } from "@/lib/tracker-status";
import { asc, count, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ClientOnly } from "../../_components/client-only";
import { createNote, deleteNote } from "../../_components/notes-actions";
import { NotesSection } from "../../_components/notes-section";
import { SmartBackButton } from "../../_components/smart-back-button";
import { removeCityCampaign, updateCityCampaign } from "../_actions";
import { loadEscalationTargets } from "../_actions/escalation-actions";
import { loadColdOutreach } from "../_cold-outreach-actions";
import { CityTime } from "../_components/CityTime";
import { AddCrawlRow } from "../_components/add-crawl-row";
import { CityCampaignForm } from "../_components/city-campaign-form";
import { CityEmailFeed } from "../_components/city-email-feed";
import { CityPresence } from "../_components/city-presence";
import { CitySheetHeader } from "../_components/city-sheet-header";
import { CityVenuesTable } from "../_components/city-venues-table";
import { ColdOutreachTable } from "../_components/cold-outreach-table";
import { CrawlSlotTable } from "../_components/crawl-slot-table";
import { PasteMapsUrl } from "../_components/paste-maps-url";

export const dynamic = "force-dynamic";

export default async function CityCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { staff: currentStaff } = await requireStaff();

  const [cc, _eventRows, staff, notesList] = await Promise.all([
    db
      .select({
        cc: cityCampaigns,
        city: cities,
        campaign: campaigns,
        leadStaff: staffMembers,
      })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .leftJoin(staffMembers, eq(staffMembers.id, cityCampaigns.leadStaffId))
      .where(eq(cityCampaigns.id, id))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        event: events,
        // Count of venue-events per event, grouped at the SQL layer.
      })
      .from(events)
      .where(eq(events.cityCampaignId, id))
      .orderBy(asc(events.eventDate), asc(events.slotNumber)),
    db
      .select({ id: staffMembers.id, displayName: staffMembers.displayName })
      .from(staffMembers)
      .where(eq(staffMembers.status, "active"))
      .orderBy(asc(staffMembers.displayName)),
    listNotes("city_campaign", id, currentStaff.id),
  ]);
  if (!cc) notFound();

  // City centroid for the discovery map (PostGIS geography -> lat/lng).
  // Falls back to Toronto if the city has no stored location.
  const { sql } = await import("drizzle-orm");
  const coordResult = await db.execute<{ lat: number | null; lng: number | null }>(sql`
    SELECT CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location::geometry) END AS lat,
           CASE WHEN location IS NULL THEN NULL ELSE ST_X(location::geometry) END AS lng
      FROM cities WHERE id = ${cc.city.id} LIMIT 1
  `);
  const coordRow = Array.isArray(coordResult)
    ? (coordResult as unknown as Array<{ lat: number | null; lng: number | null }>)[0]
    : (coordResult as unknown as { rows: Array<{ lat: number | null; lng: number | null }> })
        .rows?.[0];
  const cityCenter = {
    lat: coordRow?.lat != null ? Number(coordRow.lat) : 43.6532,
    lng: coordRow?.lng != null ? Number(coordRow.lng) : -79.3832,
  };

  // Smart-note suggestions
  const suggestionsMap = await loadPendingSuggestionsForNotes(notesList.map((n) => n.id));
  const suggestionsByNote: Record<
    string,
    typeof suggestionsMap extends Map<string, infer V> ? V : never
  > = {};
  for (const [k, v] of suggestionsMap.entries()) suggestionsByNote[k] = v;

  // Per-event venue counts as a separate query (kept simple, joins get
  // hairy with group-bys in Drizzle's typed builder).
  const venueCounts = await db
    .select({
      eventId: venueEvents.eventId,
      n: count(venueEvents.id),
    })
    .from(venueEvents)
    .groupBy(venueEvents.eventId);
  const countByEvent = new Map<string, number>();
  for (const row of venueCounts) {
    countByEvent.set(row.eventId, Number(row.n));
  }

  // Load the premium city-sheet shape (per-crawl slot tables, etc.)
  const sheetData = await loadCitySheet(id);

  // Cold outreach pipeline for this city_campaign
  const coldOutreach = await loadColdOutreach(id);

  // Every venue in the city DB + its slot history. Renders below
  // the cold-outreach worksheet so the operator sees the full
  // market footprint, with previously-used venues pinned to the
  // top. See lib/city-venues-data.ts.
  const cityVenues = await loadCityVenues({
    cityId: cc.city.id,
    cityCampaignId: id,
  });

  // Escalation target list — eligible non-readonly active staff,
  // pre-sorted admin → lead → outreach. Passed into ColdOutreachTable
  // so the EscalationPopover doesn't have to fetch on open.
  const escalationTargets = await loadEscalationTargets();

  // Aggregate sales + compute status pill the same way the dashboard does
  const totalTicketsSold = sheetData?.crawls.reduce((sum, c) => sum + (c.ticketsSold ?? 0), 0) ?? 0;
  const computedStatusPill: CityStatusPill = (() => {
    if (cc.cc.status === "cancelled") return "cancelled";
    if (!sheetData) return "outreach";
    // need-N-venues only makes sense for a single-crawl city (operator
    // request 2026-06-10): with multiple crawls the open-slot total reads
    // as noise, so multi-crawl cities just show active/cancelled.
    if (sheetData.crawls.length > 1) return "outreach";
    let openSlots = 0;
    for (const crawl of sheetData.crawls) {
      const unfilled = crawl.slots.filter(
        (s) =>
          s.venueEventId == null &&
          (s.role === "wristband" || s.role === "middle" || s.role === "final"),
      );
      openSlots += unfilled.length;
    }
    if (openSlots === 0) return "outreach";
    if (openSlots === 1) return "need_1_venue";
    if (openSlots === 2) return "need_2_venues";
    return "need_3_venues";
  })();

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateCityCampaign(id, prev, fd);
  }
  async function boundRemove() {
    "use server";
    await removeCityCampaign(id);
  }

  // Shared by both warm + cold ColdOutreachTable mounts: the set of
  // crawls eligible for the promote-to-slot picker. All viable
  // day/night parts (previously night-only — operator flagged that
  // "Saturday Day Crawl" never appeared in the picker).
  //
  // Defined once so the cold-mode table can use the same filter for
  // the "instant assign from cold queue" affordance per operator
  // feedback: "From cold outreach you should be able to also
  // instantly assign to a crawl not just move to warm leads".
  const crawlsForPromote =
    sheetData?.crawls
      .filter(
        (
          c,
        ): c is typeof c & {
          dayPart:
            | "thursday_night"
            | "friday_night"
            | "saturday_day"
            | "saturday_night"
            | "sunday_day"
            | "sunday_night";
        } =>
          c.dayPart === "thursday_night" ||
          c.dayPart === "friday_night" ||
          c.dayPart === "saturday_day" ||
          c.dayPart === "saturday_night" ||
          c.dayPart === "sunday_day" ||
          c.dayPart === "sunday_night",
      )
      .map((c) => ({
        eventId: c.eventId,
        dayPart: c.dayPart,
        crawlNumber: c.crawlNumber,
        middleVenueGroupId: c.middleVenueGroupId,
        filledSlots: c.slots
          .filter((s) => s.venueEventId != null)
          .map((s) => ({
            role: s.role,
            slotPosition: s.slotPosition,
            venueName: s.venueName,
          })),
      })) ?? [];

  return (
    <div className="mx-auto flex max-w-6xl animate-[fade-in_300ms_ease-out] flex-col gap-8">
      {/* Back link — returns to THIS campaign's operations dashboard
          (sets the current-campaign cookie + redirects to /). Operators
          flagged that this previously went to the campaign SETUP page;
          the ops dashboard is the expected destination (session 12). */}
      <SmartBackButton
        fallbackHref="/"
        label={cc.campaign.name}
        className="inline-flex w-fit items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] hover:text-zinc-900 dark:hover:text-zinc-100"
      />

      {/* Current time in the city + viewer's local time.
          Helps avoid "scheduling a call at 3pm without realizing that's
          3am there" mistakes. */}
      <CityTime
        cityName={cc.city.name}
        cityTimezone={cc.city.timezone}
        viewerTimezone={currentStaff.timezone ?? "America/Toronto"}
      />

      {/* Premium header */}
      {sheetData && (
        <CitySheetHeader
          data={sheetData}
          totalTicketsSold={totalTicketsSold}
          statusPill={computedStatusPill}
        />
      )}

      {/* Crawls grouped by day */}
      {sheetData && sheetData.crawls.length > 0 ? (
        <section className="flex flex-col gap-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-2xl tracking-tight">Crawls</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {sheetData.crawls.length} crawl{sheetData.crawls.length === 1 ? "" : "s"} across{" "}
                {Array.from(new Set(sheetData.crawls.map((c) => c.dayPart))).length} day
                {Array.from(new Set(sheetData.crawls.map((c) => c.dayPart))).length === 1
                  ? ""
                  : "s"}{" "}
                · default 4 slots per crawl (Wristband, Middle 1, Middle 2, Final)
              </p>
            </div>
            {/* Live presence — avatar stack here, cursor overlay is fixed.
                Dormant until the /ws sidecar is live. Wrapped in
                ClientOnly because usePresence opens a WebSocket and
                useMeetingMode reads localStorage — both browser-only
                state. Same hydration-risk class as the dashboard
                header's WhosOnline + MeetingMode (see app/(admin)/page.tsx). */}
            <ClientOnly>
              <CityPresence cityCampaignId={id} viewerName={currentStaff.displayName} />
            </ClientOnly>
          </header>
          {sheetData.crawls.map((crawl) => (
            <div key={crawl.eventId} id={`crawl-${crawl.eventId}`} className="scroll-mt-24">
              <CrawlSlotTable
                crawl={crawl}
                cityId={sheetData.cityId}
                cityCampaignId={sheetData.cityCampaignId}
                campaignId={cc.campaign.id}
                staff={sheetData.staff}
              />
            </div>
          ))}
          <AddCrawlRow cityCampaignId={id} cityName={cc.city.name} />
        </section>
      ) : (
        <section className="card-surface-quiet flex flex-col gap-4 border-dashed p-8 text-center">
          <p className="font-medium text-base text-zinc-700 dark:text-zinc-300">No crawls yet</p>
          <p className="text-xs text-zinc-500">
            Add the first crawl below. You can edit the per-venue hours after attaching venues.
          </p>
          <div className="mx-auto w-full max-w-xl text-left">
            <AddCrawlRow cityCampaignId={id} cityName={cc.city.name} />
          </div>
        </section>
      )}

      <ColdOutreachTable
        cityCampaignId={id}
        cityId={cc.city.id}
        outreachBrandId={cc.campaign.outreachBrandId ?? null}
        entries={coldOutreach}
        staff={sheetData?.staff ?? []}
        currentStaffId={currentStaff.id}
        currentStaffIsAdmin={hasMinimumRole(currentStaff, "admin")}
        escalationTargets={escalationTargets}
        googleMapsApiKey={
          process.env.GOOGLE_MAPS_BROWSER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? undefined
        }
        mode="warm"
        crawlsForPromote={crawlsForPromote}
      />

      <ColdOutreachTable
        cityCampaignId={id}
        cityId={cc.city.id}
        outreachBrandId={cc.campaign.outreachBrandId ?? null}
        entries={coldOutreach}
        staff={sheetData?.staff ?? []}
        currentStaffId={currentStaff.id}
        currentStaffIsAdmin={hasMinimumRole(currentStaff, "admin")}
        escalationTargets={escalationTargets}
        googleMapsApiKey={
          process.env.GOOGLE_MAPS_BROWSER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? undefined
        }
        crawlsForPromote={crawlsForPromote}
      />

      {/* Every venue in the city DB + slot history. Mounts right
          below the cold-outreach worksheet so the operator can
          glance at "who do we already know in this market" and
          add anyone missing to the cold pipeline with one click.
          Previously-used venues pin to the top. */}
      <CityVenuesTable
        cityCampaignId={id}
        cityId={cc.city.id}
        cityName={cc.city.name}
        rows={cityVenues.rows}
        totalInCity={cityVenues.totalInCity}
        capped={cityVenues.capped}
        currentStaffIsAdmin={hasMinimumRole(currentStaff, "admin")}
        outreachBrandId={cc.campaign.outreachBrandId ?? null}
      />

      {/* Paste a Google Maps URL → directory + cold-outreach entry */}
      {process.env.GOOGLE_MAPS_API_KEY && <PasteMapsUrl cityCampaignId={id} />}

      {/* Visual venue discovery -- the full Google Maps surface from the
          Maps tab, centered on this city with an empty search box (staff
          type "bars"/"clubs"/"restaurants"). Adding a place attaches it to
          this campaign's cold-outreach list. Uses the BROWSER key
          (referrer-restricted, Maps JS only), falling back to the server
          key. */}
      {(process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY) && (
        <MapsApp
          googleMapsApiKey={
            process.env.GOOGLE_MAPS_BROWSER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? ""
          }
          cities={[
            {
              id: cc.city.id,
              name: cc.city.name,
              region: cc.city.region,
              lat: cityCenter.lat,
              lng: cityCenter.lng,
            },
          ]}
          defaultCenter={cityCenter}
          attachCityCampaignId={id}
          heightClassName="h-[32rem]"
        />
      )}

      {/* City inbox — every email sent from / received for this city's
          venues under this campaign, so anyone working the city has
          instant visibility (operator request 2026-06-11). Read-only;
          rows deep-link into /inbox for replies. */}
      <CityEmailFeed feed={await loadCityThreadFeed(id)} cityName={cc.city.name} />

      <NotesSection
        targetType="city_campaign"
        targetId={id}
        notes={notesList}
        suggestionsByNote={suggestionsByNote}
        acceptSuggestionAction={acceptSuggestion}
        dismissSuggestionAction={dismissSuggestion}
        createAction={createNote}
        deleteAction={deleteNote}
      />

      <details className="rounded-2xl border border-zinc-200/60 bg-white/40 dark:border-zinc-800/40 dark:bg-zinc-950/40">
        <summary className="cursor-pointer px-5 py-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] hover:text-zinc-900 dark:hover:text-zinc-100">
          Settings · edit city-campaign details
        </summary>
        <div className="border-zinc-200/60 border-t px-5 py-4 dark:border-zinc-800/40">
          <CityCampaignForm
            initial={cc.cc}
            staff={staff}
            isAdmin={hasMinimumRole(currentStaff, "admin")}
            action={boundUpdate}
          />
        </div>
      </details>

      <form
        action={boundRemove}
        className="flex items-center justify-between rounded-2xl border border-rose-200/60 bg-rose-50/40 p-4 dark:border-rose-900/40 dark:bg-rose-950/20"
      >
        <div>
          <p className="font-medium text-rose-900 text-sm dark:text-rose-200">
            Remove this city from the campaign
          </p>
          <p className="mt-1 text-rose-800/80 text-xs dark:text-rose-300/70">
            Deletes the city-campaign and all its events. The city itself stays.
          </p>
        </div>
        <Button type="submit" variant="destructive">
          Remove
        </Button>
      </form>
    </div>
  );
}

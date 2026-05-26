import { Button } from "@/components/ui/button";
import { events, campaigns, cities, cityCampaigns, staffMembers, venueEvents } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { loadCitySheet } from "@/lib/city-sheet-data";
import { db } from "@/lib/db";
import { listNotes } from "@/lib/notes";
import { acceptSuggestion, dismissSuggestion } from "@/lib/smart-notes-actions";
import { loadPendingSuggestionsForNotes } from "@/lib/smart-notes-queries";
import type { CityStatusPill } from "@/lib/tracker-status";
import { findWarmLeads } from "@/lib/warm-leads";
import { asc, count, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createNote, deleteNote } from "../../_components/notes-actions";
import { NotesSection } from "../../_components/notes-section";
import { WarmLeadsPanel } from "../../_components/warm-leads-panel";
import { removeCityCampaign, updateCityCampaign } from "../_actions";
import { CityCampaignForm } from "../_components/city-campaign-form";
import { CitySheetHeader } from "../_components/city-sheet-header";
import { CrawlSlotTable } from "../_components/crawl-slot-table";

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

  // Smart-note suggestions
  const suggestionsMap = await loadPendingSuggestionsForNotes(notesList.map((n) => n.id));
  const suggestionsByNote: Record<
    string,
    typeof suggestionsMap extends Map<string, infer V> ? V : never
  > = {};
  for (const [k, v] of suggestionsMap.entries()) suggestionsByNote[k] = v;

  // Warm leads — venues confirmed or with positive outreach in past
  // campaigns in this city, excluding the current one.
  const warmLeads = await findWarmLeads({
    cityId: cc.city.id,
    excludeCampaignId: cc.campaign.id,
    limit: 30,
  });

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

  // Aggregate sales + compute status pill the same way the dashboard does
  const totalTicketsSold = sheetData?.crawls.reduce((sum, c) => sum + (c.ticketsSold ?? 0), 0) ?? 0;
  const computedStatusPill: CityStatusPill = (() => {
    if (cc.cc.status === "cancelled") return "cancelled";
    if (!sheetData) return "outreach";
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

  return (
    <div className="mx-auto flex max-w-6xl animate-[fade-in_300ms_ease-out] flex-col gap-8">
      {/* Back link */}
      <Link
        href={`/campaigns/${cc.campaign.id}`}
        className="inline-flex w-fit items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ChevronLeft className="h-3 w-3" /> {cc.campaign.name}
      </Link>

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
          <header>
            <h2 className="font-semibold text-2xl tracking-tight">Crawls</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {sheetData.crawls.length} crawl{sheetData.crawls.length === 1 ? "" : "s"} across{" "}
              {Array.from(new Set(sheetData.crawls.map((c) => c.dayPart))).length} day
              {Array.from(new Set(sheetData.crawls.map((c) => c.dayPart))).length === 1 ? "" : "s"}{" "}
              · default 4 slots per crawl (Wristband, Middle 1, Middle 2, Final)
            </p>
          </header>
          {sheetData.crawls.map((crawl) => (
            <CrawlSlotTable
              key={crawl.eventId}
              crawl={crawl}
              cityId={sheetData.cityId}
              cityCampaignId={sheetData.cityCampaignId}
              staff={sheetData.staff}
            />
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border border-zinc-300/80 border-dashed bg-white/30 p-12 text-center dark:border-zinc-700/60 dark:bg-zinc-950/30">
          <p className="font-medium text-base text-zinc-700 dark:text-zinc-300">No crawls yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Use the CSV importer at{" "}
            <Link
              href="/admin"
              className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              /admin
            </Link>{" "}
            to bulk-add crawl instances for this city.
          </p>
        </section>
      )}

      <WarmLeadsPanel cityName={cc.city.name} campaignName={cc.campaign.name} leads={warmLeads} />

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
          <CityCampaignForm initial={cc.cc} staff={staff} action={boundUpdate} />
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

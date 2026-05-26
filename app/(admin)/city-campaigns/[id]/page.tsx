import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { events, campaigns, cities, cityCampaigns, staffMembers, venueEvents } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { listNotes } from "@/lib/notes";
import { acceptSuggestion, dismissSuggestion } from "@/lib/smart-notes-actions";
import { loadPendingSuggestionsForNotes } from "@/lib/smart-notes-queries";
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
import { EventsList } from "../_components/events-list";

export const dynamic = "force-dynamic";

export default async function CityCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { staff: currentStaff } = await requireStaff();

  const [cc, eventRows, staff, notesList] = await Promise.all([
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

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateCityCampaign(id, prev, fd);
  }
  async function boundRemove() {
    "use server";
    await removeCityCampaign(id);
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <header>
          <Link
            href={`/campaigns/${cc.campaign.id}`}
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> {cc.campaign.name}
          </Link>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight ">
            {cc.city.name}
            {cc.city.region && <span className="ml-3 text-zinc-400">{cc.city.region}</span>}
          </h1>
          <div className="mt-3 flex items-center gap-3">
            <Badge tone={statusTone(cc.cc.status)}>{cc.cc.status}</Badge>
            <span className="text-sm text-zinc-500">
              priority {cc.cc.priority} · {cc.cc.targetVenueCount} target venues
              {cc.leadStaff && ` · lead ${cc.leadStaff.displayName}`}
            </span>
          </div>
        </header>

        <CityCampaignForm initial={cc.cc} staff={staff} action={boundUpdate} />
      </div>

      <EventsList
        cityCampaignId={id}
        events={eventRows.map((r) => ({
          ...r.event,
          venueCount: countByEvent.get(r.event.id) ?? 0,
        }))}
      />

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

      <form
        action={boundRemove}
        className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
      >
        <div>
          <p className="font-medium text-amber-900 text-sm dark:text-amber-200">
            Remove this city from the campaign
          </p>
          <p className="mt-1 text-amber-800 text-xs dark:text-amber-300">
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

function statusTone(s: string): "default" | "success" | "muted" | "warning" {
  if (s === "active" || s === "confirmed") return "success";
  if (s === "cancelled") return "warning";
  return "default";
}

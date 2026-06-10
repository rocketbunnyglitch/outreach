import { Badge } from "@/components/ui/badge";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  staffMembers,
  venueEvents,
  venues,
} from "@/db/schema";
import { getMinimumRoleOrNull } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveEvent, updateEvent } from "../_actions";
import { ArchiveWithReason } from "../_components/archive-with-reason";
import { DebriefNotes } from "../_components/debrief-notes";
import { EmergencyReplacementButton } from "../_components/emergency-replacement-button";
import { EventForm } from "../_components/event-form";
import { VenueEventsSection } from "../_components/venue-events-section";
import { addVenueToEvent, removeVenueFromEvent, updateVenueEvent } from "../_venue-event-actions";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const eventRow = await db
    .select({
      event: events,
      cc: cityCampaigns,
      city: cities,
      campaign: campaigns,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(eq(events.id, id))
    .limit(1)
    .then((r) => r[0]);
  if (!eventRow) notFound();

  // Debrief author display name (Phase 6.4) -- small lookup so the main
  // eventRow query stays untouched.
  let debriefUpdatedByName: string | null = null;
  if (eventRow.event.debriefUpdatedBy) {
    const [author] = await db
      .select({ displayName: staffMembers.displayName })
      .from(staffMembers)
      .where(eq(staffMembers.id, eventRow.event.debriefUpdatedBy))
      .limit(1);
    debriefUpdatedByName = author?.displayName ?? null;
  }

  // Venues already participating in this event
  const veRows = await db
    .select({
      ve: venueEvents,
      venue: venues,
      ourContact: staffMembers,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .leftJoin(staffMembers, eq(staffMembers.id, venueEvents.ourContactStaffId))
    .where(eq(venueEvents.eventId, id))
    .orderBy(asc(venueEvents.role), asc(venues.name));

  // Venues in the same city, not yet linked → addable
  const linkedVenueIds = veRows.map((r) => r.venue.id);

  // Bar contacts, synced from the city-page crawl tables: a venue accumulates
  // night-of contacts across crawls (one per venue_event), so collect every
  // named contact for the linked venues ordered most-recently-updated FIRST.
  // Display resolution per row: this crawl's own contact, then the venue's
  // most recent contact from any other crawl, then the venue master record.
  const contactRows =
    linkedVenueIds.length > 0
      ? await db
          .select({
            venueId: venueEvents.venueId,
            name: venueEvents.nightOfContactName,
            phone: venueEvents.nightOfContactPhoneE164,
          })
          .from(venueEvents)
          .where(
            and(
              inArray(venueEvents.venueId, linkedVenueIds),
              isNotNull(venueEvents.nightOfContactName),
            ),
          )
          .orderBy(desc(venueEvents.updatedAt))
      : [];
  const contactsByVenue = new Map<string, { name: string; phone: string | null }[]>();
  for (const c of contactRows) {
    const name = c.name?.trim();
    if (!name) continue;
    const list = contactsByVenue.get(c.venueId) ?? [];
    if (!list.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      list.push({ name, phone: c.phone });
    }
    contactsByVenue.set(c.venueId, list);
  }
  const addableQuery = db
    .select({
      id: venues.id,
      name: venues.name,
      doNotContact: venues.doNotContact,
    })
    .from(venues)
    .where(
      linkedVenueIds.length > 0
        ? // exclude already-linked AND archived
          // (notInArray requires non-empty array)
          eq(venues.cityId, eventRow.city.id)
        : eq(venues.cityId, eventRow.city.id),
    )
    .orderBy(asc(venues.name));
  const addableAll = await addableQuery;
  const addableVenues = addableAll.filter((v) => !linkedVenueIds.includes(v.id) && !v.doNotContact);

  const allStaff = await db
    .select({ id: staffMembers.id, displayName: staffMembers.displayName })
    .from(staffMembers)
    .where(eq(staffMembers.status, "active"))
    .orderBy(asc(staffMembers.displayName));

  // Cancelling a crawl is a lead+ override. Gate the UI with the same role
  // check the action enforces server-side so lower roles see a disabled
  // control with a hint instead of hitting a thrown error.
  const canArchive = (await getMinimumRoleOrNull("lead")) !== null;

  async function boundUpdate(prev: unknown, fd: FormData) {
    "use server";
    return updateEvent(id, prev, fd);
  }
  async function boundArchive(fd: FormData) {
    "use server";
    const reason = (fd.get("reason") as string | null) ?? "";
    await archiveEvent(id, reason);
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <header>
          <Link
            href={`/city-campaigns/${eventRow.cc.id}`}
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> {eventRow.city.name} · {eventRow.campaign.name}
          </Link>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight ">
            {eventRow.event.eventDate}
            {eventRow.event.slotNumber !== 1 && (
              <span className="ml-3 text-zinc-400">slot {eventRow.event.slotNumber}</span>
            )}
          </h1>
          <div className="mt-3 flex items-center gap-3">
            <Badge tone={statusTone(eventRow.event.status)}>{eventRow.event.status}</Badge>
            <span className="text-sm text-zinc-500">
              {veRows.length} / {eventRow.event.requiredVenueCountTotal} venues · need{" "}
              {eventRow.event.requiredWristbandCount} wristband ·{" "}
              {eventRow.event.requiredMiddleCount} middle · {eventRow.event.requiredFinalCount}{" "}
              final
            </span>
          </div>
        </header>

        {/* Print actions — open in new tab so the operator can keep editing here */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Print</span>
          <a
            href={`/events/${id}/poster`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-medium text-sm hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
          >
            🪧 Event poster
          </a>
          <a
            href={`/events/${id}/staff-sheet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-medium text-sm hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
          >
            📋 Staff sheet
          </a>
          <span className="ml-auto text-xs text-zinc-500">
            Posters show <strong>confirmed</strong> venues; staff sheets show all{" "}
            <strong>active</strong> (lead/interested/confirmed).
          </span>
        </div>

        <EventForm initial={eventRow.event} action={boundUpdate} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <EmergencyReplacementButton eventId={id} />
      </div>

      <VenueEventsSection
        eventId={id}
        venueEvents={veRows.map((r) => {
          const ownName = r.ve.nightOfContactName?.trim();
          const own = ownName ? { name: ownName, phone: r.ve.nightOfContactPhoneE164 } : null;
          const others = (contactsByVenue.get(r.venue.id) ?? []).filter(
            (c) => c.name.toLowerCase() !== own?.name.toLowerCase(),
          );
          const masterName = r.venue.contactName?.trim();
          const fallback =
            !own && others.length === 0 && masterName
              ? [{ name: masterName, phone: r.venue.phoneE164 }]
              : [];
          return {
            id: r.ve.id,
            venueId: r.venue.id,
            venueName: r.venue.name,
            role: r.ve.role,
            status: r.ve.status,
            slotStartTime: r.ve.slotStartTime,
            slotEndTime: r.ve.slotEndTime,
            ourContactName: r.ourContact?.displayName ?? null,
            confirmedAt: r.ve.confirmedAt,
            barContacts: [...(own ? [own] : []), ...others, ...fallback].slice(0, 3),
          };
        })}
        addableVenues={addableVenues.map((v) => ({ id: v.id, name: v.name }))}
        staff={allStaff}
        addAction={addVenueToEvent}
        updateAction={updateVenueEvent}
        removeAction={removeVenueFromEvent}
      />

      <DebriefNotes
        eventId={id}
        initialNotes={eventRow.event.debriefNotes}
        updatedAt={
          eventRow.event.debriefUpdatedAt ? eventRow.event.debriefUpdatedAt.toISOString() : null
        }
        updatedByName={debriefUpdatedByName}
      />

      <ArchiveWithReason
        action={boundArchive}
        title="Cancel this event"
        description="Marks status as cancelled. Venue links remain but no further outreach should fire for this event."
        triggerLabel="Cancel event"
        confirmLabel="Cancel event"
        reasonPlaceholder="Why is this crawl being cancelled?"
        canArchive={canArchive}
        disabledHint="Cancelling a crawl requires lead or admin role."
      />
    </div>
  );
}

function statusTone(s: string): "default" | "success" | "muted" | "warning" {
  if (s === "confirmed" || s === "completed") return "success";
  if (s === "cancelled") return "warning";
  return "default";
}

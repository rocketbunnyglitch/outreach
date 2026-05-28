import "server-only";

/**
 * City sheet data loader.
 *
 * Given a city_campaign id, returns the full operational picture:
 *   - city + campaign + assigned lead staffer
 *   - all crawls (events) grouped by day_part with crawl_number ordering
 *   - per-crawl slot composition: wristband, middle 1, middle 2, final
 *     (each populated from venue_events ordered by slot_position)
 *   - shared middle venue group(s) attached to events on the same day
 *   - venue details for autocomplete (capacity, email, address)
 *   - staff list for "Scheduled by" dropdown
 *
 * One join-heavy query per logical concern, paralleled with Promise.all.
 * Returns plain serializable shapes — no Drizzle row types leak through.
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  crawlHosts,
  externalHosts,
  internalHosts,
  middleVenueGroupMembers,
  middleVenueGroups,
  staffMembers,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Client-safe surface (types + SLOT_ROLE_ORDER) lives in ./city-sheet-shared
// so client components (CrawlSlotTable) can import them WITHOUT pulling this
// server-only module (db, schema) into the browser bundle.
// ---------------------------------------------------------------------------
export * from "./city-sheet-shared";
import { SLOT_ROLE_ORDER } from "./city-sheet-shared";
import type {
  CitySheetData,
  CrawlCard,
  CrawlHostRef,
  GroupMemberRow,
  SlotRole,
  SlotRow,
} from "./city-sheet-shared";

export async function loadCitySheet(cityCampaignId: string): Promise<CitySheetData | null> {
  const header = await db
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
    .where(eq(cityCampaigns.id, cityCampaignId))
    .limit(1)
    .then((r) => r[0]);

  if (!header) return null;

  // Events in this city_campaign, ordered for stable crawl display
  const eventRows = await db
    .select({
      id: events.id,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      routeLabel: events.routeLabel,
      eventDate: events.eventDate,
      ticketsSold: events.ticketSalesCount,
      middleVenueGroupId: events.middleVenueGroupId,
    })
    .from(events)
    .where(eq(events.cityCampaignId, cityCampaignId))
    .orderBy(asc(events.dayPart), asc(events.crawlNumber));

  const eventIds = eventRows.map((e) => e.id);

  // Crawl hosts (≤2 per event), joined to whichever roster they point
  // at so we have the display name. host_type discriminates.
  // Guarded: the internal_host_* columns ship in migration 0035, so if code is
  // deployed ahead of the migration this degrades to "no hosts" rather than
  // 500-ing the whole city sheet.
  type HostRow = {
    id: string;
    eventId: string;
    slot: number;
    hostType: "internal" | "external";
    internalHostId: string | null;
    externalHostId: string | null;
    internalName: string | null;
    externalName: string | null;
    internalHostName: string | null;
    internalHostHours: string | null;
    internalHostRateCents: number | null;
  };
  let hostRows: HostRow[] = [];
  if (eventIds.length > 0) {
    try {
      hostRows = await db
        .select({
          id: crawlHosts.id,
          eventId: crawlHosts.eventId,
          slot: crawlHosts.slot,
          hostType: crawlHosts.hostType,
          internalHostId: crawlHosts.internalHostId,
          externalHostId: crawlHosts.externalHostId,
          internalName: internalHosts.name,
          externalName: externalHosts.fullName,
          internalHostName: crawlHosts.internalHostName,
          internalHostHours: crawlHosts.internalHostHours,
          internalHostRateCents: crawlHosts.internalHostRateCents,
        })
        .from(crawlHosts)
        .leftJoin(internalHosts, eq(internalHosts.id, crawlHosts.internalHostId))
        .leftJoin(externalHosts, eq(externalHosts.id, crawlHosts.externalHostId))
        .where(inArray(crawlHosts.eventId, eventIds))
        .orderBy(asc(crawlHosts.slot));
    } catch (err) {
      console.error("[city-sheet] crawl hosts query failed (run migration 0035?)", err);
      hostRows = [];
    }
  }

  const hostsByEvent = new Map<string, CrawlHostRef[]>();
  for (const h of hostRows) {
    const isInternal = h.hostType === "internal";
    const externalPending = !isInternal && !h.externalHostId;
    const arr = hostsByEvent.get(h.eventId) ?? [];
    const name = isInternal
      ? (h.internalName ?? h.internalHostName ?? "(internal host)")
      : (h.externalName ?? (externalPending ? "Unassigned" : "(removed host)"));
    arr.push({
      id: h.id,
      hostId: (isInternal ? h.internalHostId : h.externalHostId) ?? "",
      name,
      type: h.hostType as "internal" | "external",
      slot: h.slot,
      internalHostName: h.internalHostName,
      internalHostHours: h.internalHostHours,
      internalHostRateCents: h.internalHostRateCents,
      externalPending,
    });
    hostsByEvent.set(h.eventId, arr);
  }

  // venue_events filled per event
  const veRows =
    eventIds.length > 0
      ? await db
          .select({
            id: venueEvents.id,
            eventId: venueEvents.eventId,
            role: venueEvents.role,
            slotPosition: venueEvents.slotPosition,
            status: venueEvents.status,
            agreedHoursText: venueEvents.agreedHoursText,
            drinkSpecials: venueEvents.drinkSpecials,
            nightOfContactName: venueEvents.nightOfContactName,
            ourContactStaffId: venueEvents.ourContactStaffId,
            venueId: venues.id,
            venueName: venues.name,
            venueEmail: venues.email,
            venuePhone: venues.phoneE164,
            venueCapacity: venues.capacity,
            staffName: staffMembers.displayName,
          })
          .from(venueEvents)
          .innerJoin(venues, eq(venues.id, venueEvents.venueId))
          .leftJoin(staffMembers, eq(staffMembers.id, venueEvents.ourContactStaffId))
          .where(inArray(venueEvents.eventId, eventIds))
          .orderBy(asc(venueEvents.role), asc(venueEvents.slotPosition))
      : [];

  // Wristband shipping rollup per crawl. The wristband-role venue_event
  // is the entry venue; its wristbands row (if any) carries the shipping
  // status. We map event_id -> {venueEventId, status, shippedAt,
  // deliveredAt} and derive a coarse ship state for the status dot.
  const wbRows =
    eventIds.length > 0
      ? await db
          .select({
            eventId: venueEvents.eventId,
            venueEventId: venueEvents.id,
            wbStatus: wristbands.status,
            shippedAt: wristbands.shippedAt,
            deliveredAt: wristbands.deliveredAt,
          })
          .from(venueEvents)
          .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
          .where(and(inArray(venueEvents.eventId, eventIds), eq(venueEvents.role, "wristband")))
      : [];

  // event_id -> { ship state, wristband venue_event id }. If multiple
  // wristband-role venue_events somehow exist for one event, the most
  // "advanced" ship state wins (received > shipped > not_shipped).
  const shipRank = { none: 0, not_shipped: 1, shipped: 2, received: 3 } as const;
  type ShipState = keyof typeof shipRank;
  const wbByEvent = new Map<string, { ship: ShipState; venueEventId: string | null }>();
  for (const w of wbRows) {
    let ship: ShipState;
    if (w.deliveredAt || w.wbStatus === "delivered") {
      ship = "received";
    } else if (w.shippedAt || w.wbStatus === "shipped") {
      ship = "shipped";
    } else if (w.wbStatus == null) {
      // venue_event exists but no wristbands row yet → still "to ship".
      ship = "not_shipped";
    } else {
      ship = "not_shipped";
    }
    const prev = wbByEvent.get(w.eventId);
    if (!prev || shipRank[ship] > shipRank[prev.ship]) {
      wbByEvent.set(w.eventId, { ship, venueEventId: w.venueEventId });
    }
  }

  // Middle venue groups (for label display)
  const groupIds = Array.from(
    new Set(eventRows.map((e) => e.middleVenueGroupId).filter((v): v is string => !!v)),
  );
  const groupRows =
    groupIds.length > 0
      ? await db
          .select({ id: middleVenueGroups.id, name: middleVenueGroups.name })
          .from(middleVenueGroups)
          .where(inArray(middleVenueGroups.id, groupIds))
      : [];
  const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));

  // Group members for shared-middle display
  const memberRows =
    groupIds.length > 0
      ? await db
          .select({
            memberId: middleVenueGroupMembers.id,
            groupId: middleVenueGroupMembers.middleVenueGroupId,
            venueId: venues.id,
            venueName: venues.name,
            venueEmail: venues.email,
            venueCapacity: venues.capacity,
            status: middleVenueGroupMembers.status,
            agreedHoursText: middleVenueGroupMembers.agreedHoursText,
            drinkSpecials: middleVenueGroupMembers.drinkSpecials,
          })
          .from(middleVenueGroupMembers)
          .innerJoin(venues, eq(venues.id, middleVenueGroupMembers.venueId))
          .where(inArray(middleVenueGroupMembers.middleVenueGroupId, groupIds))
          .orderBy(asc(venues.name))
      : [];
  const membersByGroup = new Map<string, GroupMemberRow[]>();
  for (const m of memberRows) {
    const list = membersByGroup.get(m.groupId) ?? [];
    list.push({
      memberId: m.memberId,
      venueId: m.venueId,
      venueName: m.venueName,
      venueEmail: m.venueEmail,
      venueCapacity: m.venueCapacity,
      status: m.status,
      agreedHoursText: m.agreedHoursText,
      drinkSpecials: m.drinkSpecials,
    });
    membersByGroup.set(m.groupId, list);
  }

  // "Shared with" map: for each group, the other event ids that use it
  const eventIdsByGroup = new Map<string, string[]>();
  for (const ev of eventRows) {
    if (!ev.middleVenueGroupId) continue;
    const list = eventIdsByGroup.get(ev.middleVenueGroupId) ?? [];
    list.push(ev.id);
    eventIdsByGroup.set(ev.middleVenueGroupId, list);
  }

  // Staff for dropdowns
  const staff = await db
    .select({ id: staffMembers.id, displayName: staffMembers.displayName })
    .from(staffMembers)
    .where(eq(staffMembers.status, "active"))
    .orderBy(asc(staffMembers.displayName));

  // Compose crawls with default 4 slots (wristband, middle 1, middle 2, final)
  // plus any extra middles or alt_finals already filled. When a middle group
  // is attached, the Middle 1/Middle 2 default slots are replaced with the
  // group's members rendered as a read-only section.
  const crawls: CrawlCard[] = eventRows.map((ev) => {
    const ves = veRows.filter((v) => v.eventId === ev.id);
    const hasGroup = !!ev.middleVenueGroupId;

    // Required default slots — middles ONLY when no shared group is set
    const defaultSlots: Array<{ role: SlotRole; slotPosition: number }> = hasGroup
      ? [
          { role: "wristband", slotPosition: 1 },
          { role: "final", slotPosition: 1 },
        ]
      : [
          { role: "wristband", slotPosition: 1 },
          { role: "middle", slotPosition: 1 },
          { role: "middle", slotPosition: 2 },
          { role: "final", slotPosition: 1 },
        ];

    // Pull in extras: any ve with role+position not in defaultSlots, and
    // also skip ANY middle venue_events when a shared group is in use
    // (the group is authoritative for middles in that case)
    const extras = ves.filter((v) => {
      if (hasGroup && v.role === "middle") return false;
      return !defaultSlots.some(
        (d) => d.role === v.role && d.slotPosition === (v.slotPosition ?? 1),
      );
    });

    // Stable order: the crawl runs wristband → middles → final →
    // alt_finals. Sort ALL slots (defaults + extras) by this canonical
    // role order, then slot_position. Previously extras were sorted by
    // role.localeCompare and appended AFTER the defaults, which dropped
    // a Middle 3 below the Final + Alt Final (operator session-12 bug:
    // "adding a middle slot puts it after final, it should be between
    // the middles").
    const orderedDefaults: SlotRow[] = defaultSlots.map((d) => {
      const filled = ves.find((v) => v.role === d.role && (v.slotPosition ?? 1) === d.slotPosition);
      return slotRowFrom(filled, d.role, d.slotPosition);
    });
    const orderedExtras: SlotRow[] = extras.map((v) =>
      slotRowFrom(v, v.role as SlotRole, v.slotPosition ?? 1),
    );
    const slots: SlotRow[] = [...orderedDefaults, ...orderedExtras].sort(
      (a, b) =>
        SLOT_ROLE_ORDER[a.role] - SLOT_ROLE_ORDER[b.role] || a.slotPosition - b.slotPosition,
    );

    // Sharing — list other events using the same group, with display labels
    const sharedWith: Array<{ eventId: string; label: string }> = hasGroup
      ? (eventIdsByGroup.get(ev.middleVenueGroupId as string) ?? [])
          .filter((otherId) => otherId !== ev.id)
          .map((otherId) => {
            const other = eventRows.find((e) => e.id === otherId);
            return {
              eventId: otherId,
              label: other
                ? `${capitalize(String(other.dayPart ?? ""))} crawl ${other.crawlNumber ?? "?"}`
                : "another crawl",
            };
          })
      : [];

    return {
      eventId: ev.id,
      dayPart:
        (ev.dayPart as "thursday_night" | "friday_night" | "saturday_night") ?? "saturday_night",
      crawlNumber: ev.crawlNumber ?? 1,
      routeLabel: ev.routeLabel ?? null,
      eventDate: String(ev.eventDate ?? ""),
      ticketsSold: ev.ticketsSold ?? 0,
      wristbandShip: wbByEvent.get(ev.id)?.ship ?? "none",
      wristbandVenueEventId: wbByEvent.get(ev.id)?.venueEventId ?? null,
      hosts: hostsByEvent.get(ev.id) ?? [],
      middleVenueGroupId: ev.middleVenueGroupId,
      middleVenueGroupName: ev.middleVenueGroupId
        ? (groupNameById.get(ev.middleVenueGroupId) ?? null)
        : null,
      middleGroupSharedWith: sharedWith,
      middleGroupMembers: ev.middleVenueGroupId
        ? (membersByGroup.get(ev.middleVenueGroupId) ?? [])
        : [],
      slots,
    };
  });

  return {
    cityCampaignId: header.cc.id,
    cityId: header.city.id,
    cityName: header.city.name,
    cityRegion: header.city.region,
    cityTimezone: header.city.timezone,
    campaignId: header.campaign.id,
    campaignName: header.campaign.name,
    priority: header.cc.priority ?? 5,
    status: (header.cc.status as CitySheetData["status"]) ?? "planning",
    leadStaffId: header.cc.leadStaffId,
    leadStaffName: header.leadStaff?.displayName ?? null,
    dashboardNote: header.cc.dashboardNote,
    crawls,
    staff,
  };
}

type VenueEventRow = {
  id: string;
  eventId: string;
  role: string;
  slotPosition: number | null;
  status: string;
  agreedHoursText: string | null;
  drinkSpecials: string | null;
  nightOfContactName: string | null;
  ourContactStaffId: string | null;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  venuePhone: string | null;
  venueCapacity: number | null;
  staffName: string | null;
};

function slotRowFrom(ve: VenueEventRow | undefined, role: SlotRole, position: number): SlotRow {
  if (!ve) {
    return {
      venueEventId: null,
      role,
      slotPosition: position,
      status: null,
      venueId: null,
      venueName: null,
      venueEmail: null,
      venuePhone: null,
      venueCapacity: null,
      agreedHoursText: null,
      drinkSpecials: null,
      nightOfContactName: null,
      scheduledByStaffId: null,
      scheduledByStaffName: null,
    };
  }
  return {
    venueEventId: ve.id,
    role,
    slotPosition: position,
    status: ve.status,
    venueId: ve.venueId,
    venueName: ve.venueName,
    venueEmail: ve.venueEmail,
    venuePhone: ve.venuePhone,
    venueCapacity: ve.venueCapacity,
    agreedHoursText: ve.agreedHoursText,
    drinkSpecials: ve.drinkSpecials,
    nightOfContactName: ve.nightOfContactName,
    scheduledByStaffId: ve.ourContactStaffId,
    scheduledByStaffName: ve.staffName,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

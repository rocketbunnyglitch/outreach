/**
 * Flat merge-context builder (merge-field fix).
 *
 * The seeded Halloween templates use ~44 FLAT snake_case merge fields
 * ({{venue_name}}, {{city}}, {{turnout_quote_current}}, {{slot_summary}}, ...).
 * This is the single server-side source of truth that maps each one to the
 * operator's REAL data tables (venues, cities, events, venue_events,
 * external_hosts, wristbands, campaign_connected_accounts, the turnout helper).
 *
 * Used by BOTH the /templates preview and the live composer, so a fix here
 * fixes both. Every known field is always present in the returned record (empty
 * string when not derivable for this context) so emails never show a broken
 * `[??field??]` marker; only a genuinely unknown field name renders the marker.
 *
 * Field -> source mapping is documented in the memory note
 * reference_template_merge_fields and confirmed with the operator.
 */

import "server-only";
import {
  events,
  campaignConnectedAccounts,
  campaigns,
  cities,
  cityCampaigns,
  emailTemplates,
  externalHosts,
  outreachBrands,
  staffMembers,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  type DayPart,
  STANDARD_SLOT_TIME,
  type VenueRole,
  crawlsCountLabel,
  dayPartLabel,
  eventDayName,
  formatEventDate,
  guestCount,
  openSlotsLabel,
  payRateLabel,
  roleLabel,
  shortDateLabel,
} from "./template-merge-format";
import {
  type Priority,
  type SlotContext,
  type SlotType,
  initialPitchNumber,
  salesUpdateQuote,
} from "./turnout-quote";

export interface MergeContextInput {
  /** Venue recipient (cold/confirm templates). */
  venueId?: string | null;
  /** Template's campaign -- scopes cities/crawls + the company_name fallback. */
  campaignId?: string | null;
  /** Explicit city-campaign (preview city pick); else derived from the venue. */
  cityCampaignId?: string | null;
  /** Specific crawl for date/night/slot context; else the city's primary crawl. */
  eventId?: string | null;
  /** Sender (your_name, operator_cell). */
  staffId?: string | null;
  /** Sending connected email -> its per-campaign brand for company_name. */
  sendingAccountId?: string | null;
  /** External host recipient (H0a/H0b host briefs). */
  hostExternalId?: string | null;
}

/** Every flat field the engine knows about. All default to "" so a field that
 *  is simply empty for this context never renders as [??field??]. */
export const MERGE_FIELD_KEYS = [
  "venue_name",
  "city",
  "your_name",
  "contact_first_name",
  "company_name",
  "venue_manager_name",
  "venue_manager_phone",
  "operator_cell",
  "event_date",
  "event_day_name",
  "night",
  "guest_count",
  "turnout_quote_current",
  "slot_summary",
  "slot_list",
  "slot_list_2",
  "slot_shorthand",
  "open_slots",
  "thu_crawls",
  "fri_crawls",
  "sat_crawls",
  "thu_open_slots",
  "fri_open_slots",
  "sat_open_slots",
  "full_lineup_with_times_and_addresses",
  "wristband_note",
  "wristband_window",
  "wristband_venue_name",
  "wristband_venue_address",
  "wristband_shipping_status",
  "wristband_shipping_note",
  "wristband_attachments_note",
  "host_name",
  "host_manager_name",
  "host_manager_phone",
  "host_arrival_time",
  "shift_start_time",
  "shift_end_time",
  "pay_rate",
  "payment_method",
  "cancellation_reason_phrase",
  "host_info_note",
] as const;

export type MergeFields = Record<(typeof MERGE_FIELD_KEYS)[number], string>;

function emptyFields(): MergeFields {
  const out = {} as MergeFields;
  for (const k of MERGE_FIELD_KEYS) out[k] = "";
  return out;
}

const NIGHT_DAYPARTS: DayPart[] = ["thursday_night", "friday_night", "saturday_night"];

/** Map a venue role + crawl format to the turnout helper's slot inputs. */
function slotInputs(
  role: VenueRole | null,
  crawlFormat: "standard" | "day_party",
): { slotType: SlotType; slotContext: SlotContext } {
  const slotType: SlotType =
    role === "wristband"
      ? "wristband"
      : role === "final" || role === "alt_final"
        ? "final"
        : "middle";
  if (crawlFormat === "day_party") return { slotType, slotContext: "afternoon" };
  const slotContext: SlotContext =
    slotType === "wristband" ? "pickup_window" : slotType === "final" ? "night" : "slot";
  return { slotType, slotContext };
}

interface EventRow {
  id: string;
  eventDate: string;
  dayPart: DayPart | null;
  crawlFormat: "standard" | "day_party";
  ticketSalesCount: number;
  requiredWristbandCount: number;
  requiredMiddleCount: number;
  requiredFinalCount: number;
}

interface VeRow {
  eventId: string;
  venueId: string;
  role: VenueRole;
  status: string;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

/** Required roles for an event as a flat list (wristband x1, middle x2, final x1). */
function requiredRoles(e: EventRow): VenueRole[] {
  const out: VenueRole[] = [];
  for (let i = 0; i < e.requiredWristbandCount; i++) out.push("wristband");
  for (let i = 0; i < e.requiredMiddleCount; i++) out.push("middle");
  if (e.crawlFormat !== "day_party")
    for (let i = 0; i < e.requiredFinalCount; i++) out.push("final");
  return out;
}

/** Open (unfilled) roles for an event: a role is filled when a venue_event for
 *  it is status='confirmed'. Any other status (or no row) leaves it open. */
function openRolesForEvent(e: EventRow, ves: VeRow[]): VenueRole[] {
  const confirmedByRole = new Map<VenueRole, number>();
  for (const v of ves) {
    if (v.eventId !== e.id) continue;
    if (v.status !== "confirmed") continue;
    const key: VenueRole = v.role === "alt_final" ? "final" : v.role;
    confirmedByRole.set(key, (confirmedByRole.get(key) ?? 0) + 1);
  }
  const open: VenueRole[] = [];
  for (const role of requiredRoles(e)) {
    const remaining = confirmedByRole.get(role) ?? 0;
    if (remaining > 0) confirmedByRole.set(role, remaining - 1);
    else open.push(role);
  }
  return open;
}

function slotTimeFor(role: VenueRole, ve: VeRow | null): string {
  if (ve?.slotStartTime && ve.slotEndTime) {
    return `${fmtTime(ve.slotStartTime)} to ${fmtTime(ve.slotEndTime)}`;
  }
  const key = role === "alt_final" ? "final" : role;
  return STANDARD_SLOT_TIME[key];
}

/** "19:30:00" -> "7:30 PM". Leaves already-friendly strings alone. */
function fmtTime(t: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/** Prefer the Saturday-night crawl as a city's representative event. */
function pickPrimaryEvent(rows: EventRow[]): EventRow | null {
  return (
    rows.find((r) => r.dayPart === "saturday_night") ??
    rows.slice().sort((a, b) => a.eventDate.localeCompare(b.eventDate))[0] ??
    null
  );
}

/**
 * Build the flat merge field map for a render context. Resilient: any missing
 * piece leaves its fields blank rather than throwing, so a partial context
 * (e.g. a cold lead with no booking) still renders the identity fields.
 */
export async function buildFlatMergeContext(input: MergeContextInput): Promise<MergeFields> {
  const fields = emptyFields();

  // --- Sender (your_name, operator_cell) ---
  if (input.staffId) {
    const [s] = await db
      .select({ displayName: staffMembers.displayName, phone: staffMembers.phoneE164 })
      .from(staffMembers)
      .where(eq(staffMembers.id, input.staffId))
      .limit(1);
    if (s) {
      fields.your_name = s.displayName ?? "";
      fields.operator_cell = s.phone ?? "";
    }
  }

  // --- Venue + city ---
  let venueCityId: string | null = null;
  if (input.venueId) {
    const [v] = await db
      .select({
        name: venues.name,
        address: venues.address,
        phone: venues.phoneE164,
        contactName: venues.contactName,
        cityId: venues.cityId,
        cityName: cities.name,
      })
      .from(venues)
      .leftJoin(cities, eq(cities.id, venues.cityId))
      .where(eq(venues.id, input.venueId))
      .limit(1);
    if (v) {
      fields.venue_name = v.name ?? "";
      fields.city = v.cityName ?? "";
      fields.venue_manager_name = v.contactName ?? "";
      fields.venue_manager_phone = v.phone ?? "";
      fields.contact_first_name = (v.contactName ?? "").trim().split(/\s+/)[0] ?? "";
      venueCityId = v.cityId ?? null;
    }
  }

  // --- City-campaign resolution (city pick, or derive from venue's city) ---
  let cityCampaignId = input.cityCampaignId ?? null;
  let cityPriority = 5;
  if (!cityCampaignId && input.campaignId && venueCityId) {
    const [cc] = await db
      .select({ id: cityCampaigns.id, priority: cityCampaigns.priority })
      .from(cityCampaigns)
      .where(
        and(eq(cityCampaigns.campaignId, input.campaignId), eq(cityCampaigns.cityId, venueCityId)),
      )
      .limit(1);
    if (cc) {
      cityCampaignId = cc.id;
      cityPriority = cc.priority;
    }
  } else if (cityCampaignId) {
    const [cc] = await db
      .select({ priority: cityCampaigns.priority, cityName: cities.name })
      .from(cityCampaigns)
      .leftJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(eq(cityCampaigns.id, cityCampaignId))
      .limit(1);
    if (cc) {
      cityPriority = cc.priority;
      if (!fields.city) fields.city = cc.cityName ?? "";
    }
  }
  const priority = Math.min(6, Math.max(1, cityPriority)) as Priority;

  // --- company_name: sending email's per-campaign brand, else campaign brand ---
  await resolveCompanyName(fields, input);

  // --- Crawls + slots (need a city-campaign) ---
  let cityEvents: EventRow[] = [];
  let cityVes: VeRow[] = [];
  if (cityCampaignId) {
    cityEvents = (await db
      .select({
        id: events.id,
        eventDate: events.eventDate,
        dayPart: events.dayPart,
        crawlFormat: events.crawlFormat,
        ticketSalesCount: events.ticketSalesCount,
        requiredWristbandCount: events.requiredWristbandCount,
        requiredMiddleCount: events.requiredMiddleCount,
        requiredFinalCount: events.requiredFinalCount,
      })
      .from(events)
      .where(and(eq(events.cityCampaignId, cityCampaignId), isNull(events.archivedAt)))
      .orderBy(asc(events.eventDate))) as EventRow[];

    if (cityEvents.length > 0) {
      cityVes = (await db
        .select({
          eventId: venueEvents.eventId,
          venueId: venueEvents.venueId,
          role: venueEvents.role,
          status: venueEvents.status,
          slotStartTime: venueEvents.slotStartTime,
          slotEndTime: venueEvents.slotEndTime,
        })
        .from(venueEvents)
        .where(
          inArray(
            venueEvents.eventId,
            cityEvents.map((e) => e.id),
          ),
        )) as VeRow[];
    }
  }

  // Per-night crawl counts + open slots.
  const eventsByDayPart = (dp: DayPart) => cityEvents.filter((e) => e.dayPart === dp);
  const openRolesForNight = (dp: DayPart): VenueRole[] => {
    const roles: VenueRole[] = [];
    for (const e of eventsByDayPart(dp)) roles.push(...openRolesForEvent(e, cityVes));
    return roles;
  };
  fields.thu_crawls = crawlsCountLabel(eventsByDayPart("thursday_night").length);
  fields.fri_crawls = crawlsCountLabel(eventsByDayPart("friday_night").length);
  fields.sat_crawls = crawlsCountLabel(eventsByDayPart("saturday_night").length);
  fields.thu_open_slots = openSlotsLabel(openRolesForNight("thursday_night"));
  fields.fri_open_slots = openSlotsLabel(openRolesForNight("friday_night"));
  fields.sat_open_slots = openSlotsLabel(openRolesForNight("saturday_night"));

  // T8 slot menu: night lines + the Saturday-day crawl on its own line.
  const nightLines: string[] = [];
  for (const dp of NIGHT_DAYPARTS) {
    for (const e of eventsByDayPart(dp)) {
      const open = openRolesForEvent(e, cityVes);
      if (open.length === 0) continue;
      nightLines.push(`${shortDateLabel(e.eventDate)}: ${openSlotsLabel(open)}`);
    }
  }
  fields.slot_list = nightLines.join("\n");
  const dayCrawl = eventsByDayPart("saturday_day")[0];
  if (dayCrawl) {
    const open = openRolesForEvent(dayCrawl, cityVes);
    if (open.length > 0) {
      fields.slot_list_2 = `${shortDateLabel(dayCrawl.eventDate)} (day party): ${openSlotsLabel(open)}`;
    }
  }
  fields.slot_shorthand = "a Halloween slot";

  // --- The venue's own booking (slot_summary, night, guest_count, turnout) ---
  const myVe = input.venueId ? (cityVes.find((v) => v.venueId === input.venueId) ?? null) : null;
  const myEvent =
    (input.eventId ? cityEvents.find((e) => e.id === input.eventId) : null) ??
    (myVe ? cityEvents.find((e) => e.id === myVe.eventId) : null) ??
    pickPrimaryEvent(cityEvents);

  if (myEvent) {
    fields.event_date = formatEventDate(myEvent.eventDate);
    fields.event_day_name = eventDayName(myEvent.eventDate);
    fields.night = shortDateLabel(myEvent.eventDate);
    fields.open_slots = openSlotsLabel(openRolesForEvent(myEvent, cityVes));

    const { slotType, slotContext } = slotInputs(myVe?.role ?? null, myEvent.crawlFormat);
    fields.guest_count = guestCount(initialPitchNumber(priority, slotType));
    const sales = salesUpdateQuote({
      ticketsSold: myEvent.ticketSalesCount,
      slotType,
      slotContext,
    });
    fields.turnout_quote_current = `Right now we're expecting ${sales.phrase}.${
      sales.honestSlowFlag ? " Sales are a bit slow so far, but we'll keep you posted." : ""
    }`;

    if (myVe) {
      const time = slotTimeFor(myVe.role, myVe);
      const part = myEvent.dayPart ? `${dayPartLabel(myEvent.dayPart)} ` : "";
      fields.slot_summary = `${roleLabel(myVe.role)} venue for the ${part}crawl on ${shortDateLabel(
        myEvent.eventDate,
      )} (${time})`;
    }
  }

  // --- Wristband family ---
  await fillWristbandFields(fields, input, myEvent, myVe, cityVes);

  // --- Host briefs (external host recipient) ---
  if (input.hostExternalId) {
    const [h] = await db
      .select({
        fullName: externalHosts.fullName,
        managerName: externalHosts.hostManagerName,
        managerPhone: externalHosts.hostManagerPhone,
        arrival: externalHosts.hostArrivalTime,
        shiftStart: externalHosts.shiftStartTime,
        shiftEnd: externalHosts.shiftEndTime,
        payRateCents: externalHosts.payRateCents,
        currency: externalHosts.currency,
        method: externalHosts.paymentMethod,
      })
      .from(externalHosts)
      .where(eq(externalHosts.id, input.hostExternalId))
      .limit(1);
    if (h) {
      fields.host_name = h.fullName ?? "";
      fields.host_manager_name = h.managerName ?? "";
      fields.host_manager_phone = h.managerPhone ?? "";
      fields.host_arrival_time = h.arrival ?? "";
      fields.shift_start_time = h.shiftStart ?? "";
      fields.shift_end_time = h.shiftEnd ?? "";
      fields.pay_rate = payRateLabel(h.payRateCents ?? 0, h.currency ?? "");
      fields.payment_method = h.method ?? "";
    }
  }

  // --- Full lineup (confirmed venues for the host's/venue's event) ---
  if (myEvent) {
    fields.full_lineup_with_times_and_addresses = await buildLineup(myEvent, cityVes);
  }

  // cancellation_reason_phrase + host_info_note are operator/engine-supplied
  // at send time; left blank here so they never show a broken marker.

  return fields;
}

/**
 * Resolve the sending email's per-campaign brand ({{company_name}}) and alias
 * persona ({{your_name}}). The sending email's assignment (campaign_connected_
 * accounts) wins; company_name falls back to the campaign's brand and your_name
 * falls back to the sending user's display name (already set from staff).
 */
async function resolveCompanyName(fields: MergeFields, input: MergeContextInput): Promise<void> {
  if (input.sendingAccountId && input.campaignId) {
    const [row] = await db
      .select({
        brand: outreachBrands.displayName,
        aliasName: campaignConnectedAccounts.aliasName,
      })
      .from(campaignConnectedAccounts)
      .leftJoin(outreachBrands, eq(outreachBrands.id, campaignConnectedAccounts.outreachBrandId))
      .where(
        and(
          eq(campaignConnectedAccounts.campaignId, input.campaignId),
          eq(campaignConnectedAccounts.connectedAccountId, input.sendingAccountId),
        ),
      )
      .limit(1);
    // The alias persona overrides the sender's real name in {{your_name}}.
    if (row?.aliasName) fields.your_name = row.aliasName;
    if (row?.brand) {
      fields.company_name = row.brand;
      return;
    }
  }
  if (input.campaignId) {
    const [row] = await db
      .select({ brand: outreachBrands.displayName })
      .from(campaigns)
      .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
      .where(eq(campaigns.id, input.campaignId))
      .limit(1);
    if (row?.brand) fields.company_name = row.brand;
  }
}

/** Wristband fields: the crawl's wristband venue + this venue's shipping + the
 *  T7A/T7B insert block, plus the conditional T9 lines for wristband venues. */
async function fillWristbandFields(
  fields: MergeFields,
  input: MergeContextInput,
  myEvent: EventRow | null,
  myVe: VeRow | null,
  cityVes: VeRow[],
): Promise<void> {
  fields.wristband_window = STANDARD_SLOT_TIME.wristband;

  // The wristband (check-in) venue for the relevant crawl.
  if (myEvent) {
    const wbVe = cityVes.find((v) => v.eventId === myEvent.id && v.role === "wristband");
    if (wbVe) {
      const [v] = await db
        .select({ name: venues.name, address: venues.address })
        .from(venues)
        .where(eq(venues.id, wbVe.venueId))
        .limit(1);
      if (v) {
        fields.wristband_venue_name = v.name ?? "";
        fields.wristband_venue_address = v.address ?? "";
      }
      if (wbVe.slotStartTime && wbVe.slotEndTime) {
        fields.wristband_window = `${fmtTime(wbVe.slotStartTime)} to ${fmtTime(wbVe.slotEndTime)}`;
      }
    }
  }

  const isWristbandVenue = myVe?.role === "wristband";

  // Shipping status for this venue's wristband package.
  if (isWristbandVenue && myVe) {
    const [w] = await db
      .select({
        status: wristbands.status,
        carrier: wristbands.carrier,
        tracking: wristbands.trackingNumber,
      })
      .from(wristbands)
      .where(eq(wristbands.venueEventId, await venueEventIdFor(myVe, myEvent)))
      .limit(1);
    if (w) {
      const carrier = w.carrier ? ` via ${w.carrier}` : "";
      const tracking = w.tracking ? ` (tracking ${w.tracking})` : "";
      fields.wristband_shipping_status = `${w.status}${carrier}${tracking}`;
    } else {
      fields.wristband_shipping_status = "preparing to ship";
    }
  }

  // The {{wristband_note}} insert block: T7A (host available) is the standard
  // offer; only shown when a wristband slot is in play (role wristband, or a
  // cold pitch where the wristband slot is still open).
  const showWristbandNote =
    isWristbandVenue || (!myVe && (input.campaignId != null || input.cityCampaignId != null));
  if (showWristbandNote && input.campaignId) {
    const block = await loadInsertBlock(input.campaignId, "T7A");
    if (block) fields.wristband_note = block;
  }

  // Conditional T9 lines, only for the wristband venue.
  if (isWristbandVenue) {
    fields.wristband_shipping_note =
      "\n4. A shipping address, contact name, and phone so we can send your wristband package.";
    fields.wristband_attachments_note =
      "- Wristband image (so your team knows what they're handing out)";
  }
}

/** Resolve the venue_event id for a VeRow (the row only carries event+venue). */
async function venueEventIdFor(myVe: VeRow, myEvent: EventRow | null): Promise<string> {
  const [row] = await db
    .select({ id: venueEvents.id })
    .from(venueEvents)
    .where(
      and(
        eq(venueEvents.venueId, myVe.venueId),
        eq(venueEvents.eventId, myEvent?.id ?? myVe.eventId),
      ),
    )
    .limit(1);
  return row?.id ?? "00000000-0000-0000-0000-000000000000";
}

/** Body text of a campaign insert-block template (T7A / T7B). */
async function loadInsertBlock(campaignId: string, code: string): Promise<string | null> {
  const [row] = await db
    .select({ body: emailTemplates.bodyTemplateText })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.campaignId, campaignId),
        eq(emailTemplates.templateCode, code),
        isNull(emailTemplates.archivedAt),
      ),
    )
    .limit(1);
  return row?.body ?? null;
}

/** Confirmed venues for an event, ordered wristband -> participating -> final,
 *  each "Role: Venue, address (time)". For H0b's {{full_lineup...}}. */
async function buildLineup(myEvent: EventRow, cityVes: VeRow[]): Promise<string> {
  const confirmed = cityVes.filter((v) => v.eventId === myEvent.id && v.status === "confirmed");
  if (confirmed.length === 0) return "";
  const order: Record<VenueRole, number> = { wristband: 0, middle: 1, final: 2, alt_final: 3 };
  confirmed.sort((a, b) => order[a.role] - order[b.role]);
  const venueIds = confirmed.map((v) => v.venueId);
  const rows = await db
    .select({ id: venues.id, name: venues.name, address: venues.address })
    .from(venues)
    .where(inArray(venues.id, venueIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return confirmed
    .map((v) => {
      const venue = byId.get(v.venueId);
      const time = slotTimeFor(v.role, v);
      const addr = venue?.address ? `, ${venue.address}` : "";
      return `${roleLabel(v.role)}: ${venue?.name ?? "TBD"}${addr} (${time})`;
    })
    .join("\n");
}

/** Convenience: every template row's render is fed this map merged with any
 *  caller overrides (e.g. an engine-supplied cancellation_reason_phrase). */
export function mergeOverrides(base: MergeFields, overrides: Partial<MergeFields>): MergeFields {
  return { ...base, ...overrides };
}

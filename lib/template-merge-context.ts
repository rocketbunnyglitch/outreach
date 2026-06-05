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
  emailMessages,
  emailTemplates,
  emailThreads,
  externalHosts,
  outreachBrands,
  staffMembers,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  type DayPart,
  STANDARD_SLOT_TIME,
  type VenueRole,
  crawlsCountLabel,
  dayPartLabel,
  detailedSlotLine,
  eventDayName,
  formatEventDate,
  guestCount,
  joinAnd,
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
  /** Reply context: when set, contact_first_name is taken from the name of the
   *  person who last replied on this thread, not the venue's stored contact. */
  threadId?: string | null;
}

/** Every flat field the engine knows about. All default to "" so a field that
 *  is simply empty for this context never renders as [??field??]. */
export const MERGE_FIELD_KEYS = [
  "venue_name",
  "city",
  "your_name",
  "contact_first_name",
  "company_name",
  "campaign_name",
  "venue_manager_name",
  "venue_manager_phone",
  "operator_cell",
  "event_date",
  "event_day_name",
  "night",
  "guest_count",
  "turnout_quote_current",
  "slot_summary",
  "venue_nights_summary",
  "slot_list",
  "slot_list_2",
  "slot_list_detailed",
  "slot_shorthand",
  "confirmed_venues",
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
  "wristband_ask_line",
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
  status: string;
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
  temporarilyDisabled: boolean;
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
 *  it is status='confirmed' AND not temporarily disabled. Any other status, a
 *  temporarily-disabled venue (pulled mid-crawl), or no row leaves it open. */
function openRolesForEvent(e: EventRow, ves: VeRow[]): VenueRole[] {
  const confirmedByRole = new Map<VenueRole, number>();
  for (const v of ves) {
    if (v.eventId !== e.id) continue;
    if (v.status !== "confirmed" || v.temporarilyDisabled) continue;
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

  // --- Reply context: address the person who actually replied ---
  // The venue's stored contact is often stale or generic (or just the first
  // person we ever found). Once a venue has written back, the human who replied
  // is the right one to greet, so override contact_first_name with the latest
  // INBOUND sender's name -- from the specific thread when given, else the
  // venue's most recent inbound across all its threads. Cold venues (no inbound
  // yet) keep the stored-contact fallback above.
  if (input.threadId || input.venueId) {
    const [m] = input.threadId
      ? await db
          .select({ fromName: emailMessages.fromName })
          .from(emailMessages)
          .where(
            and(eq(emailMessages.threadId, input.threadId), eq(emailMessages.direction, "inbound")),
          )
          .orderBy(desc(emailMessages.receivedAt), desc(emailMessages.sentAt))
          .limit(1)
      : await db
          .select({ fromName: emailMessages.fromName })
          .from(emailMessages)
          .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
          .where(
            and(
              eq(emailThreads.venueId, input.venueId as string),
              eq(emailMessages.direction, "inbound"),
            ),
          )
          .orderBy(desc(emailMessages.receivedAt), desc(emailMessages.sentAt))
          .limit(1);
    const replier = m?.fromName?.trim();
    if (replier) {
      fields.venue_manager_name = replier;
      fields.contact_first_name = replier.split(/\s+/)[0] ?? "";
    }
  }

  // --- Multi-night summary (Phase 3.3) ---
  // Every confirmed crawl this venue is on for the campaign, e.g. "Thursday Oct
  // 29 as wristband + Friday Oct 30 as middle". Lets bundled lifecycle / host
  // emails name all nights instead of just the one that triggered the render.
  if (input.venueId && input.campaignId) {
    const nights = await db
      .select({ eventDate: events.eventDate, role: venueEvents.role })
      .from(venueEvents)
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .where(
        and(
          eq(venueEvents.venueId, input.venueId),
          eq(cityCampaigns.campaignId, input.campaignId),
          eq(venueEvents.status, "confirmed"),
        ),
      )
      .orderBy(asc(events.eventDate));
    if (nights.length > 0) {
      fields.venue_nights_summary = nights
        .map((n) => {
          const label = new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            weekday: "long",
            month: "short",
            day: "numeric",
          }).format(new Date(`${n.eventDate}T00:00:00Z`));
          return `${label} as ${n.role === "alt_final" ? "final" : n.role}`;
        })
        .join(" + ");
      // Only wristband venues get asked for a shipping address (T9-near). Blank
      // for everyone else so the line simply doesn't appear.
      if (nights.some((n) => n.role === "wristband")) {
        fields.wristband_ask_line = "- A shipping address so we can send your wristband package.";
      }
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
        status: events.status,
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

    // Drop crawls that are already over so we never pitch a slot on a date that
    // has passed (or a crawl marked completed/cancelled). Date-only compare in
    // UTC -- the column is a DATE and the VPS clock is UTC; a same-day crawl
    // stays listed until the following day. Go-forward: as Oct dates pass they
    // fall off the open-slot lists automatically.
    const todayUtc = new Date().toISOString().slice(0, 10);
    cityEvents = cityEvents.filter(
      (e) => e.eventDate >= todayUtc && e.status !== "completed" && e.status !== "cancelled",
    );

    if (cityEvents.length > 0) {
      cityVes = (await db
        .select({
          eventId: venueEvents.eventId,
          venueId: venueEvents.venueId,
          role: venueEvents.role,
          status: venueEvents.status,
          temporarilyDisabled: venueEvents.temporarilyDisabled,
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

  // Open roles in canonical order, deduped (a city runs MULTIPLE crawls per
  // night; if a role is open in any crawl that night we list it once).
  const orderOpen = (open: VenueRole[]): VenueRole[] =>
    (["wristband", "middle", "final"] as VenueRole[]).filter((r) => open.includes(r));

  // Slot lists are grouped by DATE, not per crawl. A city with 3 Friday crawls
  // must not print "Friday" three times -- we aggregate the open roles across
  // every crawl that night into one line/block per date. T8 slot menu
  // ({{slot_list}}) is the terse one-line-per-night version; the day party is
  // its own line.
  const nightLines: string[] = [];
  for (const dp of NIGHT_DAYPARTS) {
    const first = eventsByDayPart(dp)[0];
    if (!first) continue;
    const open = orderOpen(openRolesForNight(dp));
    if (open.length === 0) continue;
    nightLines.push(`${shortDateLabel(first.eventDate)}: ${openSlotsLabel(open)}`);
  }
  fields.slot_list = nightLines.join("\n");
  const dayFirst = eventsByDayPart("saturday_day")[0];
  const dayOpen = orderOpen(openRolesForNight("saturday_day"));
  if (dayFirst && dayOpen.length > 0) {
    fields.slot_list_2 = `${shortDateLabel(dayFirst.eventDate)} (day party): ${openSlotsLabel(dayOpen)}`;
  }

  // Rich open-slot list -- {{slot_list_detailed}}. Nights that share the SAME
  // set of open roles collapse into ONE block (dates listed together, slot
  // times written once) instead of repeating an identical list for every date.
  // A real person writes "Thu, Fri & Sat -- every slot open:" once; spelling
  // out four identical days reads like a robot. Reads the crawl tables; drops
  // filled slots + completed crawls; empty when nothing is open.
  const nightGroups = new Map<string, { dates: string[]; roles: VenueRole[] }>();
  for (const dp of NIGHT_DAYPARTS) {
    const first = eventsByDayPart(dp)[0];
    if (!first) continue;
    const open = orderOpen(openRolesForNight(dp));
    if (open.length === 0) continue;
    const sig = open.join("|");
    const existing = nightGroups.get(sig);
    if (existing) existing.dates.push(shortDateLabel(first.eventDate));
    else nightGroups.set(sig, { dates: [shortDateLabel(first.eventDate)], roles: open });
  }
  const detailedBlocks: string[] = [];
  for (const { dates, roles } of nightGroups.values()) {
    const everyOpen = roles.length === 3;
    // Multi-date groups note WHY they're grouped (so the reader knows the same
    // slots apply to all those dates); single dates just lead with the date.
    const qualifier = everyOpen
      ? " (every slot open)"
      : dates.length > 1
        ? ` (${openSlotsLabel(roles)} open)`
        : "";
    const lines = roles.map((r) => `- ${detailedSlotLine(r, false)}`);
    detailedBlocks.push(`${joinAnd(dates)}${qualifier}:\n${lines.join("\n")}`);
  }
  if (dayFirst && dayOpen.length > 0) {
    const lines = dayOpen.map((r) => `- ${detailedSlotLine(r, true)}`);
    detailedBlocks.push(
      `${shortDateLabel(dayFirst.eventDate)} day party (afternoon):\n${lines.join("\n")}`,
    );
  }

  // Social proof -- venues already confirmed on OTHER slots in this city, as a
  // separate paragraph after the open slots (operator: must read as distinct
  // from what's open, not confuse it). Empty until venues start confirming;
  // self-populates as the crawl fills. Excludes the recipient venue itself.
  const confirmedIds = Array.from(
    new Set(
      cityVes
        .filter((v) => v.status === "confirmed" && v.venueId && v.venueId !== input.venueId)
        .map((v) => v.venueId),
    ),
  );
  if (confirmedIds.length > 0) {
    const confirmedRows = await db
      .select({ name: venues.name })
      .from(venues)
      .where(inArray(venues.id, confirmedIds));
    // Dedupe by name (case-insensitive): the venue DB has duplicate rows for
    // the same bar, and one venue confirmed on several slots must read once.
    // Otherwise the social-proof line repeats the same name redundantly.
    const seenNames = new Set<string>();
    const names: string[] = [];
    for (const r of confirmedRows) {
      const n = (r.name ?? "").trim();
      if (!n) continue;
      const key = n.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      names.push(n);
    }
    if (names.length > 0) {
      const MAX_NAMED = 6;
      const shown = names.slice(0, MAX_NAMED);
      const extra = names.length - shown.length;
      const list = extra > 0 ? `${shown.join(", ")}, and ${extra} more` : joinAnd(shown);
      const cityPhrase = fields.city ? ` for our ${fields.city} crawls` : "";
      fields.confirmed_venues = `A few spots are already locked in: ${list} have confirmed${cityPhrase}.`;
    }
  }

  // The detailed list a template renders ({{slot_list_detailed}}) carries the
  // social-proof paragraph appended after the open slots, separated by a blank
  // line so it never blends into the open-slot block.
  fields.slot_list_detailed = [detailedBlocks.join("\n\n"), fields.confirmed_venues]
    .filter((s) => s.length > 0)
    .join("\n\n");

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
/**
 * The Google account's display name for an inbox, read from the From header of
 * its most recent outbound message (email_messages.from_name). Gmail stamps the
 * account's real name there, so this gives the sender name with no extra OAuth
 * scope. Null when the inbox hasn't sent anything yet.
 */
async function latestSenderName(connectedAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ fromName: emailMessages.fromName })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.staffOutreachEmailId, connectedAccountId),
        eq(emailMessages.direction, "outbound"),
      ),
    )
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);
  const name = row?.fromName?.trim();
  return name && name.length > 0 ? name : null;
}

async function resolveCompanyName(fields: MergeFields, input: MergeContextInput): Promise<void> {
  // {{campaign_name}} -- the public campaign label (e.g. "Halloween
  // International 2026"). Resolved whenever a campaign id is present,
  // independent of the company/alias paths below (which can early-return).
  if (input.campaignId) {
    const [c] = await db
      .select({ name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .limit(1);
    if (c?.name) fields.campaign_name = c.name;
  }
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
    // {{your_name}} resolution, most-specific first:
    //   1. explicit alias persona (set on /campaign-info), else
    //   2. the inbox's own Google account name (from its sent mail), else
    //   3. the operator's profile name (already set from staff, above).
    // (2) means a shared "Dan" inbox reads as Dan even when Bryle is sending.
    if (row?.aliasName) {
      fields.your_name = row.aliasName;
    } else {
      const googleName = await latestSenderName(input.sendingAccountId);
      if (googleName) fields.your_name = googleName;
    }
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

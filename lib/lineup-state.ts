/**
 * Engine lineup-state read helper (Spec phase 5.7).
 *
 * Single server-side source of truth for the PUBLIC-SAFE confirmed lineup of a
 * crawl, consumed by external systems (the Smart Map, and -- once re-pointed --
 * the Eventbrite venue-block push). It returns ONLY confirmed venue facts:
 *
 *   - event date, city, day part
 *   - the CrawlBrand's public branding (name, colors, logo, tagline, footer)
 *   - per-venue: name, address, role, slot start/end, lat/lng
 *
 * CLAUDE.md section 8 rule #6 is the hard line here: this surface must NEVER
 * expose internal notes, do-not-contact reasons/flags, financial data, contact
 * info, or outreach history. The SELECTs below are deliberately narrow -- they
 * pull only the columns that are safe to publish. Do not widen them.
 *
 * CLAUDE.md section 7 multi-brand discipline: a lineup is scoped to ONE campaign
 * (hence one CrawlBrand). We expose the CrawlBrand's public branding fields and
 * NEVER any OutreachBrand identity or any cross-brand history.
 *
 * Confirmed-lineup definition (mirrors lib/template-merge-context.ts buildLineup):
 *   venue_events WHERE status = 'confirmed' AND NOT temporarily_disabled,
 *   ordered wristband(0) -> middle(1) -> final(2) -> alt_final(3).
 *
 * ---------------------------------------------------------------------------
 * 5.9 (Eventbrite push re-point) and 5.10 (Smart Map re-point Sheets -> engine)
 * ---------------------------------------------------------------------------
 * Both of these external systems used to read the lineup from a Google Sheet /
 * web form. The engine is now the source of truth. The integration contract is:
 *
 *   READ path  : external systems pull the lineup from the public JSON API
 *                (app/api/engine/lineup/route.ts + /[eventId]/route.ts), which
 *                is a thin HTTP wrapper over getCampaignLineup / getEventLineup
 *                in this file. Auth is a static engine API key (see the route).
 *
 *   PUSH path  : whenever a lineup changes, engine code calls
 *                recordLineupChange() in lib/lineup-events.ts. Consumers poll
 *                getRecentLineupChanges() (or, once durable pub/sub lands, a
 *                webhook) and re-pull the affected event's lineup.
 *
 * 5.9 Eventbrite re-point -- TODO (external wiring, not built here):
 *   - The Eventbrite sync worker should build its VENUES_BLOCK from
 *     getEventLineup(eventId).venues instead of the legacy Sheets row.
 *   - It must keep writing ONLY between the existing
 *     <!-- VENUES_BLOCK_START --> / <!-- VENUES_BLOCK_END --> markers
 *     (CLAUDE.md section 8 rule #4 -- never clobber marketing copy).
 *   - Trigger it from a recordLineupChange consumer so a slot change pushes
 *     to Eventbrite without waiting for the 15-min poll.
 *
 * 5.10 Smart Map re-point -- TODO (external wiring, not built here):
 *   - Point the Smart Map's data fetch at GET /api/engine/lineup?campaign=<slug>
 *     (lat/lng + role + slot times are all present for map pins).
 *   - Drop the Sheets/web-form reader once the map renders from this API.
 *   - For near-live updates, have the map poll getRecentLineupChanges via the
 *     events endpoint (TODO: expose a /api/engine/lineup/changes route when 5.8
 *     gets a durable store).
 */

import "server-only";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  crawlBrands,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

/** Canonical confirmed-lineup ordering. wristband first, alt_final last. */
const ROLE_ORDER: Record<LineupRole, number> = {
  wristband: 0,
  middle: 1,
  final: 2,
  alt_final: 3,
};

export type LineupRole = "wristband" | "middle" | "final" | "alt_final";

/** Public-safe CrawlBrand branding. NO OutreachBrand fields, NO tokens. */
export interface PublicCrawlBrand {
  slug: string;
  name: string;
  public_domain: string | null;
  logo_url: string | null;
  primary_color_hex: string | null;
  accent_color_hex: string | null;
  tagline: string | null;
  public_footer_text: string | null;
}

/** One confirmed venue on a crawl. Public-safe facts only. */
export interface PublicLineupVenue {
  name: string;
  address: string | null;
  role: LineupRole;
  slot_position: number | null;
  slot_start: string | null;
  slot_end: string | null;
  lat: number | null;
  lng: number | null;
}

/** A single crawl night's confirmed lineup. */
export interface EventLineup {
  event_id: string;
  event_date: string;
  day_part: string | null;
  city: string;
  city_timezone: string;
  campaign_slug: string;
  crawl_brand: PublicCrawlBrand;
  venues: PublicLineupVenue[];
}

export interface GetCampaignLineupOpts {
  /** Campaign slug (preferred external handle). One of slug/campaignId required. */
  campaignSlug?: string;
  /** Campaign id (uuid). One of slug/campaignId required. */
  campaignId?: string;
  /** Optional: restrict to a single city's crawls within the campaign. */
  cityId?: string;
}

/**
 * Map the raw venue_events role enum (which includes alt_final) onto the
 * public LineupRole. They are identical strings; this narrows the type.
 */
function asLineupRole(role: string): LineupRole {
  return role as LineupRole;
}

/**
 * All confirmed crawl lineups for a campaign (optionally one city), each as an
 * EventLineup DTO. Confirmed = venue_events.status='confirmed' AND NOT
 * temporarily_disabled. Past/archived/cancelled crawls are still returned (the
 * map may show a full season); callers can filter by date if they only want
 * upcoming. Empty array when the campaign is unknown or has no confirmed venues.
 */
export async function getCampaignLineup(opts: GetCampaignLineupOpts): Promise<EventLineup[]> {
  if (!opts.campaignSlug && !opts.campaignId) {
    throw new Error("getCampaignLineup requires campaignSlug or campaignId");
  }

  // Resolve campaign + its CrawlBrand public branding in one go. Scoped to a
  // single campaign => single CrawlBrand (CLAUDE.md section 7).
  const [campaign] = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      brandSlug: crawlBrands.slug,
      brandName: crawlBrands.displayName,
      brandDomain: crawlBrands.publicDomain,
      brandLogo: crawlBrands.logoUrl,
      brandPrimary: crawlBrands.primaryColorHex,
      brandAccent: crawlBrands.accentColorHex,
      brandTagline: crawlBrands.tagline,
      brandFooter: crawlBrands.publicFooterText,
    })
    .from(campaigns)
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(
      and(
        opts.campaignId
          ? eq(campaigns.id, opts.campaignId)
          : eq(campaigns.slug, opts.campaignSlug as string),
        isNull(campaigns.archivedAt),
      ),
    )
    .limit(1);

  if (!campaign) return [];

  const crawlBrand: PublicCrawlBrand = {
    slug: campaign.brandSlug,
    name: campaign.brandName,
    public_domain: campaign.brandDomain ?? null,
    logo_url: campaign.brandLogo ?? null,
    primary_color_hex: campaign.brandPrimary ?? null,
    accent_color_hex: campaign.brandAccent ?? null,
    tagline: campaign.brandTagline ?? null,
    public_footer_text: campaign.brandFooter ?? null,
  };

  // All events for the campaign (optionally one city), with city + day part.
  const eventRows = await db
    .select({
      eventId: events.id,
      eventDate: events.eventDate,
      dayPart: events.dayPart,
      cityName: cities.name,
      cityId: cities.id,
      cityTimezone: cities.timezone,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        eq(cityCampaigns.campaignId, campaign.id),
        isNull(events.archivedAt),
        opts.cityId ? eq(cities.id, opts.cityId) : undefined,
      ),
    )
    .orderBy(asc(events.eventDate));

  if (eventRows.length === 0) return [];

  const eventIds = eventRows.map((e) => e.eventId);
  const venuesByEvent = await loadConfirmedVenues(eventIds);

  return eventRows.map((e) => ({
    event_id: e.eventId,
    event_date: e.eventDate,
    day_part: e.dayPart ?? null,
    city: e.cityName,
    city_timezone: e.cityTimezone,
    campaign_slug: campaign.slug,
    crawl_brand: crawlBrand,
    venues: venuesByEvent.get(e.eventId) ?? [],
  }));
}

/**
 * The confirmed lineup for ONE crawl night. Null when the event is unknown or
 * archived. CrawlBrand branding is resolved via the event's campaign so the
 * single-event DTO matches the campaign-list DTO shape exactly.
 */
export async function getEventLineup(eventId: string): Promise<EventLineup | null> {
  const [row] = await db
    .select({
      eventId: events.id,
      eventDate: events.eventDate,
      dayPart: events.dayPart,
      cityName: cities.name,
      cityTimezone: cities.timezone,
      campaignSlug: campaigns.slug,
      brandSlug: crawlBrands.slug,
      brandName: crawlBrands.displayName,
      brandDomain: crawlBrands.publicDomain,
      brandLogo: crawlBrands.logoUrl,
      brandPrimary: crawlBrands.primaryColorHex,
      brandAccent: crawlBrands.accentColorHex,
      brandTagline: crawlBrands.tagline,
      brandFooter: crawlBrands.publicFooterText,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(crawlBrands, eq(crawlBrands.id, campaigns.crawlBrandId))
    .where(and(eq(events.id, eventId), isNull(events.archivedAt)))
    .limit(1);

  if (!row) return null;

  const venuesByEvent = await loadConfirmedVenues([row.eventId]);

  return {
    event_id: row.eventId,
    event_date: row.eventDate,
    day_part: row.dayPart ?? null,
    city: row.cityName,
    city_timezone: row.cityTimezone,
    campaign_slug: row.campaignSlug,
    crawl_brand: {
      slug: row.brandSlug,
      name: row.brandName,
      public_domain: row.brandDomain ?? null,
      logo_url: row.brandLogo ?? null,
      primary_color_hex: row.brandPrimary ?? null,
      accent_color_hex: row.brandAccent ?? null,
      tagline: row.brandTagline ?? null,
      public_footer_text: row.brandFooter ?? null,
    },
    venues: venuesByEvent.get(row.eventId) ?? [],
  };
}

/**
 * Confirmed, publish-safe venues for a set of events, grouped by event id and
 * ordered wristband -> middle -> final -> alt_final, then by slot position.
 *
 * Only the public-safe venue columns are selected (name, address, location).
 * internal_notes, do_not_contact*, email, phone, contact_name and every other
 * sensitive column are intentionally NOT selected (CLAUDE.md section 8 rule #6).
 */
async function loadConfirmedVenues(eventIds: string[]): Promise<Map<string, PublicLineupVenue[]>> {
  const byEvent = new Map<string, PublicLineupVenue[]>();
  if (eventIds.length === 0) return byEvent;

  const rows = await db
    .select({
      eventId: venueEvents.eventId,
      role: venueEvents.role,
      slotPosition: venueEvents.slotPosition,
      slotStart: venueEvents.slotStartTime,
      slotEnd: venueEvents.slotEndTime,
      venueName: venues.name,
      venueAddress: venues.address,
      venueLocation: venues.location,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(
      and(
        inArray(venueEvents.eventId, eventIds),
        eq(venueEvents.status, "confirmed"),
        eq(venueEvents.temporarilyDisabled, false),
        isNull(venues.archivedAt),
      ),
    );

  for (const r of rows) {
    const list = byEvent.get(r.eventId) ?? [];
    list.push({
      name: r.venueName,
      address: r.venueAddress ?? null,
      role: asLineupRole(r.role),
      slot_position: r.slotPosition ?? null,
      slot_start: r.slotStart ?? null,
      slot_end: r.slotEnd ?? null,
      lat: r.venueLocation?.lat ?? null,
      lng: r.venueLocation?.lng ?? null,
    });
    byEvent.set(r.eventId, list);
  }

  for (const [, list] of byEvent) {
    list.sort((a, b) => {
      const ro = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (ro !== 0) return ro;
      return (a.slot_position ?? 0) - (b.slot_position ?? 0);
    });
  }

  return byEvent;
}

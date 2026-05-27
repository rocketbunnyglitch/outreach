"use server";

/**
 * AI-powered venue suggestions for a city campaign with open slots.
 *
 * Workflow:
 *   1. Load the city geocode + region + already-confirmed venues + the
 *      set of venues already in this city (so we can dedupe candidates)
 *   2. Call Places API for nearby bars/clubs/restaurants in a 2.5km
 *      radius around the city centroid
 *   3. Filter out anything already in our venues table for this city
 *      (no point suggesting venues the team already knows about)
 *   4. Ask Claude to rank the remaining candidates by crawl-fit with
 *      per-venue reasoning
 *   5. Return the top N to the UI
 *
 * The UI lets the operator add a candidate to cold outreach with one
 * click — that's the addSuggestedVenueToColdOutreach action below.
 */

import { coldOutreachEntries, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { captureException, logger } from "@/lib/logger";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const suggestSchema = z.object({
  cityCampaignId: uuid,
  slotKind: z.enum(["wristband", "middle", "final", "any"]).default("any"),
});

export interface VenueSuggestion {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  /** Sentence or two from Claude on why this fits the crawl. */
  reasoning: string;
  /** Claude's confidence — used to lightly visualize fit in the UI. */
  fitScore: number;
}

interface SuggestResponseOk {
  suggestions: VenueSuggestion[];
  /** Why we returned no results, if relevant — UI can render a hint. */
  noticeKey?: "ai_not_configured" | "places_not_configured" | "no_candidates_after_dedupe";
  city: { name: string; region: string | null };
}

interface SuggestResponseSkip {
  notConfigured: true;
  reason: "ai" | "places";
}

export async function suggestVenuesForCampaign(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<SuggestResponseOk | SuggestResponseSkip>> {
  await requireStaff();
  const parsed = suggestSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
    slotKind: formData.get("slotKind") ?? "any",
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid suggestion payload." };
  }

  const { isGoogleMapsConfigured, searchNearbyPlaces } = await import("@/lib/google-places");
  const { isAiConfigured, rankVenueCandidates } = await import("@/lib/ai");

  if (!isGoogleMapsConfigured()) {
    return { ok: true, data: { notConfigured: true, reason: "places" } };
  }

  // ---------------------------------------------------------------
  // 1. Load city context + already-confirmed venues
  // ---------------------------------------------------------------
  const ctxRows = await db.execute<{
    city_name: string;
    city_region: string | null;
    city_lat: number | null;
    city_lng: number | null;
  }>(sql`
    SELECT
      c.name AS city_name,
      c.region AS city_region,
      ST_Y(c.location::geometry)::float AS city_lat,
      ST_X(c.location::geometry)::float AS city_lng
    FROM city_campaigns cc
    JOIN cities c ON c.id = cc.city_id
    WHERE cc.id = ${parsed.data.cityCampaignId}
    LIMIT 1
  `);

  type CtxRow = {
    city_name: string;
    city_region: string | null;
    city_lat: number | null;
    city_lng: number | null;
  };
  const ctx: CtxRow | undefined = Array.isArray(ctxRows)
    ? (ctxRows as unknown as CtxRow[])[0]
    : ((ctxRows as unknown as { rows: CtxRow[] }).rows ?? [])[0];

  if (!ctx) return { ok: false, error: "City campaign not found." };
  if (ctx.city_lat == null || ctx.city_lng == null) {
    return { ok: false, error: "City has no geocode yet — set the city centroid first." };
  }

  // Confirmed venues for context (what's already in the crawl)
  const confirmedRows = await db.execute<{
    name: string;
    capacity: number | null;
    slot_kind: string | null;
  }>(sql`
    SELECT v.name, v.capacity, ve.role::text AS slot_kind
    FROM venue_events ve
    JOIN events e ON e.id = ve.event_id
    JOIN venues v ON v.id = ve.venue_id
    WHERE e.city_campaign_id = ${parsed.data.cityCampaignId}
      AND ve.status = 'confirmed'
    ORDER BY ve.role NULLS LAST, v.name
  `);
  type ConfirmedRow = { name: string; capacity: number | null; slot_kind: string | null };
  const confirmed: ConfirmedRow[] = Array.isArray(confirmedRows)
    ? (confirmedRows as unknown as ConfirmedRow[])
    : ((confirmedRows as unknown as { rows: ConfirmedRow[] }).rows ?? []);

  // ---------------------------------------------------------------
  // 2. Places API call
  // ---------------------------------------------------------------
  const result = await searchNearbyPlaces({
    lat: ctx.city_lat,
    lng: ctx.city_lng,
    radiusMeters: 2500,
    includedTypes: ["bar", "night_club", "restaurant"],
    maxResults: 20,
  });

  // ---------------------------------------------------------------
  // 3. Dedupe — drop venues already in our table for this city
  // ---------------------------------------------------------------
  const existingPlaceIds = new Set<string>();
  if (result.places.length > 0) {
    const placeIds = result.places.map((p) => p.googlePlaceId);
    const dupes = await db.execute<{ google_place_id: string }>(sql`
      SELECT google_place_id
      FROM venues
      WHERE google_place_id IN ${placeIds}
        AND city_id = (SELECT city_id FROM city_campaigns WHERE id = ${parsed.data.cityCampaignId})
    `);
    type DupeRow = { google_place_id: string };
    const list: DupeRow[] = Array.isArray(dupes)
      ? (dupes as unknown as DupeRow[])
      : ((dupes as unknown as { rows: DupeRow[] }).rows ?? []);
    for (const row of list) existingPlaceIds.add(row.google_place_id);
  }

  const candidates = result.places.filter((p) => !existingPlaceIds.has(p.googlePlaceId));

  if (candidates.length === 0) {
    return {
      ok: true,
      data: {
        suggestions: [],
        noticeKey: "no_candidates_after_dedupe",
        city: { name: ctx.city_name, region: ctx.city_region },
      },
    };
  }

  // ---------------------------------------------------------------
  // 4. Claude ranking (or rating fallback when not configured)
  // ---------------------------------------------------------------
  const ranked = await rankVenueCandidates({
    city: { name: ctx.city_name, region: ctx.city_region },
    confirmed: confirmed.map((c) => ({
      name: c.name,
      slotKind: c.slot_kind,
      capacity: c.capacity,
    })),
    candidates,
    slotKind: parsed.data.slotKind === "any" ? null : parsed.data.slotKind,
  });

  // Join the Claude ranking back to the Places payload
  const placeByPid = new Map(candidates.map((p) => [p.googlePlaceId, p]));
  const suggestions: VenueSuggestion[] = ranked
    .slice(0, 8)
    .map((r) => {
      const place = placeByPid.get(r.googlePlaceId);
      if (!place) return null;
      return {
        googlePlaceId: place.googlePlaceId,
        name: place.name,
        formattedAddress: place.formattedAddress,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        types: place.types,
        reasoning: r.reasoning,
        fitScore: r.fitScore,
      };
    })
    .filter((s): s is VenueSuggestion => s !== null);

  logger.info(
    {
      cityCampaignId: parsed.data.cityCampaignId,
      total_candidates: candidates.length,
      returned: suggestions.length,
      ai_used: isAiConfigured(),
    },
    "venue suggestions ready",
  );

  return {
    ok: true,
    data: {
      suggestions,
      noticeKey: isAiConfigured() ? undefined : "ai_not_configured",
      city: { name: ctx.city_name, region: ctx.city_region },
    },
  };
}

// =========================================================================
// Add a suggestion to cold outreach (one-click action)
// =========================================================================

const addSchema = z.object({
  cityCampaignId: uuid,
  googlePlaceId: z.string().min(5),
  // Cached snapshot of the Places result so we don't need to re-query
  venueName: z.string().min(1).max(200),
  formattedAddress: z.string().max(500).nullable(),
  phoneE164: z.string().max(50).nullable(),
  websiteUri: z.string().max(2048).nullable(),
});

export async function addSuggestedVenueToColdOutreach(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ entryId: string }>> {
  const { staff } = await requireStaff();
  const parsed = addSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
    googlePlaceId: formData.get("googlePlaceId"),
    venueName: formData.get("venueName"),
    formattedAddress: formData.get("formattedAddress") || null,
    phoneE164: formData.get("phoneE164") || null,
    websiteUri: formData.get("websiteUri") || null,
  });
  if (!parsed.success) return { ok: false, error: "Invalid add payload." };

  try {
    return await withAuditContext(staff.id, async (tx) => {
      // City for the venue insert (FK target)
      const cityRows = await tx.execute<{ city_id: string }>(sql`
        SELECT city_id FROM city_campaigns WHERE id = ${parsed.data.cityCampaignId} LIMIT 1
      `);
      type CityRow = { city_id: string };
      const cityList: CityRow[] = Array.isArray(cityRows)
        ? (cityRows as unknown as CityRow[])
        : ((cityRows as unknown as { rows: CityRow[] }).rows ?? []);
      const cityId = cityList[0]?.city_id;
      if (!cityId) return { ok: false, error: "City campaign not found." };

      // Find existing venue by google_place_id, else create one
      const existing = await tx
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.googlePlaceId, parsed.data.googlePlaceId))
        .limit(1);

      let venueId: string;
      if (existing[0]) {
        venueId = existing[0].id;
      } else {
        const inserted = await tx
          .insert(venues)
          .values({
            cityId,
            name: parsed.data.venueName,
            address: parsed.data.formattedAddress,
            phoneE164: parsed.data.phoneE164,
            websiteUrl: parsed.data.websiteUri,
            googlePlaceId: parsed.data.googlePlaceId,
          })
          .returning({ id: venues.id });
        const created = inserted[0];
        if (!created) return { ok: false, error: "Couldn't create venue record." };
        venueId = created.id;
      }

      // Insert cold outreach entry, or return existing if already present
      const inserted = await tx
        .insert(coldOutreachEntries)
        .values({
          cityCampaignId: parsed.data.cityCampaignId,
          venueId,
          status: "not_contacted",
        })
        .onConflictDoNothing({
          target: [coldOutreachEntries.cityCampaignId, coldOutreachEntries.venueId],
        })
        .returning({ id: coldOutreachEntries.id });

      let entryId = inserted[0]?.id;
      if (!entryId) {
        // Conflict — look up the existing entry
        const reused = await tx
          .select({ id: coldOutreachEntries.id })
          .from(coldOutreachEntries)
          .where(
            and(
              eq(coldOutreachEntries.cityCampaignId, parsed.data.cityCampaignId),
              eq(coldOutreachEntries.venueId, venueId),
            ),
          )
          .limit(1);
        entryId = reused[0]?.id;
      }
      if (!entryId) return { ok: false, error: "Failed to add to cold outreach." };

      return { ok: true, data: { entryId } };
    });
  } catch (err) {
    await captureException(err, {
      tag: "add_suggested_venue",
      cityCampaignId: parsed.data.cityCampaignId,
      googlePlaceId: parsed.data.googlePlaceId,
    });
    return { ok: false, error: "Couldn't add this venue. See logs." };
  }
}

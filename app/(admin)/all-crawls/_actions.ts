"use server";

/**
 * All-crawls actions: link/unlink Eventbrite events, pull sales,
 * push venue routes to the EB description.
 *
 * Every action is gated on the EVENTBRITE_PRIVATE_TOKEN env var via
 * isEventbriteConfigured(). Without it, returns a graceful "not
 * configured" result so the UI can surface the right state without
 * leaking errors.
 *
 * Smart check on link: when the operator enters an EB event ID, we
 * fetch the event from the API and compare its venue city against the
 * crawl's city. A mismatch returns a confirmation-required result so
 * the operator can confirm or correct before we save the linkage.
 */

import { events, cities, cityCampaigns, venueEvents, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { publishRealtime } from "@/lib/realtime-publish";
import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const linkSchema = z.object({
  eventId: uuid,
  eventbriteEventId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, "EB IDs are numeric")
    .nullable(),
  /** Operator opts past the city mismatch warning. */
  force: z.coerce.boolean().default(false),
  campaignId: uuid.optional(),
});

/**
 * Link or unlink an Eventbrite event ID on a crawl.
 *
 * Outcomes:
 *   • { ok: true, data: { linked: true, ... } }
 *     Saved the EB ID + URL on the event.
 *
 *   • { ok: true, data: { needsConfirm: true, mismatch: {...} } }
 *     EB event's city doesn't match the crawl's city. UI surfaces a
 *     "Are you sure?" prompt with both city names so operator can
 *     confirm intentionally or correct the EB ID.
 *
 *   • { ok: true, data: { notConfigured: true } }
 *     EVENTBRITE_PRIVATE_TOKEN missing. UI guides operator to set it.
 *
 *   • { ok: false, error }
 *     Invalid EB ID format, EB API failed, or save failed.
 */
export async function linkEventbriteEvent(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<
    | { linked: true; eventName: string | null; eventUrl: string | null }
    | { needsConfirm: true; mismatch: { eventCity: string; crawlCity: string }; ebName: string }
    | { unlinked: true }
    | { notConfigured: true }
  >
> {
  const { staff } = await requireStaff();
  const parsed = linkSchema.safeParse({
    eventId: formData.get("eventId"),
    eventbriteEventId:
      formData.get("eventbriteEventId") && String(formData.get("eventbriteEventId")).trim()
        ? formData.get("eventbriteEventId")
        : null,
    force: formData.get("force") ?? false,
    campaignId: formData.get("campaignId") ?? undefined,
  });
  if (!parsed.success) {
    const msg =
      parsed.error.issues[0]?.message ??
      "Eventbrite event IDs are 6–20 digits — copy from the EB event URL.";
    return { ok: false, error: msg };
  }

  // Unlink path — just clear the columns, no API call needed
  if (parsed.data.eventbriteEventId == null) {
    try {
      await withAuditContext(staff.id, async (tx) => {
        await tx
          .update(events)
          .set({
            eventbriteEventId: null,
            eventbriteUrl: null,
            updatedBy: staff.id,
          })
          .where(eq(events.id, parsed.data.eventId));
      });
      if (parsed.data.campaignId) revalidatePath("/all-crawls");
      return { ok: true, data: { unlinked: true } };
    } catch (err) {
      logger.error({ err }, "unlink EB failed");
      return { ok: false, error: "Couldn't unlink Eventbrite event." };
    }
  }

  // Link path — fetch EB, compare city, save
  const { isEventbriteConfigured, fetchEventbriteEvent } = await import("@/lib/eventbrite");
  if (!isEventbriteConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  const ebEvent = await fetchEventbriteEvent(parsed.data.eventbriteEventId);
  if (!ebEvent) {
    return {
      ok: false,
      error: "Couldn't load that Eventbrite event. Check the ID is correct + the token has access.",
    };
  }

  // Resolve crawl's city for the smart check
  const crawlRow = await db.execute<{ city_name: string }>(sql`
    SELECT c.name AS city_name
    FROM events e
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    JOIN cities c ON c.id = cc.city_id
    WHERE e.id = ${parsed.data.eventId}
    LIMIT 1
  `);
  const crawlRows: Array<{ city_name: string }> = Array.isArray(crawlRow)
    ? (crawlRow as unknown as Array<{ city_name: string }>)
    : ((crawlRow as unknown as { rows: Array<{ city_name: string }> }).rows ?? []);
  const crawlCity = crawlRows[0]?.city_name ?? "";

  // Smart check: compare cities case-insensitively. Allow operator to
  // override via force=true (e.g. multi-city event names).
  if (!parsed.data.force && ebEvent.cityName && crawlCity) {
    const ebCity = ebEvent.cityName.trim().toLowerCase();
    const ourCity = crawlCity.trim().toLowerCase();
    if (ebCity !== ourCity && !ebCity.includes(ourCity) && !ourCity.includes(ebCity)) {
      return {
        ok: true,
        data: {
          needsConfirm: true,
          mismatch: { eventCity: ebEvent.cityName, crawlCity },
          ebName: ebEvent.name,
        },
      };
    }
  }

  // Save linkage + URL
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(events)
        .set({
          eventbriteEventId: parsed.data.eventbriteEventId,
          eventbriteUrl: ebEvent.url,
          updatedBy: staff.id,
        })
        .where(eq(events.id, parsed.data.eventId));
    });
    if (parsed.data.campaignId) revalidatePath("/all-crawls");
    return {
      ok: true,
      data: { linked: true, eventName: ebEvent.name, eventUrl: ebEvent.url },
    };
  } catch (err) {
    logger.error({ err }, "save EB linkage failed");
    return { ok: false, error: "Couldn't save the Eventbrite linkage." };
  }
}

/**
 * Pull sales count from EB → events.ticket_sales_count. Operator
 * triggers via a sync button per row. (We don't auto-poll; that
 * would chew through EB rate limits.)
 */
const syncSchema = z.object({
  eventId: uuid,
});

export async function syncEventbriteSales(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ sold: number; capacity: number | null } | { notConfigured: true }>> {
  const { staff } = await requireStaff();
  const parsed = syncSchema.safeParse({ eventId: formData.get("eventId") });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const ebRow = await db
    .select({ ebId: events.eventbriteEventId })
    .from(events)
    .where(eq(events.id, parsed.data.eventId))
    .limit(1)
    .then((r) => r[0]);
  if (!ebRow?.ebId) {
    return { ok: false, error: "Link an Eventbrite event first." };
  }

  const { isEventbriteConfigured, fetchEventbriteSales } = await import("@/lib/eventbrite");
  if (!isEventbriteConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  const summary = await fetchEventbriteSales(ebRow.ebId);
  if (!summary) {
    return { ok: false, error: "Couldn't fetch sales from Eventbrite." };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(events)
        .set({
          ticketSalesCount: summary.sold,
          updatedBy: staff.id,
        })
        .where(eq(events.id, parsed.data.eventId));
    });
    revalidatePath("/all-crawls");
    publishRealtime({
      table: "all-crawls",
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { sold: summary.sold, capacity: summary.capacity } };
  } catch (err) {
    logger.error({ err }, "save EB sales failed");
    return { ok: false, error: "Couldn't save sales count." };
  }
}

/**
 * Format the crawl's confirmed venues + route + drink specials as
 * an HTML block, then PATCH it into the EB event description. Used
 * to keep the EB attendee page in sync with the operator's plan.
 */
const pushSchema = z.object({
  eventId: uuid,
  /** When true, ask Haiku for a 1-2 sentence intro paragraph that
   *  goes ABOVE the structured venue block. ~$0.0007/call.
   *  Failures gracefully fall through to the un-polished block.
   *  See lib/ai-eb-polish.ts. */
  polish: z
    .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0"), z.literal("")])
    .optional()
    .default("false"),
});

export async function pushEventbriteDescription(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ pushed: true; polished?: boolean } | { notConfigured: true }>> {
  const { staff } = await requireStaff();
  const parsed = pushSchema.safeParse({
    eventId: formData.get("eventId"),
    polish: formData.get("polish") ?? "false",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const polishRequested = parsed.data.polish === "true" || parsed.data.polish === "1";

  const ebRow = await db
    .select({
      ebId: events.eventbriteEventId,
      eventDate: events.eventDate,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      cityCampaignId: events.cityCampaignId,
    })
    .from(events)
    .where(eq(events.id, parsed.data.eventId))
    .limit(1)
    .then((r) => r[0]);
  if (!ebRow?.ebId) return { ok: false, error: "Link an Eventbrite event first." };

  const { isEventbriteConfigured, updateEventbriteDescription } = await import("@/lib/eventbrite");
  if (!isEventbriteConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  // Load confirmed venue_events for this crawl
  const rows = await db
    .select({
      role: venueEvents.role,
      slotPosition: venueEvents.slotPosition,
      status: venueEvents.status,
      venueName: venues.name,
      venueAddress: venues.address,
      agreedHoursText: venueEvents.agreedHoursText,
      drinkSpecials: venueEvents.drinkSpecials,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(eq(venueEvents.eventId, parsed.data.eventId))
    .orderBy(asc(venueEvents.role), asc(venueEvents.slotPosition));

  const block = formatVenuesBlock(
    rows.map((r) => ({
      role: r.role as string,
      slotPosition: r.slotPosition ?? 1,
      status: r.status as string,
      venueName: r.venueName,
      venueAddress: r.venueAddress,
      agreedHoursText: r.agreedHoursText,
      drinkSpecials: r.drinkSpecials,
    })),
  );

  // AI polish (Haiku ROI #7) — prepend a 1-2 sentence intro
  // above the structured block when requested. NEVER fails the
  // push: a polish error just sends the un-polished block.
  let finalBlock = block;
  let polishedFlag = false;
  if (polishRequested) {
    const confirmedCount = rows.filter((r) =>
      ["confirmed", "contract_signed"].includes(r.status as string),
    ).length;
    if (confirmedCount > 0 && ebRow.cityCampaignId) {
      // Need the city name — one cheap join.
      const cityRow = await db
        .select({ cityName: cities.name })
        .from(cityCampaigns)
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .where(eq(cityCampaigns.id, ebRow.cityCampaignId))
        .limit(1)
        .then((r) => r[0]);
      if (cityRow) {
        const { polishEbDescription } = await import("@/lib/ai-eb-polish");
        const polish = await polishEbDescription({
          staffId: staff.id,
          cityName: cityRow.cityName,
          dayPartLabel: formatDayPartForPolish(ebRow.dayPart),
          eventDate: ebRow.eventDate,
          venueCount: confirmedCount,
          crawlNumber: ebRow.crawlNumber ?? null,
        });
        if (polish.ok) {
          // Wrap the AI sentence in <p>; HTML-escape just in case
          // the model included angle brackets despite the prompt.
          const intro = `<p>${escapeHtml(polish.text)}</p>`;
          finalBlock = `${intro}\n${block}`;
          polishedFlag = true;
        }
      }
    }
  }

  const ok = await updateEventbriteDescription(ebRow.ebId, finalBlock);
  if (!ok) return { ok: false, error: "Couldn't push to Eventbrite." };

  publishRealtime({
    table: "all-crawls",
    type: "update",
    byStaffId: staff.id,
    byStaffName: staff.displayName ?? null,
  });
  return { ok: true, data: { pushed: true, polished: polishedFlag } };
}

function formatDayPartForPolish(dp: string | null): string {
  if (!dp) return "Evening";
  return dp
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function formatVenuesBlock(
  rows: Array<{
    role: string;
    slotPosition: number;
    status: string;
    venueName: string;
    venueAddress: string | null;
    agreedHoursText: string | null;
    drinkSpecials: string | null;
  }>,
): string {
  if (rows.length === 0) {
    return "<p><em>Venue lineup coming soon — check back closer to the event.</em></p>";
  }
  const ROLE_LABEL: Record<string, string> = {
    wristband: "🎟 Wristband Pickup",
    middle: "🍻 Stop",
    final: "🏁 Final",
    alt_final: "🏁 Alt Final",
  };
  const lines = rows
    .filter((r) => ["confirmed", "contract_signed"].includes(r.status))
    .map((r) => {
      const role = ROLE_LABEL[r.role] ?? r.role;
      const hours = r.agreedHoursText ? ` — ${escapeHtml(r.agreedHoursText)}` : "";
      const specials = r.drinkSpecials ? `<br><em>${escapeHtml(r.drinkSpecials)}</em>` : "";
      const address = r.venueAddress
        ? `<br><span style="color:#666">${escapeHtml(r.venueAddress)}</span>`
        : "";
      return `<p><strong>${role}: ${escapeHtml(r.venueName)}</strong>${hours}${address}${specials}</p>`;
    });
  if (lines.length === 0) {
    return "<p><em>Venue lineup is being finalized.</em></p>";
  }
  return ["<h3>🍻 Crawl Stops</h3>", ...lines].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Bulk-sync sales from Eventbrite for every linked crawl in a campaign.
 *
 * Iterates through each linked event sequentially (not in parallel) to
 * respect Eventbrite's ~1000 req/hour rate limit. Each event needs two
 * API calls (event + orders), so a 50-crawl campaign uses ~100 calls.
 *
 * Returns aggregate results so the UI can show a meaningful summary:
 *   { synced, failed, totalLinked }
 *
 * If the EB token isn't configured, returns notConfigured immediately
 * without iterating.
 */
/**
 * Comma-separated UUID list → trimmed array → validated as uuid[].
 * Used for bulk operations where the operator selects N rows and we
 * pass the ids as a single hidden form field.
 *
 * Max 200 — both keeps the SQL ANY-array reasonable and prevents an
 * accidental "select 1000 rows + push" from spamming EB rate limits.
 */
const bulkUuidList = z
  .string()
  .trim()
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(uuid).min(1).max(200));

const bulkSyncSchema = z.object({
  campaignId: uuid,
  /** When provided, sync only these specific events. Otherwise sync
   * every linked event in the campaign. */
  eventIds: bulkUuidList.optional(),
});

export async function bulkSyncEventbriteSales(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<
    | { synced: number; failed: number; totalLinked: number; ticketsTotal: number }
    | { notConfigured: true }
  >
> {
  const { staff } = await requireStaff();
  const parsed = bulkSyncSchema.safeParse({
    campaignId: formData.get("campaignId"),
    eventIds: formData.get("eventIds") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const { isEventbriteConfigured, fetchEventbriteSales } = await import("@/lib/eventbrite");
  if (!isEventbriteConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  // Pull every linked event in this campaign — optionally filtered to
  // a selection. The eventIds filter still requires campaign membership
  // so a user can't accidentally sync events from another campaign.
  const linkedRows = parsed.data.eventIds
    ? await db.execute<{ id: string; eventbrite_event_id: string }>(sql`
        SELECT e.id, e.eventbrite_event_id
        FROM events e
        JOIN city_campaigns cc ON cc.id = e.city_campaign_id
        WHERE cc.campaign_id = ${parsed.data.campaignId}
          AND e.eventbrite_event_id IS NOT NULL
          AND e.id IN ${parsed.data.eventIds}
      `)
    : await db.execute<{ id: string; eventbrite_event_id: string }>(sql`
        SELECT e.id, e.eventbrite_event_id
        FROM events e
        JOIN city_campaigns cc ON cc.id = e.city_campaign_id
        WHERE cc.campaign_id = ${parsed.data.campaignId}
          AND e.eventbrite_event_id IS NOT NULL
      `);
  const linked: Array<{ id: string; eventbrite_event_id: string }> = Array.isArray(linkedRows)
    ? (linkedRows as unknown as Array<{ id: string; eventbrite_event_id: string }>)
    : ((linkedRows as unknown as { rows: Array<{ id: string; eventbrite_event_id: string }> })
        .rows ?? []);

  if (linked.length === 0) {
    return { ok: true, data: { synced: 0, failed: 0, totalLinked: 0, ticketsTotal: 0 } };
  }

  let synced = 0;
  let failed = 0;
  let ticketsTotal = 0;

  // Sequential — protects rate limits + makes failures isolated. For a
  // 50-crawl campaign this finishes in 8-15s depending on EB latency.
  for (const row of linked) {
    try {
      const summary = await fetchEventbriteSales(row.eventbrite_event_id);
      if (!summary) {
        failed++;
        continue;
      }
      await withAuditContext(staff.id, async (tx) => {
        await tx
          .update(events)
          .set({ ticketSalesCount: summary.sold, updatedBy: staff.id })
          .where(eq(events.id, row.id));
      });
      synced++;
      ticketsTotal += summary.sold;
    } catch (err) {
      logger.warn({ err, eventId: row.id }, "bulk sync row failed");
      failed++;
    }
  }

  revalidatePath("/all-crawls");

  publishRealtime({
    table: "all-crawls",

    type: "update",

    byStaffId: staff.id,

    byStaffName: staff.displayName ?? null,
  });
  return {
    ok: true,
    data: { synced, failed, totalLinked: linked.length, ticketsTotal },
  };
}

// =========================================================================
// Bulk push descriptions
//
// For each selected event with a linked EB id, format its confirmed
// venues as HTML, PATCH the EB description with the marker-fenced block.
// Sequential to respect EB rate limits.
// =========================================================================

const bulkPushSchema = z.object({
  campaignId: uuid,
  eventIds: bulkUuidList,
});

export async function bulkPushEventbriteDescriptions(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{ pushed: number; failed: number; skipped: number } | { notConfigured: true }>
> {
  const { staff } = await requireStaff();
  const parsed = bulkPushSchema.safeParse({
    campaignId: formData.get("campaignId"),
    eventIds: formData.get("eventIds"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const { isEventbriteConfigured, updateEventbriteDescription } = await import("@/lib/eventbrite");
  if (!isEventbriteConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  // Resolve which selected events are actually linked to EB. Skip the
  // others — pushing description to a non-linked event is a no-op
  // (we don't have an EB id to target).
  const linkedRows = await db.execute<{ id: string; eventbrite_event_id: string }>(sql`
    SELECT e.id, e.eventbrite_event_id
    FROM events e
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    WHERE cc.campaign_id = ${parsed.data.campaignId}
      AND e.id IN ${parsed.data.eventIds}
      AND e.eventbrite_event_id IS NOT NULL
  `);
  const linked: Array<{ id: string; eventbrite_event_id: string }> = Array.isArray(linkedRows)
    ? (linkedRows as unknown as Array<{ id: string; eventbrite_event_id: string }>)
    : ((linkedRows as unknown as { rows: Array<{ id: string; eventbrite_event_id: string }> })
        .rows ?? []);

  const skipped = parsed.data.eventIds.length - linked.length;
  let pushed = 0;
  let failed = 0;

  for (const row of linked) {
    try {
      // Load confirmed venue_events for this crawl, build block, push
      const venueRows = await db
        .select({
          role: venueEvents.role,
          slotPosition: venueEvents.slotPosition,
          status: venueEvents.status,
          venueName: venues.name,
          venueAddress: venues.address,
          agreedHoursText: venueEvents.agreedHoursText,
          drinkSpecials: venueEvents.drinkSpecials,
        })
        .from(venueEvents)
        .innerJoin(venues, eq(venues.id, venueEvents.venueId))
        .where(eq(venueEvents.eventId, row.id))
        .orderBy(asc(venueEvents.role), asc(venueEvents.slotPosition));

      const block = formatVenuesBlockForBulk(
        venueRows.map((r) => ({
          role: r.role as string,
          slotPosition: r.slotPosition ?? 1,
          status: r.status as string,
          venueName: r.venueName,
          venueAddress: r.venueAddress,
          agreedHoursText: r.agreedHoursText,
          drinkSpecials: r.drinkSpecials,
        })),
      );

      const ok = await updateEventbriteDescription(row.eventbrite_event_id, block);
      if (ok) pushed++;
      else failed++;
    } catch (err) {
      logger.warn({ err, eventId: row.id }, "bulk push row failed");
      failed++;
    }
  }

  revalidatePath("/all-crawls");

  publishRealtime({
    table: "all-crawls",

    type: "update",

    byStaffId: staff.id,

    byStaffName: staff.displayName ?? null,
  });
  return { ok: true, data: { pushed, failed, skipped } };
}

// =========================================================================
// Bulk unlink — clears eventbrite_event_id + eventbrite_url on N events.
// Useful when a CSV import landed bad EB IDs and the operator wants to
// reset before re-linking.
// =========================================================================

const bulkUnlinkSchema = z.object({
  campaignId: uuid,
  eventIds: bulkUuidList,
});

export async function bulkUnlinkEventbrite(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ unlinked: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkUnlinkSchema.safeParse({
    campaignId: formData.get("campaignId"),
    eventIds: formData.get("eventIds"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  try {
    const unlinked = await withAuditContext(staff.id, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE events
        SET eventbrite_event_id = NULL,
            eventbrite_url = NULL,
            updated_by = ${staff.id},
            updated_at = NOW()
        FROM city_campaigns cc
        WHERE events.id IN ${parsed.data.eventIds}
          AND events.city_campaign_id = cc.id
          AND cc.campaign_id = ${parsed.data.campaignId}
          AND events.eventbrite_event_id IS NOT NULL
        RETURNING events.id
      `);
      const rows: Array<{ id: string }> = Array.isArray(result)
        ? (result as unknown as Array<{ id: string }>)
        : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      return rows.length;
    });
    revalidatePath("/all-crawls");
    publishRealtime({
      table: "all-crawls",
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { unlinked } };
  } catch (err) {
    logger.error({ err }, "bulkUnlinkEventbrite failed");
    return { ok: false, error: "Bulk unlink failed." };
  }
}

/**
 * Shared block formatter for bulkPushEventbriteDescriptions — kept
 * here (not imported from pushEventbriteDescription) to avoid pulling
 * the single-crawl action into the bulk path. Mirrors the same HTML
 * shape so EB pages render consistently across single + bulk pushes.
 */
function formatVenuesBlockForBulk(
  rows: Array<{
    role: string;
    slotPosition: number;
    status: string;
    venueName: string;
    venueAddress: string | null;
    agreedHoursText: string | null;
    drinkSpecials: string | null;
  }>,
): string {
  if (rows.length === 0) {
    return "<p><em>Venue lineup coming soon — check back closer to the event.</em></p>";
  }
  const ROLE_LABEL: Record<string, string> = {
    wristband: "🎟 Wristband Pickup",
    middle: "🍻 Stop",
    final: "🏁 Final",
    alt_final: "🏁 Alt Final",
  };
  const lines = rows
    .filter((r) => ["confirmed", "contract_signed"].includes(r.status))
    .map((r) => {
      const role = ROLE_LABEL[r.role] ?? r.role;
      const hours = r.agreedHoursText ? ` — ${escapeHtmlForBulk(r.agreedHoursText)}` : "";
      const specials = r.drinkSpecials ? `<br><em>${escapeHtmlForBulk(r.drinkSpecials)}</em>` : "";
      const address = r.venueAddress
        ? `<br><span style="color:#666">${escapeHtmlForBulk(r.venueAddress)}</span>`
        : "";
      return `<p><strong>${role}: ${escapeHtmlForBulk(r.venueName)}</strong>${hours}${address}${specials}</p>`;
    });
  if (lines.length === 0) {
    return "<p><em>Venue lineup is being finalized.</em></p>";
  }
  return ["<h3>🍻 Crawl Stops</h3>", ...lines].join("\n");
}

function escapeHtmlForBulk(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =========================================================================
// Bulk set event start/end times across selected crawls
// =========================================================================

/**
 * Apply a start time + end time (HH:MM clock-of-day) to many events at
 * once. Each event keeps its own date; the action computes the actual
 * timestamp by combining the date with the time-of-day in the city's
 * IANA timezone — so "22:00 / 02:00" applied to a New York and a
 * Toronto event yields different UTC instants, both correctly anchored
 * to local time.
 *
 * End time earlier than start time is treated as the NEXT calendar day
 * (e.g. start 22:00, end 02:00 → end lands on day+1 02:00 local), which
 * is the common "crawl runs past midnight" case.
 *
 * Operator workflow:
 *   1. Filter the all-crawls table to a single crawl number (e.g. all
 *      "Crawl 1" events for Halloween).
 *   2. Select all + click "Set times".
 *   3. Popover takes start + end HH:MM, hits this action.
 *   4. Every event's startsAt/endsAt is rewritten in one transaction.
 *
 * Pass startTime/endTime as "" to clear (sets NULL). Both fields can be
 * sent independently — passing only startTime leaves endsAt unchanged.
 */
const bulkSetTimesSchema = z.object({
  eventIds: z.array(uuid).min(1).max(500),
  /** "HH:MM" 24-hour, or "" to clear. Optional means "don't touch". */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$|^$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$|^$/)
    .optional(),
});

export async function bulkSetEventTimes(
  input: z.infer<typeof bulkSetTimesSchema>,
): Promise<ActionResult<{ updated: number; skipped: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkSetTimesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid times payload." };
  }
  const { eventIds, startTime, endTime } = parsed.data;
  if (startTime === undefined && endTime === undefined) {
    return { ok: false, error: "Provide at least one of start or end time." };
  }

  // Pull each event's date + its city's timezone in one query so we
  // can build per-row local timestamps. Skip events without a date —
  // can't compute a timestamp without one.
  const rows = await db.execute<{
    id: string;
    event_date: string | null;
    timezone: string;
  }>(sql`
    SELECT e.id::text AS id,
           e.event_date::text AS event_date,
           c.timezone AS timezone
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
     WHERE e.id IN (${sql.join(
       eventIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
  `);

  type Row = { id: string; event_date: string | null; timezone: string };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  // Build per-row computed timestamps client-side BEFORE hitting the DB.
  // Previous implementation did N round-trips inside one transaction
  // (one UPDATE per row); for 200+ events that loop alone could take
  // 5-15 seconds and the popover's spinner sat indefinitely. Switching
  // to a single bulk UPDATE...FROM(VALUES...) statement collapses
  // hundreds of round-trips into one.
  type Patch = {
    id: string;
    startsAt: Date | null;
    endsAt: Date | null;
    /** Which columns the SET clause should actually touch for this row.
     *  When startTime wasn't sent at all (undefined), starts_at must be
     *  left untouched. Same for endTime. */
    touchStarts: boolean;
    touchEnds: boolean;
  };
  const patches: Patch[] = [];
  let skipped = 0;
  for (const r of list) {
    if (!r.event_date) {
      skipped += 1;
      continue;
    }
    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    if (startTime !== undefined && startTime !== "") {
      startsAt = zonedTimestamp(r.event_date, startTime, r.timezone);
    }
    if (endTime !== undefined && endTime !== "") {
      // If endTime < startTime (start 22:00, end 02:00), treat end as
      // next day — the past-midnight crawl case.
      const startForCmp = startTime !== undefined && startTime !== "" ? startTime : null;
      const rollover = startForCmp !== null && endTime < startForCmp ? 1 : 0;
      endsAt = zonedTimestamp(r.event_date, endTime, r.timezone, rollover);
    }
    patches.push({
      id: r.id,
      startsAt,
      endsAt,
      touchStarts: startTime !== undefined,
      touchEnds: endTime !== undefined,
    });
  }

  if (patches.length === 0) {
    return { ok: true, data: { updated: 0, skipped } };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      // Build a VALUES list with one row per event:
      //   (id::uuid, starts_at::timestamptz, ends_at::timestamptz)
      // For rows where the operator didn't touch starts_at (or ends_at)
      // we still include a placeholder NULL and use a separate boolean
      // column to tell the SET clause whether to apply it. This keeps
      // the statement to a single round-trip regardless of row count.
      const valuesRows = patches.map((p) => {
        const startsTs = p.startsAt ? sql`${p.startsAt.toISOString()}::timestamptz` : sql`NULL`;
        const endsTs = p.endsAt ? sql`${p.endsAt.toISOString()}::timestamptz` : sql`NULL`;
        return sql`(${p.id}::uuid, ${startsTs}, ${endsTs}, ${p.touchStarts}::bool, ${p.touchEnds}::bool, ${p.touchStarts && p.startsAt === null}::bool, ${p.touchEnds && p.endsAt === null}::bool)`;
      });

      // Columns in VALUES:
      //   id, starts_at, ends_at, touch_starts, touch_ends, clear_starts, clear_ends
      //
      // The CASE expressions handle four scenarios per side:
      //   - don't touch the column: keep e.starts_at as-is
      //   - set to a real timestamp: use v.starts_at
      //   - clear the column to NULL: explicit NULL via clear_starts
      await tx.execute(sql`
        UPDATE events e
           SET starts_at = CASE
                 WHEN v.clear_starts THEN NULL
                 WHEN v.touch_starts THEN v.starts_at
                 ELSE e.starts_at
               END,
               ends_at = CASE
                 WHEN v.clear_ends THEN NULL
                 WHEN v.touch_ends THEN v.ends_at
                 ELSE e.ends_at
               END,
               updated_by = ${staff.id}::uuid,
               updated_at = NOW()
          FROM (VALUES ${sql.join(valuesRows, sql`, `)})
            AS v(id, starts_at, ends_at, touch_starts, touch_ends, clear_starts, clear_ends)
         WHERE e.id = v.id
      `);
    });

    // Invalidate the all-crawls route + the dashboard so the new times
    // appear without a manual refresh.
    revalidatePath("/all-crawls");
    revalidatePath("/");

    return { ok: true, data: { updated: patches.length, skipped } };
  } catch (err) {
    logger.error({ err, count: patches.length }, "bulkSetEventTimes failed");
    return { ok: false, error: "Bulk update failed. Try again." };
  }
}

/**
 * Combine an ISO event_date ("YYYY-MM-DD"), a clock time ("HH:MM"),
 * and an IANA timezone into a Date that represents that wall-clock
 * moment in that zone. Optionally add `dayOffset` calendar days to
 * support the "crawl ends past midnight" case.
 *
 * Implementation: assemble an ISO string with the date+time, ask
 * Intl.DateTimeFormat (timeZone: 'UTC' against the zoned time) what
 * offset that zone had on that date, and apply the inverse. Pure JS,
 * no extra deps.
 */
function zonedTimestamp(isoDate: string, hhmm: string, timeZone: string, dayOffset = 0): Date {
  const [year, month, day] = isoDate.split("-").map((n) => Number.parseInt(n, 10));
  const [hh, mm] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  if (year == null || month == null || day == null || hh == null || mm == null) {
    return new Date(Number.NaN);
  }
  // Build a UTC date with the requested wall-clock values + dayOffset,
  // then determine what offset the target zone had at that moment and
  // shift to align UTC with local.
  const naiveUtc = new Date(Date.UTC(year, month - 1, day + dayOffset, hh, mm, 0));
  // Use Intl to find what local time `naiveUtc` produces in timeZone;
  // the gap between requested local time and what timeZone reports is
  // the offset we need to subtract from naiveUtc.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(naiveUtc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const reportedAsUtc = Date.UTC(
    Number.parseInt(parts.year ?? "0", 10),
    Number.parseInt(parts.month ?? "1", 10) - 1,
    Number.parseInt(parts.day ?? "1", 10),
    Number.parseInt(parts.hour === "24" ? "0" : (parts.hour ?? "0"), 10),
    Number.parseInt(parts.minute ?? "0", 10),
    Number.parseInt(parts.second ?? "0", 10),
  );
  const offsetMs = reportedAsUtc - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offsetMs);
}

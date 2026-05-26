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

import { events, venueEvents, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
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
});

export async function pushEventbriteDescription(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ pushed: true } | { notConfigured: true }>> {
  await requireStaff();
  const parsed = pushSchema.safeParse({ eventId: formData.get("eventId") });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const ebRow = await db
    .select({ ebId: events.eventbriteEventId, eventDate: events.eventDate })
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
  const ok = await updateEventbriteDescription(ebRow.ebId, block);
  if (!ok) return { ok: false, error: "Couldn't push to Eventbrite." };

  return { ok: true, data: { pushed: true } };
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
const bulkSyncSchema = z.object({
  campaignId: uuid,
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
  const parsed = bulkSyncSchema.safeParse({ campaignId: formData.get("campaignId") });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const { isEventbriteConfigured, fetchEventbriteSales } = await import("@/lib/eventbrite");
  if (!isEventbriteConfigured()) {
    return { ok: true, data: { notConfigured: true } };
  }

  // Pull every linked event in this campaign
  const linkedRows = await db.execute<{ id: string; eventbrite_event_id: string }>(sql`
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
  return {
    ok: true,
    data: { synced, failed, totalLinked: linked.length, ticketsTotal },
  };
}

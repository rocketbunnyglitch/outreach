import "server-only";

/**
 * Eventbrite API client.
 *
 * One private OAuth token serves the whole org — every event the
 * operator manages is owned by the same Eventbrite account, so we
 * don't need per-event credentials. The token lives at
 *   process.env.EVENTBRITE_PRIVATE_TOKEN
 * and is loaded once per request.
 *
 * Two main flows:
 *
 *   A. Pull sales for a crawl
 *      The operator entered an Eventbrite event ID on a crawl row.
 *      We GET /v3/events/{id}/ and read capacity + sold ticket counts,
 *      then update events.ticketSalesCount.
 *
 *   B. Push venue info to the event description
 *      When the crawl's venue slots are confirmed, we PATCH the EB
 *      event's description with a formatted "Crawl Stops" block so
 *      attendees see the route on their ticket page.
 *
 * Without the token: all functions return null/graceful errors and
 * the UI surfaces the "not configured" state.
 *
 * Rate limits: Eventbrite allows ~1000 req/hour per token. We don't
 * batch-poll; sync is triggered on operator action only.
 */

import { logger } from "@/lib/logger";

const EB_BASE = "https://www.eventbriteapi.com/v3";

export interface EventbriteEvent {
  id: string;
  name: string;
  startUtc: string | null;
  endUtc: string | null;
  status: string;
  capacity: number | null;
  url: string | null;
  description: string | null;
  /** Eventbrite "venue_id" — internal to EB, used to fetch city. */
  venueId: string | null;
  /** Resolved city name from EB venue object (used for the smart check). */
  cityName: string | null;
}

export interface EventbriteSalesSummary {
  /** Total tickets reserved (paid + free + reserved but not yet completed). */
  sold: number;
  /** Capacity (null = unlimited). */
  capacity: number | null;
  /** Total gross sales in minor units (cents). */
  grossCents: number;
}

export function isEventbriteConfigured(): boolean {
  return !!process.env.EVENTBRITE_PRIVATE_TOKEN;
}

function ebHeaders(): HeadersInit {
  const token = process.env.EVENTBRITE_PRIVATE_TOKEN ?? "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Fetch an Eventbrite event by ID + resolve its venue's city name.
 * Two API calls when a venue is attached. Returns null when the event
 * doesn't exist, the token is missing, or the API call fails.
 */
export async function fetchEventbriteEvent(eventId: string): Promise<EventbriteEvent | null> {
  const { event } = await fetchEventbriteEventWithStatus(eventId);
  return event;
}

/**
 * Same as fetchEventbriteEvent but also reports the HTTP status of a
 * failed lookup so callers can tell the operator WHY a link failed
 * (404 = wrong ID vs 401/403 = token can't see the event). status is
 * null when the call never reached Eventbrite (no token / network).
 */
export async function fetchEventbriteEventWithStatus(
  eventId: string,
): Promise<{ event: EventbriteEvent | null; status: number | null }> {
  if (!isEventbriteConfigured()) return { event: null, status: null };

  try {
    const response = await fetch(`${EB_BASE}/events/${encodeURIComponent(eventId)}/`, {
      method: "GET",
      headers: ebHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status, eventId }, "eventbrite event fetch non-200");
      return { event: null, status: response.status };
    }
    const json = (await response.json()) as Record<string, unknown>;

    // Resolve city — EB returns venue_id, we fetch the venue separately
    const venueId = (json.venue_id as string | null) ?? null;
    let cityName: string | null = null;
    if (venueId) {
      try {
        const venueResponse = await fetch(`${EB_BASE}/venues/${encodeURIComponent(venueId)}/`, {
          method: "GET",
          headers: ebHeaders(),
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (venueResponse.ok) {
          const venueJson = (await venueResponse.json()) as {
            address?: { city?: string };
          };
          cityName = venueJson.address?.city ?? null;
        }
      } catch {
        // Best-effort — empty city just disables the smart check below
      }
    }

    return {
      event: {
        id: String(json.id ?? eventId),
        name: ((json.name as { text?: string } | undefined)?.text ?? "") as string,
        startUtc: ((json.start as { utc?: string } | undefined)?.utc ?? null) as string | null,
        endUtc: ((json.end as { utc?: string } | undefined)?.utc ?? null) as string | null,
        status: String(json.status ?? "unknown"),
        capacity: (json.capacity as number | null) ?? null,
        url: (json.url as string | null) ?? null,
        description: ((json.description as { text?: string } | undefined)?.text ?? null) as
          | string
          | null,
        venueId,
        cityName,
      },
      status: response.status,
    };
  } catch (err) {
    logger.warn({ err, eventId }, "eventbrite event fetch failed");
    return { event: null, status: null };
  }
}

/**
 * Get a sales summary for an event. We call the orders endpoint with
 * status=placed which returns all completed + reserved orders. Counting
 * attendees is more accurate than capacity-minus-available because EB
 * caches the latter inconsistently across regions.
 */
export async function fetchEventbriteSales(
  eventId: string,
): Promise<EventbriteSalesSummary | null> {
  if (!isEventbriteConfigured()) return null;

  try {
    const response = await fetch(
      `${EB_BASE}/events/${encodeURIComponent(eventId)}/?expand=ticket_availability`,
      {
        method: "GET",
        headers: ebHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      capacity?: number | null;
      ticket_availability?: {
        minimum_ticket_price?: { value?: number };
      };
    };
    const capacity = (json.capacity as number | null) ?? null;

    // Orders endpoint — preferred for accurate sold count
    const ordersResponse = await fetch(
      `${EB_BASE}/events/${encodeURIComponent(eventId)}/orders/?status=placed&expand=attendees`,
      {
        method: "GET",
        headers: ebHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!ordersResponse.ok) {
      return { sold: 0, capacity, grossCents: 0 };
    }
    const ordersJson = (await ordersResponse.json()) as {
      orders?: Array<{
        costs?: { gross?: { value?: number } };
        attendees?: Array<unknown>;
      }>;
    };

    let sold = 0;
    let grossCents = 0;
    for (const order of ordersJson.orders ?? []) {
      sold += order.attendees?.length ?? 0;
      grossCents += order.costs?.gross?.value ?? 0;
    }

    return { sold, capacity, grossCents };
  } catch (err) {
    logger.warn({ err, eventId }, "eventbrite sales fetch failed");
    return null;
  }
}

/**
 * Patch the Eventbrite event's description with venue route info.
 * The operator's confirmed venue stops are formatted as a clean block
 * appended (or replacing) the existing description.
 *
 * We marker-fence our additions so operator-written intro text is
 * preserved across syncs:
 *
 *   {operator text}
 *   <!--CRAWL_VENUES_BEGIN-->
 *   {our formatted block}
 *   <!--CRAWL_VENUES_END-->
 *
 * Subsequent syncs replace the fenced block in place, never touching
 * the operator's intro.
 */
export async function updateEventbriteDescription(
  eventId: string,
  venuesBlock: string,
): Promise<boolean> {
  if (!isEventbriteConfigured()) return false;

  // Read current description so we can merge our block in
  const existing = await fetchEventbriteEvent(eventId);
  if (!existing) return false;

  const beginMarker = "<!--CRAWL_VENUES_BEGIN-->";
  const endMarker = "<!--CRAWL_VENUES_END-->";
  const fence = `${beginMarker}\n${venuesBlock}\n${endMarker}`;

  let nextDescription: string;
  const current = existing.description ?? "";
  if (current.includes(beginMarker) && current.includes(endMarker)) {
    nextDescription = current.replace(
      new RegExp(`${beginMarker}[\\s\\S]*?${endMarker}`, "m"),
      fence,
    );
  } else {
    nextDescription = (current ? `${current}\n\n` : "") + fence;
  }

  try {
    const response = await fetch(`${EB_BASE}/events/${encodeURIComponent(eventId)}/`, {
      method: "POST",
      headers: ebHeaders(),
      body: JSON.stringify({
        event: {
          description: { html: nextDescription },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch (err) {
    logger.warn({ err, eventId }, "eventbrite description update failed");
    return false;
  }
}

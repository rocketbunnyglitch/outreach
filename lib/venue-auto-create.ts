import "server-only";

/**
 * Auto-tag / auto-create a venue from an inbound email when the normal
 * address-based matching (resolveVenueFromAddress) found nothing.
 *
 * Policy (operator-chosen "confident auto-create"):
 *   - Only genuine business correspondence: skip spam / auto_reply /
 *     unsubscribe classifications and free-email domains (gmail etc.) --
 *     we can't reliably derive a venue from a personal mailbox or noise.
 *   - CITY is matched against the system's KNOWN cities only (scan the
 *     subject + body for a known city name -- code-first, no AI cost).
 *   - NAME comes from the sender display name (when it looks like a
 *     business) -- code-first. Haiku is a FALLBACK only when code is
 *     unsure about the name and/or city.
 *   - A venue is created ONLY when we end up with BOTH a confident name
 *     AND a city that maps to an existing city row (venues.city_id is
 *     NOT NULL). Anything short of that leaves the thread Unassigned for
 *     a one-click operator attach -- no junk venues.
 *   - Dedup: if a venue with the same (city, name) already exists, we
 *     attach to it instead of creating a duplicate.
 */

import { cities, connectedAccounts, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, ilike } from "drizzle-orm";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Personal / free mailboxes a business venue would not send from.
const FREE_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

// Classifications that are NOT genuine venue correspondence.
const SKIP_CLASSIFICATIONS = new Set<string>(["spam", "auto_reply", "unsubscribe"]);

// Display-name tokens that signal a business (vs a person's name).
const BUSINESS_HINTS = [
  "bar",
  "club",
  "lounge",
  "hotel",
  "pub",
  "tavern",
  "venue",
  "events",
  "event",
  "hospitality",
  "group",
  "restaurant",
  "grill",
  "kitchen",
  "hall",
  "room",
  "rooftop",
  "patio",
  "brewery",
  "distillery",
  "cantina",
  "&",
  "the ",
];

function pickCodeName(fromName: string | null): string | null {
  const n = (fromName ?? "").trim();
  if (n.length < 2) return null;
  const lower = n.toLowerCase();
  if (BUSINESS_HINTS.some((h) => lower.includes(h))) return n;
  // A bare two-token "First Last" is almost certainly a person -> defer
  // to Haiku for the real venue name.
  return null;
}

interface HaikuExtract {
  venueName: string | null;
  city: string | null;
}

function parseExtractJson(raw: string): HaikuExtract | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const venueName = typeof obj.venueName === "string" ? obj.venueName.trim() : null;
    const city = typeof obj.city === "string" ? obj.city.trim() : null;
    return {
      venueName: venueName && venueName.length > 1 ? venueName : null,
      city: city && city.length > 1 ? city : null,
    };
  } catch {
    return null;
  }
}

export async function autoTagOrCreateVenue(opts: {
  /** Normalized lowercase sender email. */
  fromEmail: string;
  /** Sender display name, if any. */
  fromName: string | null;
  subject: string;
  bodyText: string | null;
  /** Triage classification suggestion (or null). */
  classification: string | null;
  /** Staff id to stamp created_by / updated_by. */
  createdByStaffId: string;
}): Promise<{ venueId: string | null; created: boolean }> {
  const none = { venueId: null as string | null, created: false };

  // Gate 1: genuine correspondence only.
  if (opts.classification && SKIP_CLASSIFICATIONS.has(opts.classification)) return none;

  // Gate 2: business domain only.
  const domain = opts.fromEmail.split("@")[1]?.toLowerCase();
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return none;

  try {
    // Gate 3: NEVER our own outreach identities. Staff forwarding/replying
    // between team inboxes ingests as "inbound" with one of OUR addresses as
    // the sender -- auto-create then stamped a STAFF email as a venue's
    // contact email (5 venues + 1 duplicate venue, found 2026-06-10). Match
    // by DOMAIN, not exact address: aliases on our sending domains (e.g.
    // yuri@events-perse.com) are equally ours.
    const ownAccounts = await db
      .select({ email: connectedAccounts.emailAddress })
      .from(connectedAccounts);
    const ownDomains = new Set(
      ownAccounts.map((a) => a.email.split("@")[1]?.toLowerCase()).filter(Boolean),
    );
    if (ownDomains.has(domain)) {
      logger.info(
        { fromEmail: opts.fromEmail },
        "venue auto-create skipped: sender is one of our own outreach domains",
      );
      return none;
    }
    const cityRows = await db.select({ id: cities.id, name: cities.name }).from(cities);
    if (cityRows.length === 0) return none;

    // CITY (code-first): scan subject + body for a known city name.
    // Longest names first so "New York City" beats "York" on collisions.
    const haystack = `${opts.subject}\n${opts.bodyText ?? ""}`.toLowerCase();
    const byLongest = cityRows.slice().sort((a, b) => b.name.length - a.name.length);
    let cityId: string | null = null;
    let cityName: string | null = null;
    for (const c of byLongest) {
      const n = c.name.trim().toLowerCase();
      if (n.length >= 3 && haystack.includes(n)) {
        cityId = c.id;
        cityName = c.name;
        break;
      }
    }

    // NAME (code-first): business-looking display name.
    let venueName = pickCodeName(opts.fromName);

    // Haiku FALLBACK: only when code is unsure about name and/or city.
    if ((!venueName || !cityId) && isAiConfigured()) {
      const knownCities = cityRows
        .map((c) => c.name)
        .slice(0, 200)
        .join(", ");
      const ai = await generateCompletion({
        tag: "inbox_venue_autocreate",
        model: HAIKU_MODEL,
        maxTokens: 120,
        system:
          "You extract the sending venue/business name and its city from an inbound email. " +
          'Return ONLY compact JSON: {"venueName": string|null, "city": string|null}. ' +
          "venueName is the BUSINESS that sent the email (a bar/club/lounge/hotel/restaurant/venue), " +
          "NOT a person's name and NOT the email domain verbatim. " +
          "city MUST be chosen from the provided known-cities list (exact spelling) or null if none clearly applies.",
        prompt: [
          `Known cities: ${knownCities}`,
          `Sender domain: ${domain}`,
          `Sender name: ${opts.fromName ?? "(none)"}`,
          `Subject: ${opts.subject}`,
          `Body:\n${(opts.bodyText ?? "").slice(0, 1500)}`,
        ].join("\n\n"),
      });
      if (ai.ok && ai.text) {
        const parsed = parseExtractJson(ai.text);
        if (parsed) {
          if (!venueName && parsed.venueName) venueName = parsed.venueName;
          if (!cityId && parsed.city) {
            const match = cityRows.find(
              (c) => c.name.trim().toLowerCase() === parsed.city?.trim().toLowerCase(),
            );
            if (match) {
              cityId = match.id;
              cityName = match.name;
            }
          }
        }
      }
    }

    // Confident auto-create requires BOTH a name and a known city.
    if (!venueName || !cityId) return none;

    // Dedup: attach to an existing same-(city,name) venue rather than dup.
    const existing = await db
      .select({ id: venues.id })
      .from(venues)
      .where(and(eq(venues.cityId, cityId), ilike(venues.name, venueName)))
      .limit(1);
    if (existing[0]) {
      return { venueId: existing[0].id, created: false };
    }

    const [created] = await db
      .insert(venues)
      .values({
        cityId,
        name: venueName,
        // Seed the sender as the venue email so future inbound from this
        // address matches at ingest (Tier 1) without re-running this path.
        email: opts.fromEmail,
        createdBy: opts.createdByStaffId,
        updatedBy: opts.createdByStaffId,
      })
      .returning({ id: venues.id });
    if (!created) return none;

    logger.info(
      { venueId: created.id, venueName, cityName, domain },
      "[venue-auto-create] created venue from inbound email",
    );
    return { venueId: created.id, created: true };
  } catch (err) {
    // Never let auto-create failure block message ingest.
    logger.warn(
      { err, fromEmail: opts.fromEmail },
      "[venue-auto-create] failed; ingesting unassigned",
    );
    return none;
  }
}

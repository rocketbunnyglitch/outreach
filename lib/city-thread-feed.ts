import "server-only";

/**
 * City-scoped email feed for the city sheet (operator request
 * 2026-06-11: "at the bottom of every city page, under the map, a
 * version of the inbox that shows all emails for this city for this
 * campaign — instant visibility for anyone working the city").
 *
 * Scope = threads attached to any venue in this city, filtered by the
 * campaign's gmail label (the same canonical scope the inbox and
 * worklist use — lib/campaign-thread-scope.ts). Falls back to the
 * campaign-era date cutoff when the campaign has no label so the feed
 * never goes empty from a labeling hiccup.
 *
 * Read-only: rows deep-link into /inbox/[threadId] for replies and
 * triage. Timestamps are preformatted here (Toronto-pinned) so the
 * list component can stay a hydration-safe server component.
 */

import { cities, cityCampaigns, emailThreads, venues } from "@/db/schema";
import { campaignLabelScopeFor, getCampaignLabel } from "@/lib/campaign-thread-scope";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
});

export interface CityThreadRow {
  threadId: string;
  subject: string;
  venueName: string | null;
  state: string;
  /** Direction of the LATEST message — "inbound" = they wrote us. */
  latestDirection: string | null;
  latestSnippet: string | null;
  latestFromName: string | null;
  /** Preformatted Toronto-pinned timestamp, e.g. "Jun 10, 4:32 PM". */
  timeLabel: string;
}

export interface CityThreadFeed {
  rows: CityThreadRow[];
  totalCount: number;
  campaignLabel: string | null;
}

const EMPTY: CityThreadFeed = { rows: [], totalCount: 0, campaignLabel: null };
const FEED_LIMIT = 50;

export async function loadCityThreadFeed(cityCampaignId: string): Promise<CityThreadFeed> {
  try {
    const [cc] = await db
      .select({
        cityId: cityCampaigns.cityId,
        campaignId: cityCampaigns.campaignId,
      })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(eq(cityCampaigns.id, cityCampaignId))
      .limit(1);
    if (!cc) return EMPTY;

    const labelScope = await campaignLabelScopeFor(cc.campaignId);
    const campaignLabel = await getCampaignLabel(cc.campaignId);

    // Threads on any venue in this city, scoped to the campaign label
    // (or the campaign-era cutoff when no label is configured).
    const cityVenueIds = db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.cityId, cc.cityId));

    const scope = and(
      inArray(emailThreads.venueId, cityVenueIds),
      labelScope ?? sql`${emailThreads.lastMessageAt} >= '2026-06-01'::timestamptz`,
    );

    const latestDirection = sql<
      string | null
    >`(SELECT m.direction::text FROM email_messages m WHERE m.thread_id = ${emailThreads.id} ORDER BY m.sent_at DESC LIMIT 1)`;
    const latestSnippet = sql<
      string | null
    >`(SELECT m.snippet FROM email_messages m WHERE m.thread_id = ${emailThreads.id} ORDER BY m.sent_at DESC LIMIT 1)`;
    const latestFromName = sql<
      string | null
    >`(SELECT m.from_name FROM email_messages m WHERE m.thread_id = ${emailThreads.id} ORDER BY m.sent_at DESC LIMIT 1)`;

    const [rows, [countRow]] = await Promise.all([
      db
        .select({
          threadId: emailThreads.id,
          subject: emailThreads.subject,
          state: emailThreads.state,
          lastMessageAt: emailThreads.lastMessageAt,
          venueName: venues.name,
          latestDirection,
          latestSnippet,
          latestFromName,
        })
        .from(emailThreads)
        .leftJoin(venues, eq(venues.id, emailThreads.venueId))
        .where(scope)
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(FEED_LIMIT),
      db.select({ n: sql<number>`count(*)::int` }).from(emailThreads).where(scope),
    ]);

    return {
      rows: rows.map((r) => ({
        threadId: r.threadId,
        subject: r.subject?.trim() || "(no subject)",
        venueName: r.venueName,
        state: r.state,
        latestDirection: r.latestDirection,
        latestSnippet: r.latestSnippet,
        latestFromName: r.latestFromName,
        timeLabel: TIME_FMT.format(r.lastMessageAt),
      })),
      totalCount: countRow?.n ?? rows.length,
      campaignLabel,
    };
  } catch (err) {
    logger.error({ err, cityCampaignId }, "loadCityThreadFeed failed");
    return EMPTY;
  }
}

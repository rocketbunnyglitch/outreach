import "server-only";

/**
 * Crawl Support — live event-day operations data loader.
 *
 * Computes, per crawl, a live status from the Eventbrite-synced start/end
 * times (events.starts_at / ends_at) relative to "now", and buckets crawls
 * for the support views. City-local time comes from cities.timezone (IANA).
 * Pure status/label/window logic lives in ./crawl-support-types (client-safe).
 *
 * NOTE (staged): venue-role enrichment (wristband/middle/final venue names),
 * host assignments, wristband shipping status, and the calls/issues views land
 * in follow-up passes (some need the call_logs + crawl_issues tables). This
 * module ships the time/status backbone first so the tab is real off existing
 * data.
 */

import { events, campaigns, cities, cityCampaigns } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  type CrawlSupportData,
  type SupportBucket,
  type SupportCrawl,
  bucketFor,
  computeCrawlStatus,
} from "./crawl-support-types";

export type {
  CrawlSupportStatus,
  SupportBucket,
  SupportCrawl,
  CrawlSupportData,
} from "./crawl-support-types";
export {
  STATUS_LABEL,
  STATUS_TONE,
  computeCrawlStatus,
  inActivationWindow,
} from "./crawl-support-types";

const HOUR = 60 * 60_000;

function localClock(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

/**
 * Load crawls relevant to live support: from ~yesterday forward (so the
 * activation window + completed-lookback are covered), with computed status +
 * buckets. Optionally scoped to a campaign.
 */
export async function loadCrawlSupport(opts?: {
  campaignId?: string | null;
  now?: Date;
}): Promise<CrawlSupportData> {
  const now = opts?.now ?? new Date();
  const fromDate = new Date(now.getTime() - 36 * HOUR).toISOString().slice(0, 10);
  const toDate = new Date(now.getTime() + 14 * 24 * HOUR).toISOString().slice(0, 10);

  const rows = await db
    .select({
      eventId: events.id,
      eventDate: events.eventDate,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      ticketSalesCount: events.ticketSalesCount,
      cityName: cities.name,
      timezone: cities.timezone,
      campaignName: campaigns.name,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(
      and(
        gte(events.eventDate, fromDate),
        lte(events.eventDate, toDate),
        isNull(events.archivedAt),
        opts?.campaignId ? eq(cityCampaigns.campaignId, opts.campaignId) : undefined,
      ),
    )
    .orderBy(events.startsAt);

  const counts: Record<SupportBucket, number> = {
    active: 0,
    starting_soon: 0,
    completed: 0,
    scheduled: 0,
  };

  const crawls: SupportCrawl[] = rows.map((r) => {
    const startsAt = r.startsAt ? new Date(r.startsAt) : null;
    const endsAt = r.endsAt ? new Date(r.endsAt) : null;
    const status = computeCrawlStatus(now, startsAt, endsAt);
    const bucket = bucketFor(status, now, endsAt);
    counts[bucket] += 1;
    const tz = r.timezone || "America/New_York";
    return {
      eventId: r.eventId,
      campaignName: r.campaignName,
      cityName: r.cityName,
      timezone: tz,
      dayPart: r.dayPart ?? null,
      crawlNumber: r.crawlNumber ?? null,
      eventDate: String(r.eventDate),
      status,
      bucket,
      startsAtIso: startsAt ? startsAt.toISOString() : null,
      endsAtIso: endsAt ? endsAt.toISOString() : null,
      startLocal: startsAt ? localClock(tz, startsAt) : null,
      endLocal: endsAt ? localClock(tz, endsAt) : null,
      ticketSalesCount: r.ticketSalesCount ?? 0,
      timesMissing: !startsAt || !endsAt,
    };
  });

  return { nowIso: now.toISOString(), crawls, counts };
}

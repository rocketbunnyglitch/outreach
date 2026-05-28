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

import {
  events,
  callLogs,
  campaigns,
  cities,
  cityCampaigns,
  crawlHosts,
  crawlIssues,
  externalHosts,
  internalHosts,
  staffMembers,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  type CallDirection,
  type CallMatchType,
  type CrawlIssueSeverity,
  type CrawlIssueStatus,
  type CrawlIssueType,
  type CrawlSupportData,
  type SupportBucket,
  type SupportCall,
  type SupportCrawl,
  type SupportIssue,
  bucketFor,
  computeCrawlStatus,
  computeSupportRisk,
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

  // --- Enrichment (batched by eventId; avoids row-fan-out on the main query) ---
  const eventIds = rows.map((r) => r.eventId);
  type RoleAgg = {
    wristbandVenue: string | null;
    middleVenues: string[];
    finalVenue: string | null;
    wristbandStatus: SupportCrawl["wristbandStatus"];
  };
  const roleByEvent = new Map<string, RoleAgg>();
  const hostsByEvent = new Map<string, SupportCrawl["hosts"]>();

  if (eventIds.length > 0) {
    const CONFIRMED = ["confirmed", "contract_signed"];
    const veRows = await db
      .select({
        eventId: venueEvents.eventId,
        role: venueEvents.role,
        status: venueEvents.status,
        venueName: venues.name,
        wristbandStatus: wristbands.status,
      })
      .from(venueEvents)
      .innerJoin(venues, eq(venues.id, venueEvents.venueId))
      .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
      .where(inArray(venueEvents.eventId, eventIds));

    for (const v of veRows) {
      let agg = roleByEvent.get(v.eventId);
      if (!agg) {
        agg = { wristbandVenue: null, middleVenues: [], finalVenue: null, wristbandStatus: null };
        roleByEvent.set(v.eventId, agg);
      }
      // Wristband shipping status rides on the wristband-role venue_event.
      if (v.role === "wristband" && v.wristbandStatus) agg.wristbandStatus = v.wristbandStatus;
      if (!CONFIRMED.includes(v.status)) continue;
      if (v.role === "wristband") agg.wristbandVenue ??= v.venueName;
      else if (v.role === "middle") agg.middleVenues.push(v.venueName);
      else if (v.role === "final" || v.role === "alt_final") agg.finalVenue ??= v.venueName;
    }

    const hostRows = await db
      .select({
        eventId: crawlHosts.eventId,
        hostType: crawlHosts.hostType,
        slot: crawlHosts.slot,
        internalName: internalHosts.name,
        externalName: externalHosts.fullName,
      })
      .from(crawlHosts)
      .leftJoin(internalHosts, eq(internalHosts.id, crawlHosts.internalHostId))
      .leftJoin(externalHosts, eq(externalHosts.id, crawlHosts.externalHostId))
      .where(inArray(crawlHosts.eventId, eventIds));

    for (const h of hostRows) {
      const list = hostsByEvent.get(h.eventId) ?? [];
      list.push({
        type: h.hostType,
        name: h.internalName ?? h.externalName ?? "Unnamed host",
        slot: h.slot ?? 1,
      });
      hostsByEvent.set(h.eventId, list);
    }
  }

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
    const timesMissing = !startsAt || !endsAt;
    const role = roleByEvent.get(r.eventId);
    const hosts = (hostsByEvent.get(r.eventId) ?? []).sort((a, b) => a.slot - b.slot);
    const wristbandVenue = role?.wristbandVenue ?? null;
    const middleVenues = role?.middleVenues ?? [];
    const finalVenue = role?.finalVenue ?? null;
    const wristbandStatus = role?.wristbandStatus ?? null;
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
      timesMissing,
      wristbandVenue,
      middleVenues,
      finalVenue,
      wristbandStatus,
      hosts,
      supportRisk: computeSupportRisk({
        status,
        timesMissing,
        wristbandVenue,
        finalVenue,
        hosts,
        wristbandStatus,
      }),
    };
  });

  return { nowIso: now.toISOString(), crawls, counts };
}

const DAY_SHORT: Record<string, string> = {
  thursday_night: "Thu Night",
  friday_night: "Fri Night",
  saturday_day: "Sat Day",
  saturday_night: "Sat Night",
  sunday_night: "Sun Night",
};

/**
 * Load recent crawl issues (newest first). Guarded: the crawl_issues table may
 * not be migrated yet, in which case we log and return [] so /crawl-support
 * still renders.
 */
export async function loadCrawlIssues(opts?: { limit?: number }): Promise<SupportIssue[]> {
  try {
    const rows = await db
      .select({
        id: crawlIssues.id,
        issueType: crawlIssues.issueType,
        severity: crawlIssues.severity,
        status: crawlIssues.status,
        callerContact: crawlIssues.callerContact,
        notes: crawlIssues.notes,
        createdAt: crawlIssues.createdAt,
        resolvedAt: crawlIssues.resolvedAt,
        dayPart: events.dayPart,
        crawlNumber: events.crawlNumber,
        cityName: cities.name,
        campaignName: campaigns.name,
        venueName: venues.name,
        assignedName: staffMembers.displayName,
      })
      .from(crawlIssues)
      .leftJoin(events, eq(events.id, crawlIssues.eventId))
      .leftJoin(cityCampaigns, eq(cityCampaigns.id, crawlIssues.cityCampaignId))
      .leftJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .leftJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .leftJoin(venues, eq(venues.id, crawlIssues.venueId))
      .leftJoin(staffMembers, eq(staffMembers.id, crawlIssues.assignedStaffId))
      .orderBy(desc(crawlIssues.createdAt))
      .limit(opts?.limit ?? 100);

    return rows.map((r) => ({
      id: r.id,
      issueType: r.issueType as CrawlIssueType,
      severity: r.severity as CrawlIssueSeverity,
      status: r.status as CrawlIssueStatus,
      cityName: r.cityName ?? null,
      campaignName: r.campaignName ?? null,
      crawlLabel: r.dayPart
        ? `${DAY_SHORT[r.dayPart] ?? r.dayPart}${r.crawlNumber ? ` #${r.crawlNumber}` : ""}`
        : null,
      venueName: r.venueName ?? null,
      callerContact: r.callerContact ?? null,
      assignedStaffName: r.assignedName ?? null,
      notes: r.notes ?? null,
      createdAtIso: (r.createdAt instanceof Date
        ? r.createdAt
        : new Date(r.createdAt)
      ).toISOString(),
      resolvedAtIso: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
    }));
  } catch (err) {
    logger.warn({ err }, "loadCrawlIssues failed (crawl_issues table may not be migrated yet)");
    return [];
  }
}

export interface SupportStaffOption {
  id: string;
  name: string;
}

/** Active staff for the assignee picker. Guarded (never crashes the page). */
export async function loadSupportStaff(): Promise<SupportStaffOption[]> {
  try {
    return await db
      .select({ id: staffMembers.id, name: staffMembers.displayName })
      .from(staffMembers)
      .where(eq(staffMembers.status, "active"))
      .orderBy(staffMembers.displayName);
  } catch (err) {
    logger.warn({ err }, "loadSupportStaff failed");
    return [];
  }
}

/**
 * Recent inbound calls for the support tab (matched or not). Guarded: returns
 * [] if call_logs isn't migrated yet so /crawl-support still renders.
 */
export async function loadRecentCalls(opts?: { limit?: number }): Promise<SupportCall[]> {
  try {
    const rows = await db
      .select({
        id: callLogs.id,
        direction: callLogs.direction,
        fromE164: callLogs.fromE164,
        toE164: callLogs.toE164,
        callerName: callLogs.callerName,
        status: callLogs.status,
        durationSeconds: callLogs.durationSeconds,
        recordingUrl: callLogs.recordingUrl,
        occurredAt: callLogs.occurredAt,
        matchType: callLogs.matchType,
        areaCode: callLogs.areaCode,
        venueName: venues.name,
        staffName: staffMembers.displayName,
      })
      .from(callLogs)
      .leftJoin(venues, eq(venues.id, callLogs.matchedVenueId))
      .leftJoin(staffMembers, eq(staffMembers.id, callLogs.matchedStaffId))
      .where(eq(callLogs.direction, "incoming"))
      .orderBy(desc(callLogs.occurredAt))
      .limit(opts?.limit ?? 50);

    return rows.map((r) => ({
      id: r.id,
      direction: r.direction as CallDirection,
      fromE164: r.fromE164 ?? null,
      toE164: r.toE164 ?? null,
      callerName: r.callerName ?? null,
      status: r.status ?? null,
      durationSeconds: r.durationSeconds ?? null,
      recordingUrl: r.recordingUrl ?? null,
      occurredAtIso: (r.occurredAt instanceof Date
        ? r.occurredAt
        : new Date(r.occurredAt)
      ).toISOString(),
      matchType: r.matchType as CallMatchType,
      matchedVenueName: r.venueName ?? null,
      matchedStaffName: r.staffName ?? null,
      areaCode: r.areaCode ?? null,
    }));
  } catch (err) {
    logger.warn({ err }, "loadRecentCalls failed (call_logs table may not be migrated yet)");
    return [];
  }
}

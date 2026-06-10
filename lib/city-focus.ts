import "server-only";

/**
 * Daily cold-outreach city focus for the worklist (operator request
 * 2026-06-10): staff should max out their daily cold sends on their TOP TWO
 * assigned cities by priority, and once a city has 30+ contacted venues,
 * move on to the next assigned city. This loader computes that guidance from
 * real data; the worklist renders it as the first card so staff always know
 * which cities to work.
 *
 * "Contacted" = cold_outreach_entries.status <> 'not_contacted' (any touch
 * counts -- emailed, called, interested, declined all mean the venue has
 * been worked).
 */

import { cities, cityCampaigns, coldOutreachEntries, connectedAccounts } from "@/db/schema";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loadSendUsage } from "@/lib/send-cap";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";

/** Contacts per city before staff should move to the next one. */
export const CITY_CONTACTED_TARGET = 30;

export interface CityFocusRow {
  cityCampaignId: string;
  cityName: string;
  priority: number;
  contacted: number;
  target: number;
}

export interface CityFocus {
  /** Up to 2 cities to work today (assigned, under target, by priority). */
  focus: CityFocusRow[];
  /** Assigned cities already at/over the target (for the "done" line). */
  atTarget: number;
  /** Total cities assigned to this staffer in the current campaign. */
  assignedTotal: number;
  /** Cold sends still available today across the staffer's own inboxes. */
  remainingSendsToday: number;
}

export async function loadCityFocus(opts: { staffId: string }): Promise<CityFocus> {
  const empty: CityFocus = { focus: [], atTarget: 0, assignedTotal: 0, remainingSendsToday: 0 };
  try {
    const current = await getCurrentCampaign();
    if (!current) return empty;

    const assigned = await db
      .select({
        cityCampaignId: cityCampaigns.id,
        cityName: cities.name,
        priority: cityCampaigns.priority,
      })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(
        and(
          eq(cityCampaigns.campaignId, current.campaign.id),
          eq(cityCampaigns.leadStaffId, opts.staffId),
          ne(cityCampaigns.status, "cancelled"),
        ),
      )
      .orderBy(asc(cityCampaigns.priority), asc(cities.name));
    if (assigned.length === 0) return empty;

    const ccIds = assigned.map((a) => a.cityCampaignId);
    const counts = await db
      .select({ cityCampaignId: coldOutreachEntries.cityCampaignId, contacted: count() })
      .from(coldOutreachEntries)
      .where(
        and(
          inArray(coldOutreachEntries.cityCampaignId, ccIds),
          isNull(coldOutreachEntries.archivedAt),
          ne(coldOutreachEntries.status, "not_contacted"),
        ),
      )
      .groupBy(coldOutreachEntries.cityCampaignId);
    const contactedBy = new Map(counts.map((c) => [c.cityCampaignId, Number(c.contacted)]));

    const rows: CityFocusRow[] = assigned.map((a) => ({
      cityCampaignId: a.cityCampaignId,
      cityName: a.cityName,
      priority: a.priority,
      contacted: contactedBy.get(a.cityCampaignId) ?? 0,
      target: CITY_CONTACTED_TARGET,
    }));
    const underTarget = rows.filter((r) => r.contacted < CITY_CONTACTED_TARGET);

    // Remaining cold-send capacity today across the staffer's own inboxes
    // (cap engine is warmup-aware). Best-effort -- 0 on any failure.
    let remainingSendsToday = 0;
    try {
      const inboxes = await db
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.ownerUserId, opts.staffId),
            eq(connectedAccounts.status, "connected"),
            eq(connectedAccounts.coldSendsPaused, false),
          ),
        );
      for (const inbox of inboxes) {
        const usage = await loadSendUsage(inbox.id);
        remainingSendsToday += Math.max(0, usage.remaining);
      }
    } catch (err) {
      logger.warn({ err, staffId: opts.staffId }, "city-focus: send usage lookup skipped");
    }

    return {
      focus: underTarget.slice(0, 2),
      atTarget: rows.length - underTarget.length,
      assignedTotal: rows.length,
      remainingSendsToday,
    };
  } catch (err) {
    logger.error({ err, staffId: opts.staffId }, "loadCityFocus failed");
    return empty;
  }
}

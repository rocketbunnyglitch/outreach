import "server-only";

/**
 * Per-user rollups for the dashboard footer cards (operator request
 * 2026-06-10):
 *   1. confirmed venues each user is responsible for (venue_events in the
 *      confirmed family, attributed via our_contact_staff_id = "Scheduled
 *      by" on the crawl tables);
 *   2. non-completed cities per user (assigned cities still in
 *      planning/active);
 *   3. every user's full city list with priority + tickets sold.
 * One loader so the dashboard adds a single parallel call.
 */

import { events, cities, cityCampaigns, staffMembers, venueEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, count, eq, inArray } from "drizzle-orm";

export interface UserCityRow {
  cityCampaignId: string;
  cityName: string;
  priority: number;
  ticketsSold: number;
  status: string;
}

export interface TeamMemberSummary {
  staffId: string;
  displayName: string;
  confirmedVenues: number;
  openCities: number;
  cities: UserCityRow[];
}

export async function loadTeamCitySummary(campaignId: string): Promise<TeamMemberSummary[]> {
  try {
    const staff = await db
      .select({ id: staffMembers.id, displayName: staffMembers.displayName })
      .from(staffMembers)
      .where(eq(staffMembers.status, "active"))
      .orderBy(asc(staffMembers.displayName));
    if (staff.length === 0) return [];

    // Confirmed venues per responsible staffer (current campaign only).
    const confirmed = await db
      .select({ staffId: venueEvents.ourContactStaffId, n: count() })
      .from(venueEvents)
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .where(
        and(
          eq(cityCampaigns.campaignId, campaignId),
          inArray(venueEvents.status, ["confirmed", "scheduled", "contract_signed"]),
        ),
      )
      .groupBy(venueEvents.ourContactStaffId);
    const confirmedBy = new Map(confirmed.map((c) => [c.staffId, Number(c.n)]));

    // Tickets sold per city (sum over its events).
    const sales = await db
      .select({ cityCampaignId: events.cityCampaignId, sold: events.ticketSalesCount })
      .from(events)
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .where(eq(cityCampaigns.campaignId, campaignId));
    const soldBy = new Map<string, number>();
    for (const s of sales) {
      soldBy.set(s.cityCampaignId, (soldBy.get(s.cityCampaignId) ?? 0) + (s.sold ?? 0));
    }

    const assigned = await db
      .select({
        cityCampaignId: cityCampaigns.id,
        cityName: cities.name,
        priority: cityCampaigns.priority,
        status: cityCampaigns.status,
        leadStaffId: cityCampaigns.leadStaffId,
      })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(eq(cityCampaigns.campaignId, campaignId))
      .orderBy(asc(cityCampaigns.priority), asc(cities.name));

    return staff.map((s) => {
      const mine = assigned
        .filter((a) => a.leadStaffId === s.id)
        .map((a) => ({
          cityCampaignId: a.cityCampaignId,
          cityName: a.cityName,
          priority: a.priority,
          ticketsSold: soldBy.get(a.cityCampaignId) ?? 0,
          status: String(a.status),
        }));
      return {
        staffId: s.id,
        displayName: s.displayName,
        confirmedVenues: confirmedBy.get(s.id) ?? 0,
        openCities: mine.filter((c) => c.status === "planning" || c.status === "active").length,
        cities: mine,
      };
    });
  } catch (err) {
    logger.error({ err, campaignId }, "loadTeamCitySummary failed");
    return [];
  }
}

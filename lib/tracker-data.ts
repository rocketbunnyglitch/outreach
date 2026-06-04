import "server-only";

/**
 * Tracker dashboard data loader. Returns rows formatted for
 * TrackerDashboardTable.
 *
 * Scoped to a single campaign: this is the per-campaign view the
 * operator gets when they select a campaign from the switcher. The
 * Admin dashboard uses a different loader.
 *
 * One query per table, joined in JS at the end. Order: priority asc,
 * city name asc.
 */

import type { TrackerRow } from "@/app/(admin)/_components/dashboard/tracker-dashboard-table";
import { cities, cityCampaigns, staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { computeCityNeeds } from "@/lib/tracker-status";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

export async function loadTrackerData(opts: { campaignId: string }): Promise<{
  rows: TrackerRow[];
  staff: Array<{ id: string; displayName: string }>;
}> {
  // city_campaigns in this campaign + their cities
  const ccRows = await db
    .select({
      cityCampaignId: cityCampaigns.id,
      cityId: cities.id,
      cityName: cities.name,
      // 3-letter ISO country code rendered as a quiet badge next
      // to the city name to disambiguate "London CAN" vs "London
      // GBR" — operator feedback (screenshot).
      cityCountryCode: cities.countryCode,
      cityTimezone: cities.timezone,
      priority: cityCampaigns.priority,
      status: cityCampaigns.status,
      leadStaffId: cityCampaigns.leadStaffId,
      dashboardNote: cityCampaigns.dashboardNote,
      goalCents: cityCampaigns.salesGoalCents,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(and(eq(cityCampaigns.campaignId, opts.campaignId), isNull(cities.archivedAt)))
    .orderBy(asc(cityCampaigns.priority), asc(cities.name));

  const cityCampaignIds = ccRows.map((r) => r.cityCampaignId);
  const statusMap = Object.fromEntries(ccRows.map((r) => [r.cityCampaignId, r.status]));

  // Sales totals — placeholder until Eventbrite is wired. tickets * $30 (cents).
  let salesMap: Record<string, number> = {};
  if (cityCampaignIds.length > 0) {
    const salesRows = await db.execute<{
      city_campaign_id: string;
      tickets: number;
    }>(sql`
      SELECT city_campaign_id, coalesce(sum(ticket_sales_count), 0)::int AS tickets
      FROM events
      WHERE city_campaign_id = ANY(${sql.raw(`ARRAY[${cityCampaignIds.map((id) => `'${id}'::uuid`).join(",")}]`)})
        AND archived_at IS NULL
      GROUP BY city_campaign_id
    `);
    const rows: Array<{ city_campaign_id: string; tickets: number }> = Array.isArray(salesRows)
      ? (salesRows as unknown as Array<{ city_campaign_id: string; tickets: number }>)
      : ((salesRows as unknown as { rows: Array<{ city_campaign_id: string; tickets: number }> })
          .rows ?? []);
    salesMap = Object.fromEntries(rows.map((r) => [r.city_campaign_id, Number(r.tickets) * 3000])); // tickets * $30 (cents)
  }

  // Slot needs
  const needs = await computeCityNeeds(cityCampaignIds, statusMap);

  // Staff list for assign dropdown
  const staff = await db
    .select({ id: staffMembers.id, displayName: staffMembers.displayName })
    .from(staffMembers)
    .where(eq(staffMembers.status, "active"))
    .orderBy(asc(staffMembers.displayName));

  const rows: TrackerRow[] = ccRows.map((r) => ({
    cityCampaignId: r.cityCampaignId,
    cityId: r.cityId,
    cityName: r.cityName,
    countryCode: r.cityCountryCode ?? null,
    cityTimezone: r.cityTimezone ?? "America/Toronto",
    priority: r.priority ?? 5,
    totalSalesCents: salesMap[r.cityCampaignId] ?? 0,
    status: (r.status as TrackerRow["status"]) ?? "planning",
    leadStaffId: r.leadStaffId,
    dashboardNote: r.dashboardNote,
    need: needs.get(r.cityCampaignId) ?? {
      cityCampaignId: r.cityCampaignId,
      statusPill: "outreach",
      openSlotCount: 0,
      slots: [],
      crawlBreakdown: [],
    },
  }));

  return { rows, staff };
}

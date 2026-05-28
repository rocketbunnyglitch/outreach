/**
 * /admin/goals — ADMIN-ONLY ticket-sales-count target editor.
 *
 * Operator session 11 decision #025:
 *   "Admin goal = target_ticket_sales_count (count, /admin/goals only)"
 *
 * One row per non-archived campaign. Each row shows:
 *   - Campaign name + status
 *   - The CURRENT ticket-sales count (sum of events.ticket_sales_count
 *     across the campaign's events)
 *   - An editable input for target_ticket_sales_count
 *
 * Why this UI shape
 * -----------------
 * Bulk-editable list rather than per-campaign detail. The admin
 * typically sets all targets at the START of a campaign cycle in
 * one sitting, then updates as the year progresses. A single page
 * with N rows beats N navigation hops.
 *
 * Why admin-only
 * --------------
 * #025 explicitly separates outreach goals (cities + priority,
 * operational) from admin goals (tickets, financial). Outreach
 * staff don't see this page — requireAdmin() throws if non-admin.
 */

import { events, campaignStatus, campaigns, cityCampaigns } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, isNull, sql } from "drizzle-orm";
import { ChevronLeft, Target } from "lucide-react";
import Link from "next/link";
import { updateCampaignTicketSalesGoal } from "./_actions";
import { GoalRow } from "./_components/goal-row";

export const metadata = { title: "Goals · Crawl Engine" };
export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  await requireAdmin();

  // Pull every non-archived campaign + sum of current ticket sales
  // across that campaign's events (joined via city_campaigns).
  //
  // SQL note: events.city_campaign_id → city_campaigns.id →
  // city_campaigns.campaign_id → campaigns.id. Sum via correlated
  // sub-select rather than a GROUP BY because GROUP BY would force
  // us to aggregate all campaign columns; the sub-select is the
  // simpler shape for v1 even if marginally more DB work.
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      targetTicketSalesCount: campaigns.targetTicketSalesCount,
      currentTicketSalesCount: sql<number>`(
        SELECT COALESCE(SUM(e.ticket_sales_count), 0)::int
        FROM ${events} e
        INNER JOIN ${cityCampaigns} cc ON cc.id = e.city_campaign_id
        WHERE cc.campaign_id = ${campaigns.id}
      )`.as("current_ticket_sales_count"),
    })
    .from(campaigns)
    .where(isNull(campaigns.archivedAt))
    .orderBy(asc(campaigns.startDate), asc(campaigns.name));

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> Admin
        </Link>
        <div className="mt-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-zinc-500" />
          <h1 className="font-semibold text-3xl tracking-tight">Goals</h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500">
          Ticket-sales targets per campaign. Admin-only. Outreach staff see operational goals
          (target cities, max priority) on the regular campaign edit form.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-md border border-zinc-300 border-dashed bg-zinc-50/40 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/30">
          No active campaigns. Create one first.
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200/80 border-b font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] dark:border-zinc-800/60">
                <th className="px-4 py-2.5 text-left">Campaign</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-right">Current</th>
                <th className="px-4 py-2.5 text-right">Target</th>
                <th className="px-4 py-2.5 text-right">Progress</th>
                <th className="w-24 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <GoalRow
                  key={r.id}
                  campaignId={r.id}
                  name={r.name}
                  status={r.status}
                  startDate={r.startDate}
                  endDate={r.endDate}
                  current={r.currentTicketSalesCount ?? 0}
                  target={r.targetTicketSalesCount}
                  action={updateCampaignTicketSalesGoal}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Silence unused-import warning — campaignStatus enum is imported for
// the type guard inside GoalRow but not directly referenced here.
void campaignStatus;

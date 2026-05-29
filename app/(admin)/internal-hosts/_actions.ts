"use server";

/**
 * Internal hosts CRUD. Lightweight payroll list for team members paid
 * hourly to run crawls. Operator session-12 P3.
 *
 * The TOTAL (rate × hours) is computed in the loader, never stored.
 */

import { internalHosts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const paymentMethodEnum = z.enum(["venmo", "bank", "interac", "zelle", "paypal", "wise"]);

export interface InternalHostRow {
  id: string;
  name: string;
  payRateCents: number;
  hoursWorked: number;
  currency: string;
  paymentMethod: string | null;
  paymentDetails: string | null;
  notes: string | null;
  /** Derived: payRateCents × hoursWorked, rounded to whole cents. */
  totalCents: number;
}

export async function loadInternalHosts(): Promise<InternalHostRow[]> {
  await requireStaff();
  const rows = await db
    .select()
    .from(internalHosts)
    .where(isNull(internalHosts.archivedAt))
    .orderBy(asc(internalHosts.name));

  return rows.map((r) => {
    const hours = Number(r.hoursWorked ?? 0);
    const rate = r.payRateCents ?? 0;
    return {
      id: r.id,
      name: r.name,
      payRateCents: rate,
      hoursWorked: hours,
      currency: r.currency,
      paymentMethod: r.paymentMethod,
      paymentDetails: r.paymentDetails,
      notes: r.notes,
      totalCents: Math.round(rate * hours),
    };
  });
}

const upsertSchema = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(160),
  /** Hourly rate in dollars (UI sends dollars; we store cents). */
  payRate: z.coerce.number().min(0).max(100000),
  hoursWorked: z.coerce.number().min(0).max(10000),
  currency: z.string().min(1).max(8).default("CAD"),
  paymentMethod: z.union([paymentMethodEnum, z.literal("")]).optional(),
  paymentDetails: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
});

export async function upsertInternalHost(
  input: z.infer<typeof upsertSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid host details." };
  const d = parsed.data;

  const values = {
    name: d.name.trim(),
    payRateCents: Math.round(d.payRate * 100),
    hoursWorked: String(d.hoursWorked),
    currency: d.currency.trim().toUpperCase() || "CAD",
    paymentMethod: d.paymentMethod ? d.paymentMethod : null,
    paymentDetails: d.paymentDetails?.trim() || null,
    notes: d.notes?.trim() || null,
    updatedBy: staff.id,
  };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      if (d.id) {
        await tx.update(internalHosts).set(values).where(eq(internalHosts.id, d.id));
        return d.id;
      }
      const [row] = await tx
        .insert(internalHosts)
        .values({ ...values, createdBy: staff.id })
        .returning({ id: internalHosts.id });
      return row?.id ?? "";
    });
    revalidatePath("/internal-hosts");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "upsertInternalHost failed");
    return { ok: false, error: "Couldn't save the host." };
  }
}

export async function archiveInternalHost(input: { id: string }): Promise<
  ActionResult<{ id: string }>
> {
  const { staff } = await requireStaff();
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid host id." };

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(internalHosts)
        .set({ archivedAt: new Date(), updatedBy: staff.id })
        .where(eq(internalHosts.id, parsed.data.id)),
    );
    revalidatePath("/internal-hosts");
    return { ok: true, data: { id: parsed.data.id } };
  } catch (err) {
    logger.error({ err }, "archiveInternalHost failed");
    return { ok: false, error: "Couldn't remove the host." };
  }
}

// =========================================================================
// loadInternalHostFlaggedCrawls — crawls marked as internal-host but
// with incomplete capture (missing name / hours / rate)
// =========================================================================

/**
 * Returns every crawl currently flagged as host_type='internal' on its
 * slot-1 row. Surfaces what still needs the operator's attention by
 * highlighting which of {name, hours, rate} are still null.
 *
 * The flow operators want here:
 *   1. Mark "Internal" on a crawl right when the venue is booked.
 *   2. Come back later (often after the night-of) to fill in who
 *      actually worked, how many hours, and the payout rate.
 *
 * This loader powers the second section on /internal-hosts so the
 * operator can see the whole queue of crawls awaiting those details.
 */
export interface FlaggedInternalCrawl {
  crawlHostId: string;
  eventId: string;
  cityCampaignId: string;
  cityName: string;
  eventDate: string | null;
  dayPart: string;
  crawlNumber: number | null;
  internalHostName: string | null;
  internalHostHours: string | null;
  internalHostRateCents: number | null;
  needsName: boolean;
  needsHours: boolean;
  needsRate: boolean;
}

export async function loadInternalHostFlaggedCrawls(): Promise<FlaggedInternalCrawl[]> {
  await requireStaff();
  const rows = await db.execute<{
    crawl_host_id: string;
    event_id: string;
    city_campaign_id: string;
    city_name: string;
    event_date: string | null;
    day_part: string;
    crawl_number: number | null;
    internal_host_name: string | null;
    internal_host_hours: string | null;
    internal_host_rate_cents: number | null;
  }>(sql`
    SELECT
      ch.id::text AS crawl_host_id,
      e.id::text AS event_id,
      cc.id::text AS city_campaign_id,
      c.name AS city_name,
      e.event_date::text AS event_date,
      e.day_part::text AS day_part,
      e.crawl_number AS crawl_number,
      ch.internal_host_name,
      ch.internal_host_hours::text AS internal_host_hours,
      ch.internal_host_rate_cents
    FROM crawl_hosts ch
    JOIN events e ON e.id = ch.event_id
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    JOIN cities c ON c.id = cc.city_id
    WHERE ch.host_type = 'internal'
      AND ch.slot = 1
    ORDER BY e.event_date DESC NULLS LAST, c.name ASC
  `);

  type Row = {
    crawl_host_id: string;
    event_id: string;
    city_campaign_id: string;
    city_name: string;
    event_date: string | null;
    day_part: string;
    crawl_number: number | null;
    internal_host_name: string | null;
    internal_host_hours: string | null;
    internal_host_rate_cents: number | null;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => ({
    crawlHostId: r.crawl_host_id,
    eventId: r.event_id,
    cityCampaignId: r.city_campaign_id,
    cityName: r.city_name,
    eventDate: r.event_date,
    dayPart: r.day_part,
    crawlNumber: r.crawl_number,
    internalHostName: r.internal_host_name,
    internalHostHours: r.internal_host_hours,
    internalHostRateCents: r.internal_host_rate_cents,
    needsName: r.internal_host_name == null || r.internal_host_name.trim() === "",
    needsHours: r.internal_host_hours == null,
    needsRate: r.internal_host_rate_cents == null,
  }));
}

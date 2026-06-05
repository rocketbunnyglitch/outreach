"use server";

/**
 * External hosts CRUD. Contractors paid to host crawls — fuller contact
 * + address + payment-contact than internal hosts. Operator session-12 P3.
 */

import { events, campaigns, cities, cityCampaigns, crawlHosts, externalHosts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { scheduleHostBriefings } from "@/lib/host-briefing";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const paymentMethodEnum = z.enum(["venmo", "bank", "interac", "zelle", "paypal", "wise"]);

export interface ExternalHostRow {
  id: string;
  fullName: string;
  email: string | null;
  phoneE164: string | null;
  payRateCents: number;
  currency: string;
  address: string | null;
  paymentMethod: string | null;
  paymentContact: string | null;
  notes: string | null;
}

export async function loadExternalHosts(): Promise<ExternalHostRow[]> {
  await requireStaff();
  const rows = await db
    .select()
    .from(externalHosts)
    .where(isNull(externalHosts.archivedAt))
    .orderBy(asc(externalHosts.fullName));

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    phoneE164: r.phoneE164,
    payRateCents: r.payRateCents ?? 0,
    currency: r.currency,
    address: r.address,
    paymentMethod: r.paymentMethod,
    paymentContact: r.paymentContact,
    notes: r.notes,
  }));
}

const upsertSchema = z.object({
  id: uuid.optional(),
  fullName: z.string().min(1).max(200),
  email: z.string().max(200).optional(),
  phoneE164: z.string().max(40).optional(),
  /** Hourly rate in dollars (UI sends dollars; stored as cents). */
  payRate: z.coerce.number().min(0).max(100000),
  currency: z.string().min(1).max(8).default("USD"),
  address: z.string().max(500).optional(),
  paymentMethod: z.union([paymentMethodEnum, z.literal("")]).optional(),
  paymentContact: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
});

export async function upsertExternalHost(
  input: z.infer<typeof upsertSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid host details." };
  const d = parsed.data;

  // Light email sanity check when provided (don't block on edge formats).
  if (d.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    return { ok: false, error: "Email format looks off." };
  }

  const values = {
    fullName: d.fullName.trim(),
    email: d.email?.trim() || null,
    phoneE164: d.phoneE164?.trim() || null,
    payRateCents: Math.round(d.payRate * 100),
    currency: d.currency.trim().toUpperCase() || "USD",
    address: d.address?.trim() || null,
    paymentMethod: d.paymentMethod ? d.paymentMethod : null,
    paymentContact: d.paymentContact?.trim() || null,
    notes: d.notes?.trim() || null,
    updatedBy: staff.id,
  };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      if (d.id) {
        await tx.update(externalHosts).set(values).where(eq(externalHosts.id, d.id));
        return d.id;
      }
      const [row] = await tx
        .insert(externalHosts)
        .values({ ...values, createdBy: staff.id })
        .returning({ id: externalHosts.id });
      return row?.id ?? "";
    });
    revalidatePath("/external-hosts");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "upsertExternalHost failed");
    return { ok: false, error: "Couldn't save the host." };
  }
}

export async function archiveExternalHost(input: { id: string }): Promise<
  ActionResult<{ id: string }>
> {
  const { staff } = await requireStaff();
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid host id." };

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(externalHosts)
        .set({ archivedAt: new Date(), updatedBy: staff.id })
        .where(eq(externalHosts.id, parsed.data.id)),
    );
    revalidatePath("/external-hosts");
    return { ok: true, data: { id: parsed.data.id } };
  } catch (err) {
    logger.error({ err }, "archiveExternalHost failed");
    return { ok: false, error: "Couldn't remove the host." };
  }
}

export interface PendingExternalCrawl {
  crawlHostId: string;
  eventId: string;
  cityCampaignId: string;
  cityName: string;
  campaignName: string;
  eventDate: string;
  dayPart: string | null;
  crawlNumber: number | null;
}

/**
 * Crawls whose slot-1 host is marked external but not yet assigned to anyone
 * (external_host_id IS NULL). These are what the operator needs to staff.
 */
export async function loadCrawlsNeedingExternalHost(): Promise<PendingExternalCrawl[]> {
  await requireStaff();
  try {
    const rows = await db
      .select({
        crawlHostId: crawlHosts.id,
        eventId: events.id,
        cityCampaignId: cityCampaigns.id,
        cityName: cities.name,
        campaignName: campaigns.name,
        eventDate: events.eventDate,
        dayPart: events.dayPart,
        crawlNumber: events.crawlNumber,
      })
      .from(crawlHosts)
      .innerJoin(events, eq(events.id, crawlHosts.eventId))
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(and(eq(crawlHosts.hostType, "external"), isNull(crawlHosts.externalHostId)))
      .orderBy(asc(events.eventDate));
    return rows.map((r) => ({
      crawlHostId: r.crawlHostId,
      eventId: r.eventId,
      cityCampaignId: r.cityCampaignId,
      cityName: r.cityName,
      campaignName: r.campaignName,
      eventDate: String(r.eventDate),
      dayPart: r.dayPart,
      crawlNumber: r.crawlNumber,
    }));
  } catch (err) {
    logger.error({ err }, "loadCrawlsNeedingExternalHost failed");
    return [];
  }
}

const assignCrawlSchema = z.object({ crawlHostId: uuid, externalHostId: uuid });

/** Assign an external host to a pending crawl (sets external_host_id). */
export async function assignExternalHostToCrawl(
  input: z.infer<typeof assignCrawlSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = assignCrawlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { crawlHostId, externalHostId } = parsed.data;
  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(crawlHosts)
        .set({ externalHostId, updatedBy: staff.id })
        .where(and(eq(crawlHosts.id, crawlHostId), eq(crawlHosts.hostType, "external"))),
    );

    // Phase 3.6/3.7: draft the host briefings (H0a now, H0b for event week).
    // Best-effort + outside the tx so a drafting hiccup never blocks the assign.
    try {
      const briefings = await scheduleHostBriefings({
        crawlHostId,
        externalHostId,
        staffId: staff.id,
        teamId: staff.teamId,
      });
      logger.info({ crawlHostId, ...briefings }, "host briefings drafted on assign");
    } catch (briefingErr) {
      logger.error(
        { err: briefingErr, crawlHostId },
        "host briefing drafting failed (assignment committed anyway)",
      );
    }

    revalidatePath("/external-hosts");
    revalidatePath("/worklist");
    return { ok: true, data: { id: crawlHostId } };
  } catch (err) {
    logger.error({ err, crawlHostId }, "assignExternalHostToCrawl failed");
    return { ok: false, error: "Couldn't assign the host." };
  }
}

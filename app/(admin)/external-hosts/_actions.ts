"use server";

/**
 * External hosts CRUD. Contractors paid to host crawls — fuller contact
 * + address + payment-contact than internal hosts. Operator session-12 P3.
 */

import { externalHosts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { asc, eq, isNull } from "drizzle-orm";
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

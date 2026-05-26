"use server";

import { outreachBrands, outreachLog, staffMembers, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type OutreachLogCreateInput,
  outreachLogCreateSchema,
} from "@/lib/validation/outreach-log";
import {
  type VenueCreateInput,
  type VenueUpdateInput,
  venueCreateSchema,
  venueUpdateSchema,
} from "@/lib/validation/venues";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function formToObject(form: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    const last = values[values.length - 1];
    if (typeof last !== "string") {
      obj[key] = last;
      continue;
    }
    if (last === "") obj[key] = undefined;
    else if (last === "_none") obj[key] = null;
    else if (last === "true" || last === "on") obj[key] = true;
    else if (last === "false" || last === "off") obj[key] = false;
    else obj[key] = last;
  }
  return obj;
}

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "venue action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "A venue with that Google Place ID already exists.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced city not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function createVenue(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = venueCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: VenueCreateInput = parsed.data;

  const location =
    input.longitude !== undefined && input.latitude !== undefined
      ? { lng: input.longitude, lat: input.latitude }
      : undefined;

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(venues)
        .values({
          cityId: input.cityId,
          name: input.name,
          googlePlaceId: input.googlePlaceId,
          address: input.address,
          location,
          phoneE164: input.phoneE164,
          email: input.email,
          websiteUrl: input.websiteUrl,
          instagramHandle: input.instagramHandle,
          capacity: input.capacity,
          servesAlcohol: input.servesAlcohol ?? true,
          internalNotes: input.internalNotes ?? "",
          doNotContact: input.doNotContact ?? false,
          doNotContactReason: input.doNotContactReason,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: venues.id }),
    );
    if (!row) throw new Error("Insert returned no row");
    revalidatePath("/venues");
    redirect(`/venues/${row.id}`);
  } catch (err) {
    return wrapDbError(err, "create venue");
  }
}

export async function updateVenue(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = venueUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: VenueUpdateInput = parsed.data;

  const patch: Partial<typeof venues.$inferInsert> = { updatedBy: staff.id };
  if (input.cityId !== undefined) patch.cityId = input.cityId;
  if (input.name !== undefined) patch.name = input.name;
  if (input.googlePlaceId !== undefined) patch.googlePlaceId = input.googlePlaceId;
  if (input.address !== undefined) patch.address = input.address;
  if (input.longitude !== undefined && input.latitude !== undefined) {
    patch.location = { lng: input.longitude, lat: input.latitude };
  }
  if (input.phoneE164 !== undefined) patch.phoneE164 = input.phoneE164;
  if (input.email !== undefined) patch.email = input.email;
  if (input.websiteUrl !== undefined) patch.websiteUrl = input.websiteUrl;
  if (input.instagramHandle !== undefined) patch.instagramHandle = input.instagramHandle;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.servesAlcohol !== undefined) patch.servesAlcohol = input.servesAlcohol;
  if (input.internalNotes !== undefined) patch.internalNotes = input.internalNotes;
  if (input.doNotContact !== undefined) patch.doNotContact = input.doNotContact;
  if (input.doNotContactReason !== undefined) patch.doNotContactReason = input.doNotContactReason;

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(venues).set(patch).where(eq(venues.id, id)),
    );
    revalidatePath(`/venues/${id}`);
    revalidatePath("/venues");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update venue");
  }
}

export async function archiveVenue(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx.update(venues).set({ archivedAt: new Date(), updatedBy: staff.id }).where(eq(venues.id, id)),
  );
  revalidatePath("/venues");
  redirect("/venues");
}

// =========================================================================
// Outreach log entries (Phase 4b)
// =========================================================================

// Local copy of formToObject since the venue and outreach contexts share a
// file. (Server actions can't import shared helpers from another "use server"
// module in the same scope without confusion; keeping it local is simpler.)

/**
 * Append a new outreach log entry for a venue. Returns the new row's id so
 * the UI can refocus or scroll to it.
 *
 * The form is rendered on the venue edit page (Phase 4b) and the venueId
 * comes from there as a hidden input.
 */
export async function logOutreach(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const obj: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const v = formData.getAll(key);
    const last = v[v.length - 1];
    if (typeof last !== "string") {
      obj[key] = last;
      continue;
    }
    if (last === "") obj[key] = undefined;
    else if (last === "_none") obj[key] = null;
    else obj[key] = last;
  }

  const parsed = outreachLogCreateSchema.safeParse(obj);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: OutreachLogCreateInput = parsed.data;

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(outreachLog)
        .values({
          venueId: input.venueId,
          outreachBrandId: input.outreachBrandId,
          staffMemberId: staff.id,
          channel: input.channel,
          outcome: input.outcome,
          subject: input.subject,
          notes: input.notes,
          createdBy: staff.id,
        })
        .returning({ id: outreachLog.id }),
    );
    if (!row) throw new Error("Insert returned no row");
    revalidatePath(`/venues/${input.venueId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    const dbErr = err as DatabaseError;
    logger.error({ err }, "log outreach failed");
    if (dbErr?.code === "23503") {
      return { ok: false, error: "Referenced venue or outreach brand not found." };
    }
    return {
      ok: false,
      error: "Unexpected database error. See server logs.",
    };
  }
}

/**
 * Read recent outreach log entries for a venue, joined to the staff member
 * who logged each one and the outreach brand it was on behalf of.
 */
export async function getVenueOutreachLog(venueId: string) {
  await requireStaff();
  return db
    .select({
      id: outreachLog.id,
      channel: outreachLog.channel,
      outcome: outreachLog.outcome,
      subject: outreachLog.subject,
      notes: outreachLog.notes,
      createdAt: outreachLog.createdAt,
      staffName: staffMembers.displayName,
      outreachBrandName: outreachBrands.displayName,
    })
    .from(outreachLog)
    .leftJoin(staffMembers, eq(staffMembers.id, outreachLog.staffMemberId))
    .leftJoin(outreachBrands, eq(outreachBrands.id, outreachLog.outreachBrandId))
    .where(eq(outreachLog.venueId, venueId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(50);
}

// =========================================================================
// Bulk operations (Phase 4d)
// =========================================================================

import { inArray } from "drizzle-orm";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Apply a status change to many venues at once. Used by the bulk action bar
 * on /venues. Supported operations:
 *   - "mark_dnc"     → doNotContact=true
 *   - "unmark_dnc"   → doNotContact=false (reason cleared)
 *   - "archive"      → archivedAt=now()
 *
 * Validates ids are UUIDs and limits batch size to 200 — beyond that the
 * operator should script it or do it in smaller chunks (and an audit_log
 * batch of 1000+ entries hides individual changes in a sea of noise).
 */
export async function bulkUpdateVenues(
  ids: string[],
  operation: "mark_dnc" | "unmark_dnc" | "archive",
  reason?: string,
): Promise<ActionResult<{ count: number }>> {
  const { staff } = await requireStaff();

  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "No venues selected." };
  }
  if (ids.length > 200) {
    return { ok: false, error: "Limit 200 venues per bulk action." };
  }
  const validIds = ids.filter((id) => typeof id === "string" && uuidRe.test(id));
  if (validIds.length !== ids.length) {
    return { ok: false, error: "Some ids were invalid." };
  }

  const patch: Partial<typeof venues.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (operation === "mark_dnc") {
    patch.doNotContact = true;
    if (reason) patch.doNotContactReason = reason.slice(0, 500);
  } else if (operation === "unmark_dnc") {
    patch.doNotContact = false;
    patch.doNotContactReason = null;
  } else if (operation === "archive") {
    patch.archivedAt = new Date();
  } else {
    return { ok: false, error: "Unknown bulk operation." };
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(venues).set(patch).where(inArray(venues.id, validIds)),
    );
    revalidatePath("/venues");
    return { ok: true, data: { count: validIds.length } };
  } catch (err) {
    logger.error({ err, operation, count: validIds.length }, "bulk update failed");
    return { ok: false, error: "Bulk update failed. See server logs." };
  }
}

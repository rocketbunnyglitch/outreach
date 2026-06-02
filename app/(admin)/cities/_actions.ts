"use server";

import { cities } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type CityCreateInput,
  type CityUpdateInput,
  cityCreateSchema,
  cityUpdateSchema,
} from "@/lib/validation/cities";
import { eq, sql } from "drizzle-orm";
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
  logger.error({ err, action }, "city action failed");
  if (dbErr?.code === "23505") {
    return {
      ok: false,
      error: "A city with that name already exists in this country/region.",
    };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced country not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function createCity(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = cityCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CityCreateInput = parsed.data;

  const location =
    input.longitude !== undefined && input.latitude !== undefined
      ? { lng: input.longitude, lat: input.latitude }
      : undefined;

  try {
    const [row] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(cities)
        .values({
          countryCode: input.countryCode,
          name: input.name,
          region: input.region,
          timezone: input.timezone,
          location,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: cities.id }),
    );
    if (!row) throw new Error("Insert returned no row");
    revalidatePath("/cities");
    redirect(`/cities/${row.id}`);
  } catch (err) {
    return wrapDbError(err, "create city");
  }
}

export async function updateCity(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();

  const parsed = cityUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: CityUpdateInput = parsed.data;

  const patch: Partial<typeof cities.$inferInsert> = { updatedBy: staff.id };
  if (input.countryCode !== undefined) patch.countryCode = input.countryCode;
  if (input.name !== undefined) patch.name = input.name;
  if (input.region !== undefined) patch.region = input.region;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.longitude !== undefined && input.latitude !== undefined) {
    patch.location = { lng: input.longitude, lat: input.latitude };
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(cities).set(patch).where(eq(cities.id, id)),
    );
    revalidatePath(`/cities/${id}`);
    revalidatePath("/cities");
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "update city");
  }
}

/**
 * Validate the reason supplied for a dangerous override. Returns the
 * trimmed/clamped reason, or null when it's missing/too short. Shared by
 * the city-archive overrides so the rule (>= 3 chars, <= 500) lives once.
 */
function normalizeOverrideReason(reason?: string): string | null {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) return null;
  return trimmed.slice(0, 500);
}

/**
 * Archive a city. This is a DANGEROUS override: archiving a city affects
 * every campaign + venue that touched it, so it is gated two ways:
 *
 *   1. Role gate -- requires at least `lead` (admin OR lead). There is no
 *      "manager" tier in STAFF_ROLE_RANK (lib/auth.ts); `lead` is the
 *      manager-equivalent tier between admin and outreach.
 *   2. Required reason -- persisted to cities.override_reason in the SAME
 *      update so the audit trigger captures it (audit_log.new_values) and the
 *      /audit viewer shows "override_reason" with the text.
 *
 * `reason` is typed optional so the existing zero-arg form binding keeps
 * compiling, but it is enforced at runtime: a missing/blank reason throws
 * before any mutation. UI surfaces calling this MUST collect a reason.
 */
export async function archiveCity(id: string, reason?: string): Promise<void> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "lead")) {
    throw new Error("Archiving a city requires lead or admin role.");
  }
  const overrideReason = normalizeOverrideReason(reason);
  if (!overrideReason) {
    throw new Error("A reason (at least 3 characters) is required to archive a city.");
  }
  await withAuditContext(staff.id, async (tx) =>
    // override_reason written via raw SQL -- the Drizzle `cities` model
    // (db/schema/cities.ts) is owned by another surface. Column exists per
    // migration 0087; the audit trigger reads it off the row either way.
    tx.execute(sql`
      UPDATE cities
      SET archived_at = NOW(),
          override_reason = ${overrideReason},
          updated_by = ${staff.id}::uuid,
          updated_at = NOW()
      WHERE id = ${id}
    `),
  );
  revalidatePath("/cities");
  revalidatePath("/admin/archived-cities");
  redirect("/cities");
}

/**
 * Same as archiveCity but returns a result instead of redirecting.
 * Used by callers (e.g. the per-row action on /cities) that don't
 * want to be pulled to /cities (they're already there). Same lead+ role
 * gate and required reason as archiveCity, surfaced as a result error
 * rather than a thrown exception.
 */
export async function archiveCityNoRedirect(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "lead")) {
    return { ok: false, error: "Archiving a city requires lead or admin role." };
  }
  const overrideReason = normalizeOverrideReason(reason);
  if (!overrideReason) {
    return { ok: false, error: "A reason (at least 3 characters) is required to archive a city." };
  }
  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.execute(sql`
        UPDATE cities
        SET archived_at = NOW(),
            override_reason = ${overrideReason},
            updated_by = ${staff.id}::uuid,
            updated_at = NOW()
        WHERE id = ${id}
      `),
    );
    revalidatePath("/cities");
    revalidatePath("/admin/archived-cities");
    return { ok: true };
  } catch (err) {
    console.error("[archiveCityNoRedirect] failed", { err, cityId: id, by: staff.id });
    return { ok: false, error: "Couldn't archive city." };
  }
}

/**
 * Restore a previously-archived city. Clears archived_at.
 * Admin-only — undoing operator decisions affects every campaign
 * + venue that touched this city.
 */
export async function unarchiveCity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Admin role required to restore archived cities." };
  }
  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(cities).set({ archivedAt: null, updatedBy: staff.id }).where(eq(cities.id, id)),
    );
    revalidatePath("/cities");
    revalidatePath("/admin/archived-cities");
    return { ok: true };
  } catch (err) {
    console.error("[unarchiveCity] failed", { err, cityId: id, by: staff.id });
    return { ok: false, error: "Couldn't restore city." };
  }
}

/**
 * Permanent, irreversible delete of a city and every downstream record
 * referencing it.
 *
 * Admin-tier per operator: "from the cities tab you should be able
 * to permanently delete a city as an admin not just archive". The
 * prior superuser-only gate was too restrictive — operator is admin
 * and needs the verb for legitimate cleanup. Non-admin staff retain
 * the archive route only.
 *
 * If any FK has ON DELETE RESTRICT (e.g. a venue still points here),
 * the transaction aborts and we return a friendly error so the UI
 * can suggest archive instead.
 */
export async function hardDeleteCity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Admin role required to permanently delete cities." };
  }
  try {
    await withAuditContext(staff.id, async (tx) => tx.delete(cities).where(eq(cities.id, id)));
    revalidatePath("/cities");
    revalidatePath("/admin/archived-cities");
    return { ok: true };
  } catch (err) {
    console.error("[hardDeleteCity] failed", { err, cityId: id, by: staff.id });
    return {
      ok: false,
      error:
        "Couldn't permanently delete this city — venues, campaigns, or other records still reference it. Archive it instead, or remove those references first.",
    };
  }
}

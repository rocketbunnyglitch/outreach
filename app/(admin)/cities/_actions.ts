"use server";

import { cities } from "@/db/schema";
import { requireStaff, requireSuperUser } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type CityCreateInput,
  type CityUpdateInput,
  cityCreateSchema,
  cityUpdateSchema,
} from "@/lib/validation/cities";
import { eq } from "drizzle-orm";
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

export async function archiveCity(id: string): Promise<void> {
  const { staff } = await requireStaff();
  await withAuditContext(staff.id, async (tx) =>
    tx.update(cities).set({ archivedAt: new Date(), updatedBy: staff.id }).where(eq(cities.id, id)),
  );
  revalidatePath("/cities");
  redirect("/cities");
}

/**
 * Permanent, irreversible delete of a city and every downstream record
 * referencing it. Superuser only. Most operators should archive instead;
 * this is for clearing duplicate / mistaken entries. If any FK has
 * ON DELETE RESTRICT (e.g. a venue still points here), the transaction
 * aborts and we return a friendly error.
 */
export async function hardDeleteCity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireSuperUser();
  try {
    await withAuditContext(staff.id, async (tx) => tx.delete(cities).where(eq(cities.id, id)));
    revalidatePath("/cities");
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

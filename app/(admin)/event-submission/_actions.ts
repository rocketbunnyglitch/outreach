"use server";

/**
 * Event submission sites CRUD. Per-city list of where we post crawls.
 * Operator session-12 P3.
 */

import { cities, eventSubmissionSites } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export interface SubmissionSiteRow {
  id: string;
  name: string;
  url: string | null;
  notes: string | null;
  submitted: boolean;
  submittedAt: Date | null;
}

export interface CitySubmissionGroup {
  cityId: string;
  cityName: string;
  region: string | null;
  sites: SubmissionSiteRow[];
}

/** All cities (with sites) grouped, ordered by city name. */
export async function loadSubmissionSites(): Promise<CitySubmissionGroup[]> {
  await requireStaff();
  const rows = await db
    .select({
      cityId: cities.id,
      cityName: cities.name,
      region: cities.region,
      siteId: eventSubmissionSites.id,
      name: eventSubmissionSites.name,
      url: eventSubmissionSites.url,
      notes: eventSubmissionSites.notes,
      submitted: eventSubmissionSites.submitted,
      submittedAt: eventSubmissionSites.submittedAt,
    })
    .from(cities)
    .leftJoin(
      eventSubmissionSites,
      and(eq(eventSubmissionSites.cityId, cities.id), isNull(eventSubmissionSites.archivedAt)),
    )
    .orderBy(asc(cities.name), asc(eventSubmissionSites.name));

  const groups = new Map<string, CitySubmissionGroup>();
  for (const r of rows) {
    let g = groups.get(r.cityId);
    if (!g) {
      g = { cityId: r.cityId, cityName: r.cityName, region: r.region, sites: [] };
      groups.set(r.cityId, g);
    }
    if (r.siteId) {
      g.sites.push({
        id: r.siteId,
        name: r.name ?? "",
        url: r.url,
        notes: r.notes,
        submitted: r.submitted ?? false,
        submittedAt: r.submittedAt,
      });
    }
  }
  return Array.from(groups.values());
}

const upsertSchema = z.object({
  id: uuid.optional(),
  cityId: uuid,
  name: z.string().min(1).max(160),
  url: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export async function upsertSubmissionSite(
  input: z.infer<typeof upsertSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid site details." };
  const d = parsed.data;

  const values = {
    cityId: d.cityId,
    name: d.name.trim(),
    url: d.url?.trim() || null,
    notes: d.notes?.trim() || null,
    updatedBy: staff.id,
  };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      if (d.id) {
        await tx.update(eventSubmissionSites).set(values).where(eq(eventSubmissionSites.id, d.id));
        return d.id;
      }
      const [row] = await tx
        .insert(eventSubmissionSites)
        .values({ ...values, createdBy: staff.id })
        .returning({ id: eventSubmissionSites.id });
      return row?.id ?? "";
    });
    revalidatePath("/event-submission");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "upsertSubmissionSite failed");
    return { ok: false, error: "Couldn't save the site." };
  }
}

export async function toggleSubmissionSite(input: { id: string; submitted: boolean }): Promise<
  ActionResult<{ id: string }>
> {
  const { staff } = await requireStaff();
  const parsed = z.object({ id: uuid, submitted: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(eventSubmissionSites)
        .set({
          submitted: parsed.data.submitted,
          submittedAt: parsed.data.submitted ? new Date() : null,
          updatedBy: staff.id,
        })
        .where(eq(eventSubmissionSites.id, parsed.data.id)),
    );
    revalidatePath("/event-submission");
    return { ok: true, data: { id: parsed.data.id } };
  } catch (err) {
    logger.error({ err }, "toggleSubmissionSite failed");
    return { ok: false, error: "Couldn't update the site." };
  }
}

export async function archiveSubmissionSite(input: { id: string }): Promise<
  ActionResult<{ id: string }>
> {
  const { staff } = await requireStaff();
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid site id." };

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(eventSubmissionSites)
        .set({ archivedAt: new Date(), updatedBy: staff.id })
        .where(eq(eventSubmissionSites.id, parsed.data.id)),
    );
    revalidatePath("/event-submission");
    return { ok: true, data: { id: parsed.data.id } };
  } catch (err) {
    logger.error({ err }, "archiveSubmissionSite failed");
    return { ok: false, error: "Couldn't remove the site." };
  }
}

/** City options for the "add site" picker. */
export async function loadCityOptions(): Promise<Array<{ id: string; name: string }>> {
  await requireStaff();
  const rows = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .orderBy(asc(cities.name));
  return rows;
}

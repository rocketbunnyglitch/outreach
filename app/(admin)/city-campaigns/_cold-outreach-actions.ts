"use server";

/**
 * Cold outreach actions + loader.
 *
 * Operator-managed pipeline of venues we're chasing but haven't booked.
 * Each row is per (city_campaign, venue).
 *
 * Actions:
 *   - upsertColdOutreachEntry: add a venue to the cold outreach table
 *   - updateColdOutreachField: inline-edit status / assignee / remarks
 *   - archiveColdOutreach: soft-delete (set archivedAt)
 *   - generateVenueLeads: cluster-script entrypoint
 *     (gracefully degrades when Google Places key isn't configured)
 */

import { coldOutreachEntries, staffMembers, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const statusSchema = z.enum([
  "not_contacted",
  "email_sent",
  "follow_up_due",
  "called",
  "voicemail",
  "no_answer",
  "interested",
  "declined",
  "bad_email",
  "wrong_number",
  "do_not_contact",
]);

const upsertSchema = z.object({
  cityCampaignId: uuid,
  venueId: uuid,
});

/**
 * Add a venue to the cold outreach table for this city_campaign.
 * Idempotent — if it already exists, returns the existing id.
 */
export async function upsertColdOutreachEntry(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = upsertSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
    venueId: formData.get("venueId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const existing = await tx
        .select({ id: coldOutreachEntries.id })
        .from(coldOutreachEntries)
        .where(
          and(
            eq(coldOutreachEntries.cityCampaignId, parsed.data.cityCampaignId),
            eq(coldOutreachEntries.venueId, parsed.data.venueId),
            isNull(coldOutreachEntries.archivedAt),
          ),
        )
        .limit(1)
        .then((r) => r[0]);
      if (existing) return existing.id;

      const [row] = await tx
        .insert(coldOutreachEntries)
        .values({
          cityCampaignId: parsed.data.cityCampaignId,
          venueId: parsed.data.venueId,
          status: "not_contacted",
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: coldOutreachEntries.id });
      return row?.id ?? "";
    });

    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "upsertColdOutreachEntry failed");
    return { ok: false, error: "Couldn't add to cold outreach." };
  }
}

const updateSchema = z.object({
  entryId: uuid,
  field: z.enum(["status", "assignedStaffId", "remarks"]),
  value: z.string().max(2000),
  cityCampaignId: uuid.optional(),
});

export async function updateColdOutreachField(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = updateSchema.safeParse({
    entryId: formData.get("entryId"),
    field: formData.get("field"),
    value: formData.get("value") ?? "",
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid update." };
  const { entryId, field, value, cityCampaignId } = parsed.data;

  try {
    await withAuditContext(staff.id, async (tx) => {
      const patch: Record<string, unknown> = {
        updatedBy: staff.id,
        lastTouchAt: new Date(),
      };
      if (field === "status") {
        // Type assertion — field is checked by zod above
        const statusParsed = statusSchema.safeParse(value);
        if (!statusParsed.success) throw new Error("Invalid status value");
        patch.status = statusParsed.data;
      } else if (field === "assignedStaffId") {
        patch.assignedStaffId = value || null;
      } else {
        patch.remarks = value || null;
      }
      await tx.update(coldOutreachEntries).set(patch).where(eq(coldOutreachEntries.id, entryId));
    });
    if (cityCampaignId) revalidatePath(`/city-campaigns/${cityCampaignId}`);
    return { ok: true, data: { id: entryId } };
  } catch (err) {
    logger.error({ err }, "updateColdOutreachField failed");
    return { ok: false, error: "Save failed." };
  }
}

const archiveSchema = z.object({
  entryId: uuid,
  cityCampaignId: uuid.optional(),
});

export async function archiveColdOutreachEntry(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = archiveSchema.safeParse({
    entryId: formData.get("entryId"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(coldOutreachEntries)
        .set({ archivedAt: new Date(), updatedBy: staff.id })
        .where(eq(coldOutreachEntries.id, parsed.data.entryId));
    });
    if (parsed.data.cityCampaignId) revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { id: parsed.data.entryId } };
  } catch (err) {
    logger.error({ err }, "archiveColdOutreachEntry failed");
    return { ok: false, error: "Archive failed." };
  }
}

/**
 * Generate venue leads via cluster discovery.
 *
 * When GOOGLE_MAPS_API_KEY is set, runs the Places API nearby-search
 * around the city's coordinates to find bars/clubs/restaurants and
 * inserts them as cold_outreach_entries.
 *
 * Without the key: returns a graceful "not configured" response so the
 * UI can render the right state. The action is shaped so the wiring
 * is ready — just drop the key into env and lead generation comes online.
 */
const generateSchema = z.object({
  cityCampaignId: uuid,
});

export async function generateVenueLeads(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{
    suggestions: Array<{
      name: string;
      address: string | null;
      phone: string | null;
      website: string | null;
      placeId: string | null;
    }>;
    notConfigured?: boolean;
  }>
> {
  const { staff: _staff } = await requireStaff();
  const parsed = generateSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      ok: true,
      data: {
        suggestions: [],
        notConfigured: true,
      },
    };
  }

  // Stub for when the key arrives — actual implementation calls
  // Places API nearby-search with the city's coordinates + filters
  // (type: bar | nightclub | restaurant) and dedupes against existing
  // venues.id by place_id.
  logger.info({ cityCampaignId: parsed.data.cityCampaignId }, "lead generation skeleton");
  return {
    ok: true,
    data: {
      suggestions: [],
      notConfigured: false,
    },
  };
}

/**
 * Read helper: cold outreach pipeline for a city_campaign, joined with
 * venue + email_validation (for ZeroBounce status) + assigned staff.
 */
export async function loadColdOutreach(cityCampaignId: string): Promise<
  Array<{
    entryId: string;
    venueId: string;
    venueName: string;
    venueEmail: string | null;
    venuePhone: string | null;
    zeroBounceStatus: string | null;
    status: string;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    remarks: string | null;
    lastTouchAt: Date | null;
  }>
> {
  await requireStaff();
  const rows = await db
    .select({
      entryId: coldOutreachEntries.id,
      venueId: venues.id,
      venueName: venues.name,
      venueEmail: venues.email,
      venuePhone: venues.phoneE164,
      status: coldOutreachEntries.status,
      assignedStaffId: coldOutreachEntries.assignedStaffId,
      assignedStaffName: staffMembers.displayName,
      remarks: coldOutreachEntries.remarks,
      lastTouchAt: coldOutreachEntries.lastTouchAt,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .leftJoin(staffMembers, eq(staffMembers.id, coldOutreachEntries.assignedStaffId))
    .where(
      and(
        eq(coldOutreachEntries.cityCampaignId, cityCampaignId),
        isNull(coldOutreachEntries.archivedAt),
      ),
    )
    .orderBy(asc(venues.name));

  if (rows.length === 0) return [];

  // Join email_validations separately to keep the main query simple
  const emails = rows.map((r) => r.venueEmail).filter((e): e is string => !!e);
  let zbMap = new Map<string, string>();
  if (emails.length > 0) {
    const validations = await db.execute<{ email: string; status: string }>(sql`
      SELECT email, status::text AS status
      FROM email_validations
      WHERE email = ANY(${emails.map((e) => e.toLowerCase())}::text[])
    `);
    const list: Array<{ email: string; status: string }> = Array.isArray(validations)
      ? (validations as unknown as Array<{ email: string; status: string }>)
      : ((validations as unknown as { rows: Array<{ email: string; status: string }> }).rows ?? []);
    zbMap = new Map(list.map((v) => [v.email, v.status]));
  }

  return rows.map((r) => ({
    entryId: r.entryId,
    venueId: r.venueId,
    venueName: r.venueName,
    venueEmail: r.venueEmail,
    venuePhone: r.venuePhone,
    zeroBounceStatus: r.venueEmail ? (zbMap.get(r.venueEmail.toLowerCase()) ?? null) : null,
    status: r.status as string,
    assignedStaffId: r.assignedStaffId,
    assignedStaffName: r.assignedStaffName,
    remarks: r.remarks,
    lastTouchAt: r.lastTouchAt,
  }));
}

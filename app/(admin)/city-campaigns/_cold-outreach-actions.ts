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

import {
  cities,
  cityCampaigns,
  coldOutreachEntries,
  staffMembers,
  tasks,
  venues,
} from "@/db/schema";
import { backfillLeadScores } from "@/lib/ai-lead-score";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { detectRemarkFollowUp } from "@/lib/detect-remark-followup";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { newOpError } from "@/lib/op-error";
import { publishRealtime } from "@/lib/realtime-publish";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
  // Single top-level try/catch ensures we ALWAYS return a
  // structured ActionResult — never throw out of the action.
  // Throwing out of a server action corrupts the RSC stream
  // and the client sees a generic "unexpected response" with
  // no error code. The operator-error system depends on
  // structured returns.
  const op = newOpError("city_campaigns.upsertColdOutreachEntry");
  try {
    const { staff } = await requireStaff();
    const parsed = upsertSchema.safeParse({
      cityCampaignId: formData.get("cityCampaignId"),
      venueId: formData.get("venueId"),
    });
    if (!parsed.success) {
      return { ok: false, error: "Invalid input.", code: op.code };
    }

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
    op.log(err, {
      cityCampaignId: formData.get("cityCampaignId"),
      venueId: formData.get("venueId"),
    });
    // Surface the actual error message so the operator can
    // diagnose without PM2 grep. The op.code still ties back
    // to the structured log line for the full stack.
    const detail = (err as Error)?.message ?? String(err);
    return {
      ok: false,
      error: `Couldn't add to cold outreach: ${detail}`,
      code: op.code,
    };
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
): Promise<
  ActionResult<{
    id: string;
    /**
     * Present only when field=remarks AND a future-dated time phrase
     * was detected in the text (e.g. "wants a call at 7pm Tue"). The
     * UI renders a "Schedule follow-up" chip from this; clicking it
     * calls createFollowUpFromRemark. null/absent = no date found.
     */
    followUp?: { dueAtIso: string; label: string; matchedText: string } | null;
  }>
> {
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

        // Auto-toggle is_warm based on terminal vs interested status.
        // Terminal statuses mean the venue isn't warm anymore by
        // definition; setting it to interested marks them warm.
        // Operator can manually un-warm afterward if they disagree.
        const s = statusParsed.data;
        if (
          s === "declined" ||
          s === "do_not_contact" ||
          s === "bad_email" ||
          s === "wrong_number"
        ) {
          patch.isWarm = false;
        } else if (s === "interested") {
          patch.isWarm = true;
        }
        // All other statuses (not_contacted, email_sent, called, etc.)
        // leave is_warm alone — operator may have promoted a venue to
        // warm AND then continued cold outreach to confirm.
      } else if (field === "assignedStaffId") {
        patch.assignedStaffId = value || null;
      } else {
        patch.remarks = value || null;
      }
      await tx.update(coldOutreachEntries).set(patch).where(eq(coldOutreachEntries.id, entryId));
    });
    if (cityCampaignId) {
      revalidatePath(`/city-campaigns/${cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    // Realtime push so other open tabs viewing this campaign refresh.
    // Channel is scoped per cityCampaignId so different campaigns don't fan
    // out to each other.
    if (cityCampaignId) {
      publishRealtime({
        table: `cold-outreach-${cityCampaignId}`,
        id: entryId,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }

    // Smart follow-up detection (operator session-12 "smart like
    // Fantastical" ask). Only for remarks with content. We look up the
    // venue's timezone so "3pm" is interpreted in the venue's local
    // time, then run the chrono-based detector. Any future-dated time
    // phrase produces a suggestion the UI surfaces as a chip.
    let followUp: { dueAtIso: string; label: string; matchedText: string } | null = null;
    if (field === "remarks" && value.trim().length >= 3) {
      try {
        const [tzRow] = await db
          .select({ timezone: cities.timezone })
          .from(coldOutreachEntries)
          .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
          .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
          .where(eq(coldOutreachEntries.id, entryId))
          .limit(1);
        const tz = tzRow?.timezone ?? "America/Toronto";
        followUp = detectRemarkFollowUp(value, tz);
      } catch (err) {
        // Detection is best-effort — never block the save.
        logger.error({ err, entryId }, "remark follow-up detection failed");
      }
    }

    return { ok: true, data: { id: entryId, followUp } };
  } catch (err) {
    const op = newOpError("city_campaigns.updateColdOutreachField");
    op.log(err, { entryId, field: parsed.data.field });
    return { ok: false, error: "Save failed.", code: op.code };
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
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { id: parsed.data.entryId } };
  } catch (err) {
    logger.error({ err }, "archiveColdOutreachEntry failed");
    return { ok: false, error: "Archive failed." };
  }
}

/**
 * unarchiveColdOutreachEntry — reverse of archive. Used by the
 * undo toast on the cold-outreach table. Idempotent: a non-archived
 * row stays non-archived. We don't expose this through the UI as a
 * standalone action — it's specifically the undo partner.
 */
export async function unarchiveColdOutreachEntry(
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
        .set({ archivedAt: null, updatedBy: staff.id })
        .where(eq(coldOutreachEntries.id, parsed.data.entryId));
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { id: parsed.data.entryId } };
  } catch (err) {
    logger.error({ err }, "unarchiveColdOutreachEntry failed");
    return { ok: false, error: "Restore failed." };
  }
}

// =========================================================================
// Bulk operations
//
// Three multi-row actions to speed up day-to-day pipeline management:
//   - bulkUpdateColdOutreachStatus: stamp the same status on N rows
//   - bulkAssignColdOutreach: assign N rows to one staff member
//   - bulkArchiveColdOutreach: archive N rows
//
// All three accept a comma-separated entryIds form field (matches the
// pattern of multi-select <input type="hidden" />) and run their writes
// in a single transaction so partial failures don't half-apply.
//
// Each bumps last_touch_at to NOW() so the changed rows surface as
// recently-active in the Today widget + analytics. (Operator chose to
// touch them.) Archive is the exception — it doesn't bump touch since
// the row is going away.
// =========================================================================

const bulkUuids = z
  .string()
  .min(36)
  .max(36 * 500 + 500) // safety cap: 500 entries max per call
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(uuid).min(1).max(500));

const bulkStatusSchema = z.object({
  entryIds: bulkUuids,
  status: statusSchema,
  cityCampaignId: uuid.optional(),
});

export async function bulkUpdateColdOutreachStatus(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ updated: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkStatusSchema.safeParse({
    entryIds: formData.get("entryIds"),
    status: formData.get("status"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid bulk payload." };

  try {
    const updated = await withAuditContext(staff.id, async (tx) => {
      // Auto-toggle is_warm in the same UPDATE so a bulk transition
      // to declined/do_not_contact also clears the warm flag (per the
      // updateColdOutreachField rules — keep behavior consistent).
      const s = parsed.data.status;
      const warmExpr =
        s === "declined" || s === "do_not_contact" || s === "bad_email" || s === "wrong_number"
          ? sql`, is_warm = false`
          : s === "interested"
            ? sql`, is_warm = true`
            : sql``;
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE cold_outreach_entries
        SET status = ${parsed.data.status}::cold_outreach_status,
            last_touch_at = NOW(),
            updated_by = ${staff.id},
            updated_at = NOW()${warmExpr}
        WHERE id IN ${parsed.data.entryIds}
          AND archived_at IS NULL
        RETURNING id
      `);
      const rows: Array<{ id: string }> = Array.isArray(result)
        ? (result as unknown as Array<{ id: string }>)
        : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      return rows.length;
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { updated } };
  } catch (err) {
    logger.error({ err }, "bulkUpdateColdOutreachStatus failed");
    return { ok: false, error: "Bulk status update failed." };
  }
}

const bulkWarmSchema = z.object({
  entryIds: bulkUuids,
  isWarm: z.boolean(),
  cityCampaignId: uuid.optional(),
});

/**
 * Flip the is_warm flag on a batch of cold_outreach_entries
 * WITHOUT touching status. This is the operator's "Move to warm
 * leads" / "Move back to cold queue" verb.
 *
 *   - is_warm=true:  venue appears in BOTH the cold table (mass
 *                    outreach) AND the warm table (interested).
 *                    Status stays whatever it was — e.g. a venue
 *                    can be both warm AND status='email_sent'
 *                    because the operator is still nudging them.
 *   - is_warm=false: venue only appears in cold table. Doesn't
 *                    touch status — operator may still want
 *                    status='interested' as a record that the
 *                    venue WAS warm at one point.
 *
 * Distinct from bulkUpdateColdOutreachStatus which changes the
 * outreach funnel state (and auto-toggles is_warm for terminal
 * statuses).
 */
export async function bulkSetWarmFlag(input: {
  entryIds: string;
  isWarm: boolean;
  cityCampaignId?: string | null;
}): Promise<ActionResult<{ updated: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkWarmSchema.safeParse({
    entryIds: input.entryIds,
    isWarm: input.isWarm,
    cityCampaignId: input.cityCampaignId ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid warm-flag payload." };

  try {
    const updated = await withAuditContext(staff.id, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE cold_outreach_entries
        SET is_warm = ${parsed.data.isWarm},
            last_touch_at = NOW(),
            updated_by = ${staff.id},
            updated_at = NOW()
        WHERE id IN ${parsed.data.entryIds}
          AND archived_at IS NULL
        RETURNING id
      `);
      const rows: Array<{ id: string }> = Array.isArray(result)
        ? (result as unknown as Array<{ id: string }>)
        : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      return rows.length;
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { updated } };
  } catch (err) {
    logger.error({ err, isWarm: parsed.data.isWarm }, "bulkSetWarmFlag failed");
    return { ok: false, error: "Couldn't update warm flag." };
  }
}

const bulkAssignSchema = z.object({
  entryIds: bulkUuids,
  /** Empty string clears assignment ("none"). */
  staffMemberId: z
    .string()
    .max(36)
    .transform((s) => s.trim() || null)
    .pipe(uuid.nullable()),
  cityCampaignId: uuid.optional(),
});

export async function bulkAssignColdOutreach(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ updated: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkAssignSchema.safeParse({
    entryIds: formData.get("entryIds"),
    staffMemberId: formData.get("staffMemberId") ?? "",
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid bulk payload." };

  try {
    const updated = await withAuditContext(staff.id, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE cold_outreach_entries
        SET assigned_staff_id = ${parsed.data.staffMemberId},
            last_touch_at = NOW(),
            updated_by = ${staff.id},
            updated_at = NOW()
        WHERE id IN ${parsed.data.entryIds}
          AND archived_at IS NULL
        RETURNING id
      `);
      const rows: Array<{ id: string }> = Array.isArray(result)
        ? (result as unknown as Array<{ id: string }>)
        : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      return rows.length;
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { updated } };
  } catch (err) {
    logger.error({ err }, "bulkAssignColdOutreach failed");
    return { ok: false, error: "Bulk assign failed." };
  }
}

const bulkArchiveSchema = z.object({
  entryIds: bulkUuids,
  cityCampaignId: uuid.optional(),
});

export async function bulkArchiveColdOutreach(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ archived: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkArchiveSchema.safeParse({
    entryIds: formData.get("entryIds"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid bulk payload." };

  try {
    const archived = await withAuditContext(staff.id, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE cold_outreach_entries
        SET archived_at = NOW(),
            updated_by = ${staff.id},
            updated_at = NOW()
        WHERE id IN ${parsed.data.entryIds}
          AND archived_at IS NULL
        RETURNING id
      `);
      const rows: Array<{ id: string }> = Array.isArray(result)
        ? (result as unknown as Array<{ id: string }>)
        : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      return rows.length;
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { archived } };
  } catch (err) {
    logger.error({ err }, "bulkArchiveColdOutreach failed");
    return { ok: false, error: "Bulk archive failed." };
  }
}

/**
 * bulkUnarchiveColdOutreach — reverse of bulkArchive, used by the
 * undo toast on the bulk action bar. Restores entries even if some
 * are already non-archived (idempotent).
 */
export async function bulkUnarchiveColdOutreach(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ restored: number }>> {
  const { staff } = await requireStaff();
  const parsed = bulkArchiveSchema.safeParse({
    entryIds: formData.get("entryIds"),
    cityCampaignId: formData.get("cityCampaignId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid bulk payload." };

  try {
    const restored = await withAuditContext(staff.id, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE cold_outreach_entries
        SET archived_at = NULL,
            updated_by = ${staff.id},
            updated_at = NOW()
        WHERE id IN ${parsed.data.entryIds}
          AND archived_at IS NOT NULL
        RETURNING id
      `);
      const rows: Array<{ id: string }> = Array.isArray(result)
        ? (result as unknown as Array<{ id: string }>)
        : ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      return rows.length;
    });
    if (parsed.data.cityCampaignId) {
      revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
      publishRealtime({
        table: `cold-outreach-${parsed.data.cityCampaignId}`,
        type: "update",
        byStaffId: staff.id,
        byStaffName: staff.displayName ?? null,
      });
    }
    return { ok: true, data: { restored } };
  } catch (err) {
    logger.error({ err }, "bulkUnarchiveColdOutreach failed");
    return { ok: false, error: "Bulk restore failed." };
  }
}

/**
 * Generate venue leads via cluster discovery.
 *
 * When GOOGLE_MAPS_API_KEY is set, runs the Places API nearby-search
 * around the city's coordinates to find bars/clubs/restaurants and
 * returns the candidates for operator review. Insertion happens via
 * a follow-up acceptLeadSuggestions action so the operator gets to
 * filter before anything hits the DB.
 *
 * Dedupe: candidates already in venues (by google_place_id) are
 * stripped out before returning.
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
      placeId: string;
      name: string;
      address: string | null;
      phone: string | null;
      website: string | null;
      rating: number | null;
      userRatingCount: number | null;
      types: string[];
    }>;
    notConfigured?: boolean;
    /** How many candidates Google actually returned (before dedup). */
    searchedCount?: number;
    /** Radius (km) Google searched at — surface to the operator so they know. */
    searchedRadiusKm?: number;
  }>
> {
  const { staff: _staff } = await requireStaff();
  const parsed = generateSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const { isGoogleMapsConfigured, nearbyVenueSearch } = await import("@/lib/google-places");
  if (!isGoogleMapsConfigured()) {
    return { ok: true, data: { suggestions: [], notConfigured: true } };
  }

  // Resolve the city's coordinates
  const cityRow = await db.execute<{ lat: number | null; lng: number | null }>(sql`
    SELECT
      ST_Y(c.location::geometry) AS lat,
      ST_X(c.location::geometry) AS lng
    FROM city_campaigns cc
    JOIN cities c ON c.id = cc.city_id
    WHERE cc.id = ${parsed.data.cityCampaignId}
    LIMIT 1
  `);
  const rows: Array<{ lat: number | null; lng: number | null }> = Array.isArray(cityRow)
    ? (cityRow as unknown as Array<{ lat: number | null; lng: number | null }>)
    : ((cityRow as unknown as { rows: Array<{ lat: number | null; lng: number | null }> }).rows ??
      []);
  const coords = rows[0];
  if (!coords?.lat || !coords?.lng) {
    return {
      ok: false,
      error:
        "Can't generate leads — city has no coordinates. Edit the master city record and add lat/lng first.",
    };
  }

  // Search broad. Google's max nearby radius is 50km, but anything past
  // ~15km drifts out of a single 'city center' definition. 8km comfortably
  // covers downtown-plus-near-suburbs nightlife districts for most North
  // American cities. The 1.5km default we were on was way too tight —
  // a venue clustered 2km from the city's recorded center wouldn't show.
  const SEARCH_RADIUS_M = 8000;
  const candidates = await nearbyVenueSearch({
    lat: coords.lat,
    lng: coords.lng,
    radiusM: SEARCH_RADIUS_M,
    maxResults: 20,
  });

  if (candidates.length === 0) {
    return {
      ok: true,
      data: { suggestions: [], searchedCount: 0, searchedRadiusKm: SEARCH_RADIUS_M / 1000 },
    };
  }

  // Dedupe against existing venues with the same place_id
  const placeIds = candidates.map((c) => c.placeId);
  const existing = await db.execute<{ google_place_id: string }>(sql`
    SELECT google_place_id FROM venues
    WHERE google_place_id IN ${placeIds}
  `);
  const existingList: Array<{ google_place_id: string }> = Array.isArray(existing)
    ? (existing as unknown as Array<{ google_place_id: string }>)
    : ((existing as unknown as { rows: Array<{ google_place_id: string }> }).rows ?? []);
  const knownPlaceIds = new Set(existingList.map((r) => r.google_place_id));

  const suggestions = candidates
    .filter((c) => !knownPlaceIds.has(c.placeId))
    .map((c) => ({
      placeId: c.placeId,
      name: c.name,
      address: c.address,
      phone: c.phone,
      website: c.website,
      rating: c.rating,
      userRatingCount: c.userRatingCount,
      types: c.types,
    }));

  return {
    ok: true,
    data: {
      suggestions,
      searchedCount: candidates.length,
      searchedRadiusKm: SEARCH_RADIUS_M / 1000,
    },
  };
}

/**
 * Accept a batch of lead suggestions: creates venues + cold outreach
 * entries in one transaction. Used by the generate-leads review modal.
 */
const acceptSchema = z.object({
  cityCampaignId: uuid,
  cityId: uuid,
  // Comma-separated JSON-encoded suggestion objects pushed as a single
  // form field by the client (avoids multi-form-field nesting)
  suggestionsJson: z.string().min(2).max(50_000),
});

export async function acceptLeadSuggestions(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inserted: number }>> {
  const { staff } = await requireStaff();
  const parsed = acceptSchema.safeParse({
    cityCampaignId: formData.get("cityCampaignId"),
    cityId: formData.get("cityId"),
    suggestionsJson: formData.get("suggestionsJson"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid suggestion payload." };

  type Suggestion = {
    placeId: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
  };
  let parsedSuggestions: Suggestion[];
  try {
    parsedSuggestions = JSON.parse(parsed.data.suggestionsJson) as Suggestion[];
    if (!Array.isArray(parsedSuggestions)) throw new Error("not an array");
  } catch {
    return { ok: false, error: "Couldn't parse the suggestion list." };
  }

  let inserted = 0;
  try {
    await withAuditContext(staff.id, async (tx) => {
      for (const s of parsedSuggestions) {
        // Insert venue (skip if place_id already known)
        const existing = await tx
          .select({ id: venues.id })
          .from(venues)
          .where(eq(venues.googlePlaceId, s.placeId))
          .limit(1)
          .then((r) => r[0]);
        let venueId = existing?.id;
        if (!venueId) {
          const [row] = await tx
            .insert(venues)
            .values({
              cityId: parsed.data.cityId,
              name: s.name,
              address: s.address,
              phoneE164: s.phone,
              websiteUrl: s.website,
              googlePlaceId: s.placeId,
              createdBy: staff.id,
              updatedBy: staff.id,
            })
            .returning({ id: venues.id });
          venueId = row?.id;
        }
        if (!venueId) continue;

        // Upsert cold outreach entry
        await tx.execute(sql`
          INSERT INTO cold_outreach_entries (
            id, city_campaign_id, venue_id, status, created_by, updated_by, version
          ) VALUES (
            gen_random_uuid(), ${parsed.data.cityCampaignId}, ${venueId},
            'not_contacted', ${staff.id}, ${staff.id}, 1
          )
          ON CONFLICT DO NOTHING
        `);
        inserted++;
      }
    });
    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { inserted } };
  } catch (err) {
    logger.error({ err }, "acceptLeadSuggestions failed");
    return { ok: false, error: "Couldn't insert leads." };
  }
}

// =========================================================================
// bulkPasteVenues — operator pastes TSV rows from Google Sheets, we
// create venues + cold outreach entries in one transaction. Dedupes
// against existing venues in the same city by name (case-insensitive)
// so re-pasting an overlapping set updates the existing rows rather
// than creating duplicates.
// =========================================================================

const pastedRowSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

const bulkPasteSchema = z.object({
  cityCampaignId: uuid,
  cityId: uuid,
  rowsJson: z.string().min(2),
});

export async function bulkPasteVenues(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ created: number; updated: number; skipped: number }>> {
  const { staff } = await requireStaff();

  const parsed = bulkPasteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid paste payload." };

  type PastedRow = z.infer<typeof pastedRowSchema>;
  let rows: PastedRow[];
  try {
    const list = JSON.parse(parsed.data.rowsJson);
    if (!Array.isArray(list)) throw new Error("not array");
    // Validate each row, drop malformed ones rather than failing the whole
    // batch — common scenario is one row with a typo in a 50-row paste
    rows = list
      .map((r) => pastedRowSchema.safeParse(r))
      .filter((r): r is { success: true; data: PastedRow } => r.success)
      .map((r) => r.data);
  } catch {
    return { ok: false, error: "Couldn't parse the pasted rows." };
  }

  if (rows.length === 0) return { ok: false, error: "No valid rows to import." };
  if (rows.length > 500) return { ok: false, error: "Too many rows — max 500 per paste." };

  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await withAuditContext(staff.id, async (tx) => {
      for (const r of rows) {
        const trimmedName = r.name.trim();
        const trimmedEmail = r.email?.trim() || null;
        const trimmedPhone = r.phone?.trim() || null;

        // Validate email + phone formats; skip if either is set but bad
        if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          skipped++;
          continue;
        }
        let normalizedPhone: string | null = null;
        if (trimmedPhone) {
          const stripped = trimmedPhone.replace(/[\s\-().]/g, "");
          if (!/^\+?[1-9]\d{6,14}$/.test(stripped)) {
            skipped++;
            continue;
          }
          normalizedPhone = stripped.startsWith("+") ? stripped : `+${stripped}`;
        }

        // Case-insensitive name dedupe within the city
        const existing = await tx
          .select({ id: venues.id, email: venues.email, phoneE164: venues.phoneE164 })
          .from(venues)
          .where(
            and(
              eq(venues.cityId, parsed.data.cityId),
              sql`LOWER(${venues.name}) = LOWER(${trimmedName})`,
            ),
          )
          .limit(1)
          .then((r) => r[0]);

        let venueId: string;
        if (existing) {
          venueId = existing.id;
          // Only update email/phone if the existing record is empty —
          // don't clobber operator-curated data with a stale paste
          const patch: Partial<typeof venues.$inferInsert> = { updatedBy: staff.id };
          let touched = false;
          if (trimmedEmail && !existing.email) {
            patch.email = trimmedEmail;
            touched = true;
          }
          if (normalizedPhone && !existing.phoneE164) {
            patch.phoneE164 = normalizedPhone;
            touched = true;
          }
          if (touched) {
            await tx.update(venues).set(patch).where(eq(venues.id, venueId));
            updated++;
          }
        } else {
          const [row] = await tx
            .insert(venues)
            .values({
              cityId: parsed.data.cityId,
              name: trimmedName,
              email: trimmedEmail,
              phoneE164: normalizedPhone,
              createdBy: staff.id,
              updatedBy: staff.id,
            })
            .returning({ id: venues.id });
          if (!row) {
            skipped++;
            continue;
          }
          venueId = row.id;
          created++;
        }

        // Upsert cold outreach entry — if archived, re-activate
        await tx.execute(sql`
          INSERT INTO cold_outreach_entries (
            id, city_campaign_id, venue_id, status, created_by, updated_by, version
          ) VALUES (
            gen_random_uuid(), ${parsed.data.cityCampaignId}, ${venueId},
            'not_contacted', ${staff.id}, ${staff.id}, 1
          )
          ON CONFLICT (city_campaign_id, venue_id) DO UPDATE
            SET archived_at = NULL, updated_by = ${staff.id}, updated_at = NOW()
            WHERE cold_outreach_entries.archived_at IS NOT NULL
        `);

        // Fire ZeroBounce on new emails
        if (!existing && trimmedEmail) {
          const { validateEmailInBackground } = await import("@/lib/zerobounce");
          validateEmailInBackground(trimmedEmail, staff.id);
        }
      }
    });

    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { created, updated, skipped } };
  } catch (err) {
    logger.error({ err }, "bulkPasteVenues failed");
    return { ok: false, error: "Couldn't import the pasted rows." };
  }
}

/**
 * Read helper: cold outreach pipeline for a city_campaign, joined with
 * venue + email_validation (for ZeroBounce status) + assigned staff.
 */
// Human labels for the cadence-aware "Cadence" column (Phase 2.12). cadence_state
// (on the venue's email_thread for this campaign) is the rich signal; when there's
// no thread yet we fall back to the cold_outreach status.
const CADENCE_STATE_LABEL: Record<string, string> = {
  cold_pending_touch_1: "Cold opener pending",
  cold_sent_touch_1: "Cold opener sent",
  cold_pending_touch_2: "Touch 2 pending",
  cold_sent_touch_2: "Touch 2 sent",
  cold_pending_touch_3: "Touch 3 pending",
  cold_sent_touch_3: "Touch 3 sent",
  cold_exhausted_ready_for_handoff: "Sequence exhausted - ready for handoff",
  warm_pending_response: "Warm - awaiting reply",
  warm_responded_pending_nudge_1: "Warm - nudge 1 pending",
  warm_nudge_1_sent: "Warm - nudge 1 sent",
  warm_pending_nudge_2: "Warm - nudge 2 pending",
  warm_nudge_2_sent: "Warm - nudge 2 sent",
  warm_pending_nudge_3: "Warm - nudge 3 pending",
  warm_nudge_3_sent: "Warm - nudge 3 sent",
  stalled_warm: "Stalled warm",
  declined_this_campaign: "Declined",
  opt_out_permanent: "Opted out",
  cancelled_by_them: "Cancelled by them",
  confirmed: "Confirmed",
  lifecycle_active: "Confirmed (lifecycle active)",
};

const COLD_STATUS_LABEL: Record<string, string> = {
  not_contacted: "Not contacted",
  email_sent: "Cold email sent",
  follow_up_due: "Follow-up due",
  called: "Called",
  voicemail: "Voicemail left",
  no_answer: "No answer",
  interested: "Interested",
  declined: "Declined",
  bad_email: "Bad email",
  wrong_number: "Wrong number",
  do_not_contact: "Do not contact",
  unreachable: "Unreachable",
};

function relativeDayLabel(from: Date | null, now: Date): string {
  if (!from) return "";
  const d = Math.floor((now.getTime() - from.getTime()) / 86_400_000);
  if (d <= 0) return "today";
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

function dueDayLabel(due: Date | null, now: Date): string {
  if (!due) return "";
  const d = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (d < 0) return "overdue";
  if (d === 0) return "due today";
  return d === 1 ? "due tomorrow" : `due in ${d} days`;
}

/** Build the Cadence column label from the venue's thread cadence_state (rich)
 *  or the cold_outreach status (fallback), plus relative timing. */
function coldCadenceLabel(opts: {
  cadenceState: string | null;
  cadenceNextDueAt: Date | null;
  classification: string | null;
  status: string;
  lastTouchAt: Date | null;
  now: Date;
}): string {
  const { cadenceState, cadenceNextDueAt, classification, status, lastTouchAt, now } = opts;
  if (cadenceState) {
    let base = CADENCE_STATE_LABEL[cadenceState] ?? cadenceState.replace(/_/g, " ");
    // A warm thread with a confirmed classification leads with the reply.
    if (cadenceState.startsWith("warm") && classification && classification !== "unclassified") {
      base = `Replied: ${classification.replace(/_/g, " ")}`;
    }
    const parts = [base];
    const rel = relativeDayLabel(lastTouchAt, now);
    if (rel) parts.push(rel);
    const due = dueDayLabel(cadenceNextDueAt, now);
    if (due) parts.push(`next ${due}`);
    return parts.join(" - ");
  }
  const base = COLD_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
  const rel = relativeDayLabel(lastTouchAt, now);
  return rel ? `${base} - ${rel}` : base;
}

export async function loadColdOutreach(cityCampaignId: string): Promise<
  Array<{
    entryId: string;
    venueId: string;
    venueName: string;
    venueEmail: string | null;
    venuePhone: string | null;
    venueWebsite: string | null;
    venueInstagramHandle: string | null;
    /**
     * Free-text opening hours from the venue record. Used to compute
     * a "Best call: 2-3 PM" hint via lib/parse-venue-hours.ts. NULL
     * when the venue hasn't had hours entered yet (most venues
     * pre-migration-0025).
     */
    venueHours: string | null;
    /**
     * venues.venue_type tag array (["bar", "club", ...]). Fed into
     * the call-window heuristic as a fallback when hours parse is
     * incomplete.
     */
    venueType: string[];
    /**
     * IANA timezone of the venue's city (from cities.timezone).
     * Used by the call-window suggester so the "currently open" check
     * reflects the VENUE's local time, not the browser's. Critical
     * when operators in PH (UTC+8) look at venues in Toronto
     * (Eastern); without this they'd see "open now" for a venue
     * that's actually closed.
     */
    venueTimezone: string;
    cityName: string | null;
    venueUpdatedAt: string;
    zeroBounceStatus: string | null;
    status: string;
    /** Warm-leads flag (migration 0082). Independent of status. */
    isWarm: boolean;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    remarks: string | null;
    lastTouchAt: Date | null;
    /**
     * Count of unanswered call attempts (no_answer + voicemail +
     * wrong_number) for this venue in the past 60 days. Used to render
     * a "Calls: N/5" badge so operators see how close they are to the
     * 5-attempt cap that auto-flips status to 'unreachable'. See
     * migration 0024 + the cap logic in quo-actions.ts.
     */
    callAttempts: number;
    /**
     * Escalation workflow (#027 / migration 0027). When non-null, this
     * entry has been flagged for a senior staffer's attention. The
     * cold-outreach row renders an "Escalated to X" pill + the entry
     * feeds the dashboard widget for the escalation assignee.
     */
    escalatedToStaffId: string | null;
    escalatedToName: string | null;
    escalatedAt: string | null;
    escalationNotes: string | null;
    /**
     * AI lead score (Haiku ROI #5). 0..100 conversion-likelihood
     * score with a 1-line reason. Drives the default sort on the
     * cold-outreach table when present. NULL = not scored yet.
     */
    aiLeadScore: number | null;
    aiLeadScoreReason: string | null;
    aiLeadScoreAt: Date | null;
    /** Cadence-aware row state label (Phase 2.12): the venue's thread
     *  cadence_state for this campaign (rich) or the cold-outreach status
     *  (fallback), with relative timing. */
    cadenceLabel: string;
  }>
> {
  await requireStaff();
  // Aliased second join to staff_members for the escalation assignee
  // (the primary join below is for the entry's regular assignedStaffId).
  // Drizzle alias lets the typed select pull both names cleanly.
  const escalatedStaff = alias(staffMembers, "escalated_staff");
  const rows = await db
    .select({
      entryId: coldOutreachEntries.id,
      venueId: venues.id,
      venueName: venues.name,
      venueEmail: venues.email,
      venuePhone: venues.phoneE164,
      venueWebsite: venues.websiteUrl,
      venueInstagramHandle: venues.instagramHandle,
      venueHours: venues.hours,
      venueType: venues.venueType,
      cityName: cities.name,
      venueTimezone: cities.timezone,
      venueUpdatedAt: venues.updatedAt,
      status: coldOutreachEntries.status,
      isWarm: coldOutreachEntries.isWarm,
      assignedStaffId: coldOutreachEntries.assignedStaffId,
      assignedStaffName: staffMembers.displayName,
      remarks: coldOutreachEntries.remarks,
      lastTouchAt: coldOutreachEntries.lastTouchAt,
      escalatedToStaffId: coldOutreachEntries.escalatedToStaffId,
      escalatedToName: escalatedStaff.displayName,
      escalatedAt: coldOutreachEntries.escalatedAt,
      escalationNotes: coldOutreachEntries.escalationNotes,
      aiLeadScore: coldOutreachEntries.aiLeadScore,
      aiLeadScoreReason: coldOutreachEntries.aiLeadScoreReason,
      aiLeadScoreAt: coldOutreachEntries.aiLeadScoreAt,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(staffMembers, eq(staffMembers.id, coldOutreachEntries.assignedStaffId))
    .leftJoin(escalatedStaff, eq(escalatedStaff.id, coldOutreachEntries.escalatedToStaffId))
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
      WHERE email IN ${emails.map((e) => e.toLowerCase())}
    `);
    const list: Array<{ email: string; status: string }> = Array.isArray(validations)
      ? (validations as unknown as Array<{ email: string; status: string }>)
      : ((validations as unknown as { rows: Array<{ email: string; status: string }> }).rows ?? []);
    zbMap = new Map(list.map((v) => [v.email, v.status]));
  }

  // Call-attempt counts per venue (60-day window). Pulled in a single
  // aggregate query so we don't fan-out N+1 selects against
  // outreach_log. Mapped to a Map<venueId, count> for O(1) lookup
  // during the return mapping.
  const venueIds = rows.map((r) => r.venueId);
  const callCountMap = new Map<string, number>();
  if (venueIds.length > 0) {
    const cutoff = new Date(Date.now() - 60 * 86_400_000);
    const callCountRows = await db.execute<{ venue_id: string; n: number }>(sql`
      SELECT venue_id::text AS venue_id, COUNT(*)::int AS n
      FROM outreach_log
      WHERE channel = 'call'
        AND outcome IN ('no_answer', 'voicemail', 'wrong_number')
        AND created_at >= ${cutoff.toISOString()}
        AND venue_id IN ${venueIds}
      GROUP BY venue_id
    `);
    const callList: Array<{ venue_id: string; n: number }> = Array.isArray(callCountRows)
      ? (callCountRows as unknown as Array<{ venue_id: string; n: number }>)
      : ((callCountRows as unknown as { rows: Array<{ venue_id: string; n: number }> }).rows ?? []);
    for (const row of callList) callCountMap.set(row.venue_id, row.n);
  }

  // Cadence state per venue (Phase 2.12): the most-recent email_thread for this
  // campaign carries cadence_state + next-due + classification. DISTINCT ON picks
  // the latest thread per venue. Single query -> Map for O(1) lookup.
  type CadenceRow = {
    venue_id: string;
    cadence_state: string | null;
    cadence_next_due_at: string | null;
    classification: string | null;
  };
  const cadenceMap = new Map<
    string,
    { cadenceState: string | null; cadenceNextDueAt: Date | null; classification: string | null }
  >();
  if (venueIds.length > 0) {
    const cadenceRows = await db.execute<CadenceRow>(sql`
      SELECT DISTINCT ON (venue_id)
        venue_id::text AS venue_id,
        cadence_state::text AS cadence_state,
        cadence_next_due_at,
        classification::text AS classification
      FROM email_threads
      WHERE city_campaign_id = ${cityCampaignId}
        AND venue_id IN ${venueIds}
      ORDER BY venue_id, last_message_at DESC
    `);
    const cadenceList: CadenceRow[] = Array.isArray(cadenceRows)
      ? (cadenceRows as unknown as CadenceRow[])
      : ((cadenceRows as unknown as { rows: CadenceRow[] }).rows ?? []);
    for (const row of cadenceList) {
      cadenceMap.set(row.venue_id, {
        cadenceState: row.cadence_state,
        cadenceNextDueAt: row.cadence_next_due_at ? new Date(row.cadence_next_due_at) : null,
        classification: row.classification,
      });
    }
  }
  const now = new Date();

  return rows.map((r) => ({
    entryId: r.entryId,
    venueId: r.venueId,
    venueName: r.venueName,
    venueEmail: r.venueEmail,
    venuePhone: r.venuePhone,
    venueWebsite: r.venueWebsite,
    venueInstagramHandle: r.venueInstagramHandle,
    venueHours: r.venueHours,
    venueType: r.venueType,
    cityName: r.cityName,
    // cities.timezone is NOT NULL in schema, but LEFT JOIN means r could
    // have a null cities row (a venue without a city — edge case). Fall
    // back to Toronto since 95% of the team's venues are Eastern.
    venueTimezone: r.venueTimezone ?? "America/Toronto",
    venueUpdatedAt: r.venueUpdatedAt.toISOString(),
    zeroBounceStatus: r.venueEmail ? (zbMap.get(r.venueEmail.toLowerCase()) ?? null) : null,
    status: r.status as string,
    isWarm: r.isWarm,
    assignedStaffId: r.assignedStaffId,
    assignedStaffName: r.assignedStaffName,
    remarks: r.remarks,
    lastTouchAt: r.lastTouchAt,
    callAttempts: callCountMap.get(r.venueId) ?? 0,
    escalatedToStaffId: r.escalatedToStaffId,
    escalatedToName: r.escalatedToName,
    escalatedAt: r.escalatedAt ? r.escalatedAt.toISOString() : null,
    escalationNotes: r.escalationNotes,
    aiLeadScore: r.aiLeadScore,
    aiLeadScoreReason: r.aiLeadScoreReason,
    aiLeadScoreAt: r.aiLeadScoreAt,
    cadenceLabel: coldCadenceLabel({
      cadenceState: cadenceMap.get(r.venueId)?.cadenceState ?? null,
      cadenceNextDueAt: cadenceMap.get(r.venueId)?.cadenceNextDueAt ?? null,
      classification: cadenceMap.get(r.venueId)?.classification ?? null,
      status: r.status as string,
      lastTouchAt: r.lastTouchAt,
      now,
    }),
  }));
}

// =========================================================================
// commitVenueField — inline-edit name / email / phone on the venue record
// =========================================================================
//
// Distinct from updateColdOutreachField (which edits the outreach_entries
// row). This action mutates the underlying venues record so the change
// shows up everywhere — city sheet, audit log, all crawls — not just on
// the cold outreach table.
//
// Kept thin on purpose: the full updateVenue action validates the entire
// venue payload, which is overkill for a single-field inline edit. This
// version validates only the field being edited.

const commitVenueFieldSchema = z.object({
  venueId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  field: z.enum(["name", "email", "phoneE164"]),
  // value can be "" → clears the email/phone field. formToObject in
  // lib/form-utils.ts maps empty strings to undefined to support
  // .optional() on most schemas, which made clearing this field via the
  // inline cell fail with "Invalid payload." We treat undefined as ""
  // here so deletes work through the same code path as edits.
  value: z.union([z.string().max(500), z.undefined()]).transform((v) => v ?? ""),
  cityCampaignId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  // Optimistic-lock token. Client captures venues.updated_at when the
  // inline cell opens; on commit, if the server's current updated_at is
  // newer, we refuse to write and return a conflict so the UI can warn
  // the operator instead of silently overwriting fresher data.
  expectedUpdatedAt: z.string().optional(),
});

export async function commitVenueField(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<
    | { venueId: string; field: string }
    | {
        conflict: true;
        currentValue: string | null;
        changedByDisplayName: string | null;
        changedAt: string;
      }
  >
> {
  const { staff } = await requireStaff();

  const parsed = commitVenueFieldSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Invalid edit payload." };
  }

  const { venueId, field, value, cityCampaignId, expectedUpdatedAt } = parsed.data;
  const trimmed = value.trim();

  // Per-field validation. Empty is allowed for email + phone (clearing
  // the field) but not for name (would orphan the record visually).
  if (field === "name" && trimmed.length === 0) {
    return { ok: false, error: "Venue name can't be empty." };
  }
  if (field === "email" && trimmed.length > 0) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { ok: false, error: "Invalid email format." };
    }
  }
  if (field === "phoneE164" && trimmed.length > 0) {
    const stripped = trimmed.replace(/[\s\-().]/g, "");
    if (!/^\+?[1-9]\d{6,14}$/.test(stripped)) {
      return { ok: false, error: "Invalid phone. Use E.164 (e.g. +14165551234)." };
    }
  }

  // -------------------------------------------------------------
  // Optimistic conflict check — refuse to overwrite fresher data
  // -------------------------------------------------------------
  if (expectedUpdatedAt) {
    const fresh = await db.execute<{
      updated_at: string;
      name: string;
      email: string | null;
      phone_e164: string | null;
      updated_by_name: string | null;
    }>(sql`
      SELECT
        v.updated_at::text AS updated_at,
        v.name,
        v.email,
        v.phone_e164,
        sm.display_name AS updated_by_name
      FROM venues v
      LEFT JOIN users sm ON sm.id = v.updated_by
      WHERE v.id = ${venueId}
      LIMIT 1
    `);
    type FreshRow = {
      updated_at: string;
      name: string;
      email: string | null;
      phone_e164: string | null;
      updated_by_name: string | null;
    };
    const freshList: FreshRow[] = Array.isArray(fresh)
      ? (fresh as unknown as FreshRow[])
      : ((fresh as unknown as { rows: FreshRow[] }).rows ?? []);
    const current = freshList[0];

    if (current) {
      const serverMs = new Date(current.updated_at).getTime();
      const clientMs = new Date(expectedUpdatedAt).getTime();
      // 100ms slack absorbs DB-vs-JS clock skew on the same request
      if (Number.isFinite(serverMs) && Number.isFinite(clientMs) && serverMs > clientMs + 100) {
        // Only flag a conflict if the field the operator is editing is
        // the one that changed. If JC updated email and the current
        // operator is editing name, there's no actual conflict.
        const currentValue =
          field === "name" ? current.name : field === "email" ? current.email : current.phone_e164;
        return {
          ok: true,
          data: {
            conflict: true,
            currentValue,
            changedByDisplayName: current.updated_by_name,
            changedAt: current.updated_at,
          },
        };
      }
    }
  }

  // Map external 'email' / 'phoneE164' to the DB column names. Drizzle
  // schema uses 'email' + 'phoneE164' already, so this is a 1:1 map.
  const patch: Partial<typeof venues.$inferInsert> = {
    updatedBy: staff.id,
  };
  if (field === "name") patch.name = trimmed;
  else if (field === "email") patch.email = trimmed || null;
  else if (field === "phoneE164") {
    const stripped = trimmed.replace(/[\s\-().]/g, "");
    patch.phoneE164 = stripped || null;
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.update(venues).set(patch).where(eq(venues.id, venueId)),
    );

    // When email changes, kick off ZeroBounce in the background just
    // like the full updateVenue path does.
    if (field === "email" && trimmed.length > 0) {
      const { validateEmailInBackground } = await import("@/lib/zerobounce");
      validateEmailInBackground(trimmed, staff.id);
    }

    revalidatePath(`/city-campaigns/${cityCampaignId}`);
    return { ok: true, data: { venueId, field } };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return {
        ok: false,
        error: "Another venue already has that value. Pick something unique.",
      };
    }
    logger.error({ err, venueId, field }, "commitVenueField failed");
    return { ok: false, error: "Couldn't save. Try again." };
  }
}

// =========================================================================
// createFollowUpFromRemark — turn a detected remark date into a real task
// =========================================================================
//
// Called when the operator clicks the "Schedule follow-up: <when>" chip
// that appears after detectRemarkFollowUp finds a time phrase in their
// remark. Creates a task assigned to the entry's current assignee (or
// the acting operator if unassigned), due at the parsed time, and bumps
// the entry status to follow_up_due so the pipeline reflects it.

const createFollowUpSchema = z.object({
  entryId: uuid,
  dueAtIso: z.string().datetime(),
  /** The remark text — becomes the task description for context. */
  note: z.string().max(2000).optional(),
});

export async function createFollowUpFromRemark(
  input: z.infer<typeof createFollowUpSchema>,
): Promise<ActionResult<{ taskId: string }>> {
  const { staff } = await requireStaff();
  const parsed = createFollowUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid follow-up payload." };
  const { entryId, dueAtIso, note } = parsed.data;

  // Pull venue + city + current assignee context for the task.
  const [ctx] = await db
    .select({
      cityCampaignId: coldOutreachEntries.cityCampaignId,
      assignedStaffId: coldOutreachEntries.assignedStaffId,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      cityRegion: cities.region,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(eq(coldOutreachEntries.id, entryId))
    .limit(1);

  if (!ctx) return { ok: false, error: "Entry not found." };

  const cityLabel = ctx.cityRegion ? `${ctx.cityName}, ${ctx.cityRegion}` : ctx.cityName;
  const assignee = ctx.assignedStaffId ?? staff.id;

  try {
    const taskId = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(tasks)
        .values({
          title: `Follow up: ${ctx.venueName} (${cityLabel})`,
          description: note?.trim()
            ? `From remark: "${note.trim()}"`
            : `Follow-up for ${ctx.venueName}`,
          source: "smart_note",
          status: "pending",
          targetType: "venue",
          targetId: ctx.venueId,
          assignedStaffId: assignee,
          dueAt: new Date(dueAtIso),
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: tasks.id });

      // Bump status to follow_up_due so the pipeline reflects the
      // scheduled follow-up (no-op if already there).
      await tx
        .update(coldOutreachEntries)
        .set({ status: "follow_up_due", updatedBy: staff.id, lastTouchAt: new Date() })
        .where(eq(coldOutreachEntries.id, entryId));

      return row?.id ?? "";
    });

    if (!taskId) throw new Error("task insert returned no id");

    revalidatePath(`/city-campaigns/${ctx.cityCampaignId}`);
    revalidatePath("/tasks");
    return { ok: true, data: { taskId } };
  } catch (err) {
    logger.error({ err, entryId }, "createFollowUpFromRemark failed");
    return { ok: false, error: "Couldn't create follow-up task." };
  }
}

// =========================================================================
// AI lead-score backfill (Haiku ROI #5)
// =========================================================================

/**
 * Score un-scored OR stale cold-outreach entries in this city
 * campaign. Each invocation processes up to 200 rows (10 batches
 * of 20); the caller re-runs when hasMore is true.
 *
 * Caller MUST be authenticated; gating by role lives one layer up
 * (the UI is only rendered for admins). The action revalidates
 * the campaign page so new scores show up immediately.
 */
export async function backfillLeadScoresForCampaign(input: {
  cityCampaignId: string;
}): Promise<
  ActionResult<{
    scanned: number;
    scored: number;
    failed: number;
    batches: number;
    hasMore: boolean;
  }>
> {
  const { staff } = await requireStaff();
  if (!input.cityCampaignId) return { ok: false, error: "cityCampaignId is required." };

  try {
    const result = await backfillLeadScores({
      staffId: staff.id,
      cityCampaignId: input.cityCampaignId,
    });
    // Reach the city-campaign page from any of the standard routes
    // so the cold-outreach table re-renders with the fresh scores.
    revalidatePath(`/city-campaigns/${input.cityCampaignId}`);
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, cityCampaignId: input.cityCampaignId }, "lead score backfill failed");
    return { ok: false, error: "Lead score backfill failed." };
  }
}

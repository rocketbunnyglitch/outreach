"use server";

/**
 * Venue x outreach-brand relationship server actions (Phase 3.8) -- set/update
 * and clear a venue's relationship flag for a given brand from the venue detail
 * page. These are the MANUAL operator writes (set_by = 'manual_operator');
 * auto writes from the classifier land via a separate path in Phase 3.9.
 *
 * setByStaffId is server-derived from the session, never trusted from the form.
 * Writes go through withAuditContext so the audit_log trigger records who.
 * [ReferenceDoc 3.3]
 */

import {
  RELATIONSHIP_STATUSES,
  type RelationshipStatus,
  outreachBrands,
  venueDomainRelationships,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Upsert the (venue, brand) relationship. Conflict on (venue_id,
 * outreach_brand_id) updates in place so there's at most one row per pair.
 * Clears auto_clear_at on a manual set -- an operator decision is not a
 * time-boxed auto-flag.
 */
export async function setVenueRelationship(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ status: RelationshipStatus }>> {
  const { staff } = await requireStaff();
  const venueId = String(formData.get("venueId") ?? "");
  const outreachBrandId = String(formData.get("outreachBrandId") ?? "");
  const statusRaw = String(formData.get("status") ?? "");
  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length > 0 ? notesRaw.slice(0, 1000) : null;

  if (!UUID_RE.test(venueId)) return { ok: false, error: "Invalid venue id." };
  if (!UUID_RE.test(outreachBrandId)) return { ok: false, error: "Pick a brand." };
  if (!(RELATIONSHIP_STATUSES as readonly string[]).includes(statusRaw)) {
    return { ok: false, error: "Pick a status." };
  }
  const status = statusRaw as RelationshipStatus;

  try {
    const [venue] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!venue) return { ok: false, error: "Venue not found." };

    const [brand] = await db
      .select({ id: outreachBrands.id })
      .from(outreachBrands)
      .where(eq(outreachBrands.id, outreachBrandId))
      .limit(1);
    if (!brand) return { ok: false, error: "Brand not found." };

    await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(venueDomainRelationships)
        .values({
          venueId,
          outreachBrandId,
          status,
          setBy: "manual_operator",
          setByStaffId: staff.id,
          notes,
        })
        .onConflictDoUpdate({
          target: [venueDomainRelationships.venueId, venueDomainRelationships.outreachBrandId],
          set: {
            status,
            setBy: "manual_operator",
            setByStaffId: staff.id,
            notes,
            setAt: new Date(),
            autoClearAt: null,
          },
        }),
    );

    revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { status } };
  } catch (err) {
    logger.error({ err, venueId, outreachBrandId }, "setVenueRelationship failed");
    return { ok: false, error: "Unexpected database error. See server logs." };
  }
}

/** Clear (delete) a venue's relationship row for a brand. */
export async function removeVenueRelationship(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const venueId = String(formData.get("venueId") ?? "");

  if (!UUID_RE.test(id) || !UUID_RE.test(venueId)) {
    return { ok: false, error: "Invalid id." };
  }

  try {
    const deleted = await withAuditContext(staff.id, async (tx) =>
      tx
        .delete(venueDomainRelationships)
        .where(
          and(eq(venueDomainRelationships.id, id), eq(venueDomainRelationships.venueId, venueId)),
        )
        .returning({ id: venueDomainRelationships.id }),
    );
    if (deleted.length === 0) {
      return { ok: false, error: "Relationship not found or already cleared." };
    }
    revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err, id, venueId }, "removeVenueRelationship failed");
    return { ok: false, error: "Unexpected database error. See server logs." };
  }
}

"use server";

/**
 * Middle Venue Group server actions.
 *
 * Two entry points:
 *   - createMiddleVenueGroup: from the manual /middle-groups/new form
 *   - createMiddleVenueGroupFromCluster: called by the cluster builder
 *     "Save as group" button. Takes the venueIds the cluster picked +
 *     auto-fills the name/daypart based on the cluster's character.
 *
 * Both share the same underlying insert path. Members are written in the
 * same transaction so a partial insert can't leave an orphan group.
 */

import { middleVenueGroupMembers, middleVenueGroups } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import {
  type MiddleVenueGroupCreateInput,
  middleVenueGroupCreateSchema,
  middleVenueGroupMemberAddSchema,
  middleVenueGroupMemberRemoveSchema,
  middleVenueGroupUpdateSchema,
} from "@/lib/validation/middle-venue-groups";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const dbErr = err as DatabaseError;
  logger.error({ err, action }, "middle-venue-group action failed");
  if (dbErr?.code === "23505") {
    return { ok: false, error: "That venue is already in this group." };
  }
  if (dbErr?.code === "23503") {
    return { ok: false, error: "Referenced city-campaign or venue not found." };
  }
  return { ok: false, error: "Unexpected database error. See server logs." };
}

export async function createMiddleVenueGroup(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = middleVenueGroupCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: MiddleVenueGroupCreateInput = parsed.data;

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(middleVenueGroups)
        .values({
          cityCampaignId: input.cityCampaignId,
          name: input.name,
          dayPart: input.dayPart,
          notes: input.notes,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: middleVenueGroups.id });

      const newGroupId = row?.id;
      if (!newGroupId) throw new Error("group insert returned no row");

      // Attach the cluster's venues, if any
      if (input.venueIds && input.venueIds.length > 0) {
        await tx.insert(middleVenueGroupMembers).values(
          input.venueIds.map((venueId) => ({
            middleVenueGroupId: newGroupId,
            venueId,
            createdBy: staff.id,
            updatedBy: staff.id,
          })),
        );
      }

      return newGroupId;
    });

    revalidatePath("/middle-groups");
    revalidatePath(`/city-campaigns/${input.cityCampaignId}`);
    redirect(`/middle-groups/${id}`);
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    return wrapDbError(err, "createMiddleVenueGroup");
  }
}

export async function updateMiddleVenueGroup(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = middleVenueGroupUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(middleVenueGroups)
        .set({
          name: input.name,
          dayPart: input.dayPart,
          notes: input.notes,
          status: input.status ?? "planning",
          updatedBy: staff.id,
        })
        .where(
          and(eq(middleVenueGroups.id, input.id), eq(middleVenueGroups.version, input.version)),
        )
        .returning({ id: middleVenueGroups.id });
      return updated.length === 1;
    });

    if (!result) {
      return {
        ok: false,
        error: "Group was modified by someone else. Refresh and try again.",
      };
    }

    revalidatePath("/middle-groups");
    revalidatePath(`/middle-groups/${input.id}`);
    return { ok: true, data: { id: input.id } };
  } catch (err) {
    return wrapDbError(err, "updateMiddleVenueGroup");
  }
}

export async function addVenueToMiddleGroup(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = middleVenueGroupMemberAddSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Validation failed." };
  }
  const input = parsed.data;

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(middleVenueGroupMembers)
        .values({
          middleVenueGroupId: input.middleVenueGroupId,
          venueId: input.venueId,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: middleVenueGroupMembers.id });
      return row?.id ?? "";
    });
    revalidatePath(`/middle-groups/${input.middleVenueGroupId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "addVenueToMiddleGroup");
  }
}

export async function removeVenueFromMiddleGroup(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = middleVenueGroupMemberRemoveSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Validation failed." };
  }

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const deleted = await tx
        .delete(middleVenueGroupMembers)
        .where(eq(middleVenueGroupMembers.id, parsed.data.id))
        .returning({
          id: middleVenueGroupMembers.id,
          middleVenueGroupId: middleVenueGroupMembers.middleVenueGroupId,
        });
      return deleted[0] ?? null;
    });

    if (!result) {
      return { ok: false, error: "Member not found or already removed." };
    }

    revalidatePath(`/middle-groups/${result.middleVenueGroupId}`);
    return { ok: true, data: { id: parsed.data.id } };
  } catch (err) {
    return wrapDbError(err, "removeVenueFromMiddleGroup");
  }
}

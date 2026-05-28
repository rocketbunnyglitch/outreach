"use server";

/**
 * Escalation workflow — operator session 12.
 *
 * When a venue wants to talk to someone senior (typically Brandon),
 * outreach staff escalates the cold-outreach entry. The escalation:
 *
 *   1. Stamps the entry with (escalated_to_staff_id, escalated_at,
 *      escalation_notes).
 *   2. Auto-creates a task assigned to that staff member with rich
 *      context (venue + city + concerns + due date if parsed).
 *   3. Future commits will layer:
 *        - email notification to the assignee
 *        - dashboard widget for "escalated to me"
 *        - "Escalated to Brandon" tab/filter chip
 *
 * Idempotency
 * -----------
 * Re-escalating an already-escalated entry replaces the previous
 * stamps + creates a fresh task. The old task remains in the system
 * (we never auto-complete it) so the escalation history is preserved
 * — useful when an escalation is initially declined and re-tried.
 *
 * Un-escalation
 * -------------
 * Setting all three escalation columns to NULL clears the flag (the
 * row drops off "escalated to me" filters). The associated task is
 * left alone — the assignee decides whether to complete it or close
 * it as unnecessary.
 */

import { cityCampaigns } from "@/db/schema/city-campaigns";
import { coldOutreachEntries } from "@/db/schema/cold-outreach";
import { cities } from "@/db/schema/geography";
import { staffMembers } from "@/db/schema/staff";
import { tasks } from "@/db/schema/tasks";
import { venues } from "@/db/schema/venues";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const escalateSchema = z.object({
  entryId: z.string().uuid(),
  staffId: z.string().uuid(),
  /**
   * Free-text capture of what the venue wants to discuss + when they
   * want the call. The action does NOT try to parse a structured
   * datetime — text is preserved verbatim so the assignee sees
   * exactly what the operator heard. Future iteration can layer
   * datetime extraction for due_at on the task.
   */
  notes: z.string().min(1).max(2000),
});

export type EscalateInput = z.infer<typeof escalateSchema>;

export async function escalateColdEntry(
  input: EscalateInput,
): Promise<ActionResult<{ entryId: string; taskId: string }>> {
  const { staff } = await requireStaff();
  const parsed = escalateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid escalation payload",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { entryId, staffId, notes } = parsed.data;

  // Pull venue + city context for the auto-task. One round-trip with
  // joins instead of 3 separate selects.
  const [contextRow] = await db
    .select({
      entryId: coldOutreachEntries.id,
      venueId: venues.id,
      venueName: venues.name,
      venuePhone: venues.phoneE164,
      venueEmail: venues.email,
      cityName: cities.name,
      cityRegion: cities.region,
      assigneeName: staffMembers.displayName,
      assigneeEmail: staffMembers.primaryEmail,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(staffMembers, eq(staffMembers.id, staffId))
    .where(eq(coldOutreachEntries.id, entryId))
    .limit(1);

  if (!contextRow) {
    return { ok: false, error: "Cold-outreach entry or assignee not found" };
  }

  const cityLabel = contextRow.cityRegion
    ? `${contextRow.cityName}, ${contextRow.cityRegion}`
    : contextRow.cityName;

  // Build the auto-task description. The assignee sees this directly
  // in /tasks — every piece of context Brandon would need to make
  // the call without having to look anything else up.
  const description = [
    `Escalated by ${staff.displayName} on ${new Date().toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}`,
    "",
    `Venue: ${contextRow.venueName}`,
    `City: ${cityLabel}`,
    contextRow.venuePhone ? `Phone: ${contextRow.venuePhone}` : null,
    contextRow.venueEmail ? `Email: ${contextRow.venueEmail}` : null,
    "",
    "What the venue wants to discuss:",
    notes,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const taskId = await withAuditContext(staff.id, async (tx) => {
      // 1. Stamp the cold-outreach entry. Updated together with the
      // task insert so a failure mid-way doesn't leave a half-state
      // ("flagged as escalated but no task created").
      await tx
        .update(coldOutreachEntries)
        .set({
          escalatedToStaffId: staffId,
          escalatedAt: new Date(),
          escalationNotes: notes,
          updatedBy: staff.id,
        })
        .where(eq(coldOutreachEntries.id, entryId));

      // 2. Create the assigned task. targetType="venue" + targetId=
      // venueId so the task links back to the venue detail page when
      // the assignee clicks through.
      const [row] = await tx
        .insert(tasks)
        .values({
          title: `Escalation: ${contextRow.venueName} (${cityLabel})`,
          description,
          source: "manual",
          status: "pending",
          targetType: "venue",
          targetId: contextRow.venueId,
          assignedStaffId: staffId,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: tasks.id });

      return row?.id ?? "";
    });

    if (!taskId) throw new Error("task insert returned no id");

    logger.info(
      {
        entryId,
        venueId: contextRow.venueId,
        venueName: contextRow.venueName,
        assigneeStaffId: staffId,
        assigneeName: contextRow.assigneeName,
        assigneeEmail: contextRow.assigneeEmail,
        escalatedByStaffId: staff.id,
        taskId,
      },
      "cold-outreach escalation created",
    );

    revalidatePath(`/city-campaigns/${entryId}`);
    revalidatePath("/tasks");
    revalidatePath("/"); // dashboard

    return { ok: true, data: { entryId, taskId } };
  } catch (err) {
    logger.error({ err, entryId, staffId }, "escalateColdEntry failed");
    return { ok: false, error: "Failed to escalate. See server logs." };
  }
}

/**
 * Clear escalation flag — used when an escalation is no longer
 * needed (the operator handled it themselves, or it was triggered
 * in error). Does NOT auto-complete the associated task; the
 * assignee can close it manually.
 */
export async function clearColdEntryEscalation(
  entryId: string,
): Promise<ActionResult<{ entryId: string }>> {
  const { staff } = await requireStaff();
  if (!entryId || typeof entryId !== "string") {
    return { ok: false, error: "Invalid entry id" };
  }

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(coldOutreachEntries)
        .set({
          escalatedToStaffId: null,
          escalatedAt: null,
          escalationNotes: null,
          updatedBy: staff.id,
        })
        .where(eq(coldOutreachEntries.id, entryId)),
    );

    logger.info({ entryId, clearedByStaffId: staff.id }, "cold-outreach escalation cleared");

    revalidatePath(`/city-campaigns/${entryId}`);
    return { ok: true, data: { entryId } };
  } catch (err) {
    logger.error({ err, entryId }, "clearColdEntryEscalation failed");
    return { ok: false, error: "Failed to clear escalation." };
  }
}

/**
 * Convenience helper used by UI: load the list of staff members
 * eligible to receive an escalation. Currently any non-readonly
 * active staffer can be escalated to, sorted by role priority then
 * name (admin first, then leads, then outreach).
 *
 * In practice the UI defaults to Brandon (admin/lead) but we don't
 * hard-code his ID — if he's ever offboarded or another lead takes
 * over, the list adapts automatically.
 */
const ROLE_PRIORITY: Record<string, number> = {
  admin: 0,
  lead: 1,
  outreach: 2,
  readonly: 99,
};

export async function loadEscalationTargets(): Promise<
  Array<{ id: string; displayName: string; role: string; primaryEmail: string }>
> {
  await requireStaff();
  const rows = await db
    .select({
      id: staffMembers.id,
      displayName: staffMembers.displayName,
      role: staffMembers.role,
      primaryEmail: staffMembers.primaryEmail,
      status: staffMembers.status,
    })
    .from(staffMembers)
    .where(and(eq(staffMembers.status, "active")));

  return rows
    .filter((r) => r.role !== "readonly")
    .map((r) => ({
      id: r.id,
      displayName: r.displayName,
      role: r.role,
      primaryEmail: r.primaryEmail,
    }))
    .sort((a, b) => {
      const ra = ROLE_PRIORITY[a.role] ?? 50;
      const rb = ROLE_PRIORITY[b.role] ?? 50;
      if (ra !== rb) return ra - rb;
      return a.displayName.localeCompare(b.displayName);
    });
}

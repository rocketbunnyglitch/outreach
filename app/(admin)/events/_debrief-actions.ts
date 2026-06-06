"use server";

/**
 * Operator post-event debrief notes (Phase 6.4, migration 0118).
 *
 * A single free-text debrief per event, edited in place after the crawl runs.
 * Last-writer-wins; we stamp debrief_updated_at / debrief_updated_by so the team
 * can see who last touched it and when. Distinct from the author-attributed
 * notes table -- this is one running field, not a thread of notes.
 */

import { events } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEN = 16_000;

export async function saveDebriefNotes(input: {
  eventId: string;
  notes: string;
}): Promise<ActionResult<{ updatedAt: string }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(input.eventId)) return { ok: false, error: "Invalid event id." };

  const trimmed = (input.notes ?? "").slice(0, MAX_LEN);
  // Empty string clears the debrief; null-out the field rather than store "".
  const value = trimmed.trim().length === 0 ? null : trimmed;
  const now = new Date();

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx
        .update(events)
        .set({
          debriefNotes: value,
          debriefUpdatedAt: now,
          debriefUpdatedBy: staff.id,
          updatedBy: staff.id,
        })
        .where(eq(events.id, input.eventId)),
    );
    revalidatePath(`/events/${input.eventId}`);
    return { ok: true, data: { updatedAt: now.toISOString() } };
  } catch (err) {
    logger.error({ err, eventId: input.eventId }, "saveDebriefNotes failed");
    return { ok: false, error: "Couldn't save the debrief." };
  }
}

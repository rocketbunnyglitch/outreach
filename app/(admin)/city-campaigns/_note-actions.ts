"use server";

/**
 * Per-crawl notes. A crawl is an `events` row; notes attach to it via
 * the polymorphic notes table (target_type='event'). Thin wrappers
 * around the shared note create/delete logic + listNotes, scoped to a
 * single event and revalidating the city sheet.
 *
 * Operator session-12 P3: "per-crawl notes when the city is expanded."
 */

import { events, notes } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { type NoteRow, listNotes } from "@/lib/notes";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export async function loadCrawlNotes(input: { eventId: string }): Promise<NoteRow[]> {
  const { staff } = await requireStaff();
  const parsed = z.object({ eventId: uuid }).safeParse(input);
  if (!parsed.success) return [];
  return listNotes("event", parsed.data.eventId, staff.id);
}

const addSchema = z.object({
  eventId: uuid,
  cityCampaignId: uuid,
  body: z.string().trim().min(1, "Required").max(8000),
});

export async function addCrawlNote(
  input: z.infer<typeof addSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Note can't be empty." };
  const { eventId, cityCampaignId, body } = parsed.data;

  // Confirm the event exists (polymorphic target — no FK to lean on).
  const [ev] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!ev) return { ok: false, error: "That crawl no longer exists." };

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(notes)
        .values({
          targetType: "event",
          targetId: eventId,
          authorStaffId: staff.id,
          body,
          mentions: [],
        })
        .returning({ id: notes.id });
      return row?.id ?? "";
    });
    revalidatePath(`/city-campaigns/${cityCampaignId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err, eventId }, "addCrawlNote failed");
    return { ok: false, error: "Couldn't save the note." };
  }
}

const delSchema = z.object({
  id: uuid,
  cityCampaignId: uuid,
});

export async function deleteCrawlNote(
  input: z.infer<typeof delSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = delSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      // Author-only delete, and only event-scoped notes (defense in depth).
      const deleted = await tx
        .delete(notes)
        .where(
          and(
            eq(notes.id, parsed.data.id),
            eq(notes.authorStaffId, staff.id),
            eq(notes.targetType, "event"),
          ),
        )
        .returning({ id: notes.id });
      return deleted[0] ?? null;
    });
    if (!result) {
      return { ok: false, error: "Note not found or not yours to delete." };
    }
    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { id: parsed.data.id } };
  } catch (err) {
    logger.error({ err }, "deleteCrawlNote failed");
    return { ok: false, error: "Couldn't delete the note." };
  }
}

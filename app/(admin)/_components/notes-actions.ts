"use server";

/**
 * Notes server actions — create + soft-delete.
 *
 * Author is server-derived from the current staff session, never trusted
 * from the form. The polymorphic (target_type, target_id) pair is
 * pre-checked against the target's existence (Postgres can't do
 * polymorphic FKs).
 *
 * Notes don't get edited — typos are fixed by delete+re-type. Keeps the
 * audit trail clean.
 */

import { events, campaigns, cityCampaigns, notes, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { scanNoteAndPersistSuggestions } from "@/lib/smart-notes-actions";
import {
  type NoteCreateInput,
  type NoteDeleteInput,
  extractMentions,
  noteCreateSchema,
  noteDeleteSchema,
} from "@/lib/validation/notes";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { DatabaseError } from "pg";

function wrapDbError(err: unknown, action: string): ActionResult<never> {
  const _dbErr = err as DatabaseError;
  logger.error({ err, action }, "note action failed");
  return { ok: false, error: "Unexpected database error. See server logs." };
}

async function targetExists(
  targetType: NoteCreateInput["targetType"],
  targetId: string,
): Promise<boolean> {
  if (targetType === "venue") {
    const rows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, targetId))
      .limit(1);
    return rows.length === 1;
  }
  if (targetType === "city_campaign") {
    const rows = await db
      .select({ id: cityCampaigns.id })
      .from(cityCampaigns)
      .where(eq(cityCampaigns.id, targetId))
      .limit(1);
    return rows.length === 1;
  }
  if (targetType === "campaign") {
    const rows = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, targetId))
      .limit(1);
    return rows.length === 1;
  }
  if (targetType === "event") {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, targetId))
      .limit(1);
    return rows.length === 1;
  }
  return false;
}

async function resolveMentions(handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const rawList = `ARRAY[${handles.map((h) => `'${h.replace(/'/g, "''")}'`).join(",")}]::text[]`;
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id
    FROM users
    WHERE archived_at IS NULL AND (
      lower(split_part(primary_email, '@', 1)) = ANY(${sql.raw(rawList)})
      OR lower(regexp_replace(display_name, '[^a-zA-Z0-9]+', '', 'g')) = ANY(${sql.raw(rawList)})
    )
  `);
  const list = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows: Array<{ id: string }> }).rows ?? []);
  return list.map((r) => r.id);
}

export async function createNote(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = noteCreateSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input: NoteCreateInput = parsed.data;

  if (!(await targetExists(input.targetType, input.targetId))) {
    return {
      ok: false,
      error: `The ${input.targetType.replace("_", " ")} this note was supposed to attach to doesn't exist.`,
    };
  }

  const mentionHandles = extractMentions(input.body);
  const mentionIds = await resolveMentions(mentionHandles);

  try {
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(notes)
        .values({
          targetType: input.targetType,
          targetId: input.targetId,
          authorStaffId: staff.id,
          body: input.body,
          mentions: mentionIds,
        })
        .returning({ id: notes.id });
      return row?.id ?? "";
    });

    // Smart Notes: scan the body for actionable language + dates and
    // persist suggestions. Failure here doesn't break note creation —
    // it logs and returns 0.
    try {
      // Only scan for target types the timezone resolver supports
      if (
        input.targetType === "venue" ||
        input.targetType === "city_campaign" ||
        input.targetType === "campaign"
      ) {
        await scanNoteAndPersistSuggestions({
          noteId: id,
          noteBody: input.body,
          targetType: input.targetType,
          targetId: input.targetId,
          authorStaffId: staff.id,
        });
      }
    } catch (scanErr) {
      logger.error({ err: scanErr, noteId: id }, "smart-notes scan failed");
    }

    if (input.targetType === "venue") revalidatePath(`/venues/${input.targetId}`);
    if (input.targetType === "city_campaign") revalidatePath(`/city-campaigns/${input.targetId}`);
    if (input.targetType === "campaign") revalidatePath(`/campaigns/${input.targetId}`);
    if (input.targetType === "event") {
      // Per-crawl notes render on the city sheet, keyed by the event's
      // city_campaign. Look it up to revalidate the right path.
      const [ev] = await db
        .select({ cityCampaignId: events.cityCampaignId })
        .from(events)
        .where(eq(events.id, input.targetId))
        .limit(1);
      if (ev?.cityCampaignId) revalidatePath(`/city-campaigns/${ev.cityCampaignId}`);
    }

    return { ok: true, data: { id } };
  } catch (err) {
    return wrapDbError(err, "createNote");
  }
}

export async function deleteNote(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = noteDeleteSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Validation failed." };
  }
  const input: NoteDeleteInput = parsed.data;

  try {
    // Hard delete — notes are designed for it (no version, no archived_at).
    // The audit_log trigger will still record the DELETE so the trail isn't lost.
    const result = await withAuditContext(staff.id, async (tx) => {
      // Only the author can delete their own note. Other staff need an admin.
      const deleted = await tx
        .delete(notes)
        .where(and(eq(notes.id, input.id), eq(notes.authorStaffId, staff.id)))
        .returning({
          id: notes.id,
          targetType: notes.targetType,
          targetId: notes.targetId,
        });
      return deleted[0] ?? null;
    });

    if (!result) {
      return {
        ok: false,
        error: "Note not found, already deleted, or not yours to delete.",
      };
    }

    if (result.targetType === "venue") revalidatePath(`/venues/${result.targetId}`);
    if (result.targetType === "city_campaign") revalidatePath(`/city-campaigns/${result.targetId}`);
    if (result.targetType === "campaign") revalidatePath(`/campaigns/${result.targetId}`);
    if (result.targetType === "event") {
      const [ev] = await db
        .select({ cityCampaignId: events.cityCampaignId })
        .from(events)
        .where(eq(events.id, result.targetId))
        .limit(1);
      if (ev?.cityCampaignId) revalidatePath(`/city-campaigns/${ev.cityCampaignId}`);
    }

    return { ok: true, data: { id: input.id } };
  } catch (err) {
    return wrapDbError(err, "deleteNote");
  }
}

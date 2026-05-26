"use server";

/**
 * Smart-notes server actions.
 *
 * Lifecycle:
 *   - Note created/updated → scanNoteAndPersistSuggestions writes new
 *     suggestions to the table. Dismissed suggestions from a different
 *     content-hash stay dismissed. Pending suggestions with the same
 *     content-hash are kept (so a page reload doesn't churn the list).
 *   - Operator clicks Create → acceptSuggestion creates a tasks row,
 *     sets status='accepted' + task_id on the suggestion
 *   - Operator clicks Dismiss → dismissSuggestion sets status='dismissed'
 */

import { noteActionSuggestions, tasks } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { resolveNoteTimezone } from "@/lib/note-timezone";
import type { ActionType } from "@/lib/smart-notes";
import { extractActionsFromNote, hashNoteContent } from "@/lib/smart-notes";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Maps smart-note ActionType to tasks.target_type. Some smart-note
 * categories don't have a dedicated target_type in the tasks enum
 * (it has only: venue_event, venue, city_campaign, wristband, misc),
 * so we fall back to 'misc' and rely on the title to convey intent.
 */
function actionTypeToTaskTarget(
  actionType: ActionType,
): "venue_event" | "venue" | "city_campaign" | "wristband" | "misc" {
  switch (actionType) {
    case "wristband_task":
      return "wristband";
    case "call":
    case "venue_callback":
    case "follow_up_email":
    case "missing_info_task":
      return "venue";
    case "confirmation_reminder":
    case "poster_send":
      return "venue_event";
    default:
      return "misc";
  }
}

interface ScanOpts {
  noteId: string;
  noteBody: string;
  targetType: "venue" | "venue_event" | "city_campaign" | "campaign" | "event";
  targetId: string;
  authorStaffId: string;
}

/**
 * Re-scan a note and persist any NEW suggestions to the table.
 *
 * Idempotent on content hash: if we've already scanned this body and
 * created suggestions, we don't duplicate them. Dismissed suggestions
 * tied to a previous hash stay dismissed.
 *
 * Returns the count of new suggestions inserted.
 */
export async function scanNoteAndPersistSuggestions(opts: ScanOpts): Promise<{ inserted: number }> {
  const contentHash = hashNoteContent(opts.noteBody);

  // Resolve TZ + default venue ID + phone for the suggestion
  const ctx = await resolveNoteTimezone({
    targetType: opts.targetType,
    targetId: opts.targetId,
    authorStaffId: opts.authorStaffId,
  });

  // Run the extractor
  const extracted = extractActionsFromNote({
    text: opts.noteBody,
    timezone: ctx.timezone,
  });

  if (extracted.length === 0) {
    return { inserted: 0 };
  }

  // Skip suggestions that already exist for the same (noteId, hash, action_type, due_at)
  // Letting the operator see suggestions they've already dismissed for THIS hash
  // would be annoying. Across hashes (i.e. note edits), dismissed ones stay dismissed.
  const existing = await db
    .select({
      actionType: noteActionSuggestions.actionType,
      dueAt: noteActionSuggestions.dueAt,
      contentHash: noteActionSuggestions.noteContentHash,
      status: noteActionSuggestions.status,
    })
    .from(noteActionSuggestions)
    .where(eq(noteActionSuggestions.noteId, opts.noteId));

  const existingKeys = new Set(
    existing.map((e) => `${e.contentHash}::${e.actionType}::${e.dueAt?.toISOString() ?? "null"}`),
  );

  const newSuggestions = extracted.filter(
    (s) =>
      !existingKeys.has(`${contentHash}::${s.actionType}::${s.dueAt?.toISOString() ?? "null"}`),
  );

  if (newSuggestions.length === 0) return { inserted: 0 };

  try {
    await withAuditContext(opts.authorStaffId, async (tx) => {
      await tx.insert(noteActionSuggestions).values(
        newSuggestions.map((s) => ({
          noteId: opts.noteId,
          noteContentHash: contentHash,
          status: "pending",
          title: s.title,
          description: s.description,
          actionType: s.actionType,
          dueAt: s.dueAt,
          timezone: s.timezone,
          venueId: ctx.venueId,
          phoneE164: ctx.phoneE164,
          confidence: s.confidence,
          sourceText: s.sourceText,
          createdBy: opts.authorStaffId,
          updatedBy: opts.authorStaffId,
        })),
      );
    });
    return { inserted: newSuggestions.length };
  } catch (err) {
    logger.error({ err, noteId: opts.noteId }, "smart-notes scan insert failed");
    return { inserted: 0 };
  }
}

/**
 * Accept a suggestion → create a tasks row + flip status to 'accepted'.
 *
 * The task is assigned to the current staffer (i.e. the person clicking
 * Create). They can reassign later from /tasks/[id].
 */
export async function acceptSuggestion(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ taskId: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing suggestion id" };

  try {
    type AcceptResult =
      | { kind: "not_found" }
      | { kind: "error"; message: string }
      | { kind: "ok"; taskId: string };

    const result: AcceptResult = await withAuditContext(staff.id, async (tx) => {
      const suggestion = await tx
        .select()
        .from(noteActionSuggestions)
        .where(eq(noteActionSuggestions.id, id))
        .limit(1)
        .then((r) => r[0]);

      if (!suggestion) return { kind: "not_found" } satisfies AcceptResult;
      if (suggestion.status !== "pending") {
        return {
          kind: "error",
          message: "Suggestion is no longer pending",
        } satisfies AcceptResult;
      }

      const targetType = actionTypeToTaskTarget(suggestion.actionType as ActionType);
      const targetId = targetType === "venue" && suggestion.venueId ? suggestion.venueId : null;

      const [taskRow] = await tx
        .insert(tasks)
        .values({
          title: suggestion.title,
          description: suggestion.description,
          source: "smart_note",
          targetType,
          targetId,
          assignedStaffId: staff.id,
          dueAt: suggestion.dueAt,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: tasks.id });

      const newTaskId = taskRow?.id;
      if (!newTaskId) {
        return {
          kind: "error",
          message: "Task insert returned no row",
        } satisfies AcceptResult;
      }

      await tx
        .update(noteActionSuggestions)
        .set({
          status: "accepted",
          taskId: newTaskId,
          updatedBy: staff.id,
        })
        .where(eq(noteActionSuggestions.id, id));

      return { kind: "ok", taskId: newTaskId } satisfies AcceptResult;
    });

    if (result.kind === "not_found") {
      return { ok: false, error: "Suggestion not found" };
    }
    if (result.kind === "error") {
      return { ok: false, error: result.message };
    }

    revalidatePath("/tasks");
    revalidatePath("/inbox");
    return { ok: true, data: { taskId: result.taskId } };
  } catch (err) {
    logger.error({ err }, "acceptSuggestion failed");
    return { ok: false, error: "Accept failed. See server logs." };
  }
}

export async function dismissSuggestion(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing suggestion id" };

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(noteActionSuggestions)
        .set({ status: "dismissed", updatedBy: staff.id })
        .where(and(eq(noteActionSuggestions.id, id), ne(noteActionSuggestions.status, "accepted")))
        .returning({ id: noteActionSuggestions.id });
      return updated[0]?.id ?? null;
    });

    if (!result) return { ok: false, error: "Suggestion not found or already accepted" };
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err }, "dismissSuggestion failed");
    return { ok: false, error: "Dismiss failed" };
  }
}

/**
 * Read helper moved to lib/smart-notes-queries.ts (server-only,
 * non-action) since it returns a Map which isn't serializable across
 * a server-action boundary.
 */

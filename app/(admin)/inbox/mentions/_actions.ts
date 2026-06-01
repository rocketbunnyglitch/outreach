"use server";

/**
 * Mentions page actions.
 *
 * acknowledgeOneMention(noteId): the single-mention version of the
 * thread-scoped acknowledge that runs automatically on thread open
 * (acknowledgeThreadMentions in lib/thread-notes.ts). Here the operator
 * dismisses one mention card at a time from the /inbox/mentions feed, so we
 * scope the update to a single note for the current user.
 */

import { emailThreadMentions } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function acknowledgeOneMention(
  noteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(noteId)) return { ok: false, error: "Invalid note id." };
  try {
    await db
      .update(emailThreadMentions)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(emailThreadMentions.noteId, noteId),
          eq(emailThreadMentions.mentionedUserId, staff.id),
          isNull(emailThreadMentions.acknowledgedAt),
        ),
      );
    revalidatePath("/inbox/mentions");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    logger.error({ err, noteId }, "acknowledgeOneMention failed");
    return { ok: false, error: "Could not acknowledge mention." };
  }
}

"use server";

/**
 * Flag/unflag the inbound email that constitutes a venue's written
 * confirmation. The venue detail card surfaces flagged messages as the proof
 * an operator can pull up in a dispute. Team-scoped via the message's thread.
 */

import { connectedAccounts, emailMessages, emailThreads } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setEmailConfirmation(
  messageId: string,
  isConfirmation: boolean,
  venueId?: string,
): Promise<ActionResult<{ messageId: string; isConfirmation: boolean }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(messageId)) return { ok: false, error: "Invalid message id." };
  try {
    // Verify the message exists + its thread is on the operator's team before
    // touching it (no cross-team writes).
    const [row] = await db
      .select({ teamId: connectedAccounts.teamId })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailMessages.id, messageId))
      .limit(1);
    if (!row) return { ok: false, error: "Message not found." };
    if (row.teamId !== staff.teamId) return { ok: false, error: "Not allowed." };

    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(emailMessages)
        .set(
          isConfirmation
            ? {
                isConfirmation: true,
                confirmationFlaggedBy: staff.id,
                confirmationFlaggedAt: new Date(),
              }
            : { isConfirmation: false, confirmationFlaggedBy: null, confirmationFlaggedAt: null },
        )
        .where(eq(emailMessages.id, messageId));
    });
    if (venueId && UUID_RE.test(venueId)) revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { messageId, isConfirmation } };
  } catch (err) {
    logger.error({ err, messageId }, "setEmailConfirmation failed");
    return { ok: false, error: "Couldn't update the confirmation flag." };
  }
}

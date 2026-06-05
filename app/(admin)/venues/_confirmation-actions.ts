"use server";

/**
 * Flag/unflag the inbound email that constitutes a venue's written
 * confirmation. The venue detail card surfaces flagged messages as the proof
 * an operator can pull up in a dispute. Team-scoped via the message's thread.
 */

import {
  connectedAccounts,
  emailMessages,
  emailThreads,
  outreachLog,
  staffMembers,
} from "@/db/schema";
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

/**
 * Flag/unflag the logged call that constitutes a venue's verbal confirmation
 * (symmetric to setEmailConfirmation, phone channel). outreach_log has no
 * team_id, so we scope via the staffer who logged the call -- the same trust
 * boundary as the call itself.
 */
export async function setCallConfirmation(
  logId: string,
  isConfirmation: boolean,
  venueId?: string,
): Promise<ActionResult<{ logId: string; isConfirmation: boolean }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(logId)) return { ok: false, error: "Invalid call id." };
  try {
    const [row] = await db
      .select({ teamId: staffMembers.teamId, channel: outreachLog.channel })
      .from(outreachLog)
      .innerJoin(staffMembers, eq(staffMembers.id, outreachLog.staffMemberId))
      .where(eq(outreachLog.id, logId))
      .limit(1);
    if (!row) return { ok: false, error: "Call not found." };
    if (row.teamId !== staff.teamId) return { ok: false, error: "Not allowed." };
    if (row.channel !== "call") return { ok: false, error: "Not a call." };

    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(outreachLog)
        .set(
          isConfirmation
            ? {
                isConfirmation: true,
                confirmationFlaggedBy: staff.id,
                confirmationFlaggedAt: new Date(),
              }
            : { isConfirmation: false, confirmationFlaggedBy: null, confirmationFlaggedAt: null },
        )
        .where(eq(outreachLog.id, logId));
    });
    if (venueId && UUID_RE.test(venueId)) revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { logId, isConfirmation } };
  } catch (err) {
    logger.error({ err, logId }, "setCallConfirmation failed");
    return { ok: false, error: "Couldn't update the confirmation flag." };
  }
}

"use server";

import { outreachBrands, staffOutreachEmails } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Disconnect a Gmail inbox by NULL-ing the refresh token and flipping
 * status to 'disconnected'. We keep the row (rather than deleting) so
 * audit history + foreign keys from email_threads stay intact.
 *
 * Only the staffer who owns the connection can disconnect it. Admins
 * could do this too in a future iteration but for now keeping it
 * staff-scoped.
 */
export async function disconnectInbox(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing inbox id" };

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(staffOutreachEmails)
        .set({
          gmailOauthRefreshToken: null,
          gmailOauthScopes: null,
          status: "disconnected",
          updatedBy: staff.id,
        })
        .where(and(eq(staffOutreachEmails.id, id), eq(staffOutreachEmails.staffMemberId, staff.id)))
        .returning({ id: staffOutreachEmails.id });
      return updated[0]?.id;
    });

    if (!result) {
      return { ok: false, error: "Inbox not found or not yours to disconnect." };
    }

    revalidatePath("/settings/inboxes");
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err }, "disconnectInbox failed");
    return { ok: false, error: "Disconnect failed. See server logs." };
  }
}

/**
 * Re-assign which outreach brand a connected email is grouped under. Lets a
 * staffer add emails freely and sort them into brands afterward, instead of
 * being locked to the brand chosen at connect time. Staff-scoped + validates
 * the target brand exists.
 */
export async function reassignInboxBrand(
  emailId: string,
  outreachBrandId: string,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(emailId) || !uuidRe.test(outreachBrandId)) {
    return { ok: false, error: "Bad id." };
  }
  try {
    const brand = await db
      .select({ id: outreachBrands.id })
      .from(outreachBrands)
      .where(eq(outreachBrands.id, outreachBrandId))
      .limit(1);
    if (!brand[0]) return { ok: false, error: "Brand not found." };

    const result = await withAuditContext(staff.id, async (tx) => {
      const updated = await tx
        .update(staffOutreachEmails)
        .set({ outreachBrandId, updatedBy: staff.id })
        .where(
          and(eq(staffOutreachEmails.id, emailId), eq(staffOutreachEmails.staffMemberId, staff.id)),
        )
        .returning({ id: staffOutreachEmails.id });
      return updated[0]?.id;
    });
    if (!result) return { ok: false, error: "Inbox not found or not yours." };

    revalidatePath("/settings/inboxes");
    return { ok: true, data: { id: result } };
  } catch (err) {
    logger.error({ err }, "reassignInboxBrand failed");
    return { ok: false, error: "Could not reassign brand. See server logs." };
  }
}

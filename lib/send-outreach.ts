"use server";

/**
 * Send Outreach Email
 *
 * Two-mode action:
 *
 * 1. LIVE MODE (when staff has connected Gmail inbox):
 *    - Calls Gmail API via lib/gmail.sendGmailMessage
 *    - Writes outreach_log row with channel=email, outcome=sent,
 *      externalId=gmail_message_id
 *    - Upserts email_threads row keyed on (gmail_thread_id, venue_id)
 *
 * 2. DEV MODE (when no Gmail connection):
 *    - Writes outreach_log row with channel=email, outcome=sent,
 *      externalId=null, notes='(dev mode: would have sent)'
 *    - This lets the operator practice the full send workflow before
 *      OAuth credentials land
 *
 * The mode toggle is per-staff-per-brand: if THIS staff has connected
 * Gmail for THIS outreach brand, live; otherwise dev. So a team can
 * roll out the integration brand-by-brand or staffer-by-staffer.
 *
 * outreach_log writes are audit-logged via withAuditContext.
 */

import { emailThreads, outreachLog, staffOutreachEmails } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { isGmailOAuthConfigured, sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { canSendNow, maybeGraduateWarmup } from "@/lib/send-throttle";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const sendEmailSchema = z.object({
  venueId: uuidSchema,
  outreachBrandId: uuidSchema,
  venueEventId: z.union([z.literal("").transform(() => undefined), uuidSchema]).optional(),
  to: z.string().email("Invalid email address"),
  subject: z.string().min(1, "Subject required").max(500),
  bodyHtml: z.string().min(1, "Body required"),
  bodyText: z.string().min(1).optional(),
  /**
   * Transactional sends bypass cold-send throttling. Used for the
   * confirmation cascade (poster delivery, 2/1-week confirms, floor
   * brief) — these go to existing relationships, not cold prospects.
   * Defaults to "cold". Operator UI never sets this; only internal
   * cascade callers do.
   */
  sendKind: z.union([z.literal("cold"), z.literal("transactional")]).default("cold"),
});

export async function sendOutreachEmail(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ outreachLogId: string; mode: "live" | "dev" }>> {
  const { staff } = await requireStaff();
  const parsed = sendEmailSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  try {
    // Look up the connected inbox for THIS staff x THIS brand
    const inbox = await db
      .select()
      .from(staffOutreachEmails)
      .where(
        and(
          eq(staffOutreachEmails.staffMemberId, staff.id),
          eq(staffOutreachEmails.outreachBrandId, input.outreachBrandId),
          eq(staffOutreachEmails.status, "connected"),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    let mode: "live" | "dev" = "dev";
    let externalId: string | null = null;
    let gmailThreadId: string | null = null;
    let notes: string | null = null;

    // Throttle check — runs in BOTH live and dev modes so operators
    // building the workflow in dev get the same caps they'll experience
    // live tomorrow. Transactional sends bypass (confirmation cascade
    // sends to existing relationships, not cold prospects).
    if (inbox) {
      const throttle = await canSendNow({
        staffOutreachEmailId: inbox.id,
        bypass: input.sendKind === "transactional",
      });
      if (!throttle.ok) {
        return {
          ok: false,
          error: throttle.reason,
        };
      }
    }

    if (inbox?.gmailOauthRefreshToken && isGmailOAuthConfigured()) {
      // LIVE MODE
      mode = "live";
      try {
        const result = await sendGmailMessage({
          encryptedRefreshToken: inbox.gmailOauthRefreshToken,
          from: inbox.emailAddress,
          to: input.to,
          subject: input.subject,
          htmlBody: input.bodyHtml,
          textBody: input.bodyText,
        });
        externalId = result.id;
        gmailThreadId = result.threadId;
      } catch (err) {
        logger.error({ err, venueId: input.venueId }, "Gmail send failed");
        return {
          ok: false,
          error:
            err instanceof Error
              ? `Gmail send failed: ${err.message}`
              : "Gmail send failed. See server logs.",
        };
      }
    } else {
      // DEV MODE — log only
      mode = "dev";
      notes = "(dev mode: would have sent; Gmail OAuth not configured for this brand × staff)";
    }

    // Persist outreach_log + email_threads in one tx
    const result = await withAuditContext(staff.id, async (tx) => {
      const [logRow] = await tx
        .insert(outreachLog)
        .values({
          venueId: input.venueId,
          venueEventId: input.venueEventId,
          outreachBrandId: input.outreachBrandId,
          staffMemberId: staff.id,
          staffOutreachEmailId: inbox?.id ?? null,
          channel: "email",
          outcome: "sent",
          subject: input.subject,
          bodySnippet: input.bodyText
            ? input.bodyText.slice(0, 500)
            : stripHtml(input.bodyHtml).slice(0, 500),
          externalId,
          notes,
        })
        .returning({ id: outreachLog.id });

      if (mode === "live" && gmailThreadId && inbox) {
        // Upsert email_threads row keyed on (gmail_thread_id, venue_id)
        const existing = await tx
          .select({ id: emailThreads.id })
          .from(emailThreads)
          .where(
            and(
              eq(emailThreads.gmailThreadId, gmailThreadId),
              eq(emailThreads.venueId, input.venueId),
            ),
          )
          .limit(1);

        if (!existing[0]) {
          await tx.insert(emailThreads).values({
            venueId: input.venueId,
            outreachBrandId: input.outreachBrandId,
            staffOutreachEmailId: inbox.id,
            gmailThreadId,
            subject: input.subject,
            lastMessageAt: new Date(),
            createdBy: staff.id,
            updatedBy: staff.id,
          });
        } else {
          await tx
            .update(emailThreads)
            .set({ lastMessageAt: new Date(), updatedBy: staff.id })
            .where(eq(emailThreads.id, existing[0].id));
        }
      }

      return logRow?.id ?? "";
    });

    // Auto-graduate warm-up if the inbox just hit day 14 or its ramp
    // value caught up to the daily cap. Idempotent.
    if (inbox && input.sendKind === "cold") {
      try {
        await maybeGraduateWarmup(inbox.id);
      } catch (gErr) {
        logger.error({ err: gErr, inboxId: inbox.id }, "warmup graduation failed");
      }
    }

    revalidatePath(`/venues/${input.venueId}`);
    return { ok: true, data: { outreachLogId: result, mode } };
  } catch (err) {
    logger.error({ err }, "sendOutreachEmail failed");
    return { ok: false, error: "Send failed. See server logs." };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// =========================================================================
// logManualSend
// =========================================================================
//
// Companion to sendOutreachEmail for the Phase 1 "Open in Mail" flow.
// The operator opened a mailto: link, sent the email from their own
// mail client, then clicks "I just sent this" in the composer. That
// creates an outreach_log row identical to a live-mode send but without
// touching Gmail API.
//
// Why not just reuse sendOutreachEmail?
//   - Different outcome semantics: this is "confirmed manually sent",
//     not "engine attempted send". The notes column records that.
//   - No throttle check — the operator already sent it. We're catching
//     up the log, not gating a future send.
//   - No Gmail thread linkage — there's no message ID to attach.
//
// Throttle counts these as sends going forward, so the operator can't
// game caps by routing everything through mailto:.

const logManualSendSchema = z.object({
  venueId: uuidSchema,
  outreachBrandId: uuidSchema,
  venueEventId: z.union([z.literal("").transform(() => undefined), uuidSchema]).optional(),
  to: z.string().email("Invalid email address"),
  subject: z.string().min(1, "Subject required").max(500),
  bodyText: z.string().min(1, "Body required"),
});

export async function logManualSend(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ outreachLogId: string }>> {
  const { staff } = await requireStaff();
  const parsed = logManualSendSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  try {
    // Resolve the inbox (so the log row attributes to the right
    // staff_outreach_email row — important for per-inbox throttle math).
    const inbox = await db
      .select({ id: staffOutreachEmails.id })
      .from(staffOutreachEmails)
      .where(
        and(
          eq(staffOutreachEmails.staffMemberId, staff.id),
          eq(staffOutreachEmails.outreachBrandId, input.outreachBrandId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(outreachLog)
        .values({
          venueId: input.venueId,
          venueEventId: input.venueEventId,
          outreachBrandId: input.outreachBrandId,
          staffMemberId: staff.id,
          staffOutreachEmailId: inbox?.id ?? null,
          channel: "email",
          outcome: "sent",
          subject: input.subject,
          bodySnippet: input.bodyText.slice(0, 500),
          externalId: null,
          notes: "(sent manually via mailto: — operator confirmed delivery)",
        })
        .returning({ id: outreachLog.id });
      return row?.id ?? "";
    });

    revalidatePath(`/venues/${input.venueId}`);
    return { ok: true, data: { outreachLogId: id } };
  } catch (err) {
    logger.error({ err }, "logManualSend failed");
    return { ok: false, error: "Logging failed. See server logs." };
  }
}

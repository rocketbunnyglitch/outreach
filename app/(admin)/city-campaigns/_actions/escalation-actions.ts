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
import { notifications } from "@/db/schema/notifications";
import { staffMembers, staffOutreachEmails } from "@/db/schema/staff";
import { tasks } from "@/db/schema/tasks";
import { venues } from "@/db/schema/venues";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { isGmailOAuthConfigured, sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, desc, eq } from "drizzle-orm";
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

      // 3. In-app notification — drops into the assignee's notifications
      // bell immediately. Source of truth for "Brandon was told". The
      // email send below is a best-effort enhancement; if SMTP/Gmail is
      // down, the assignee still sees this on next page load.
      //
      // linkPath points at the venue (Phase 1 — task list also surfaces
      // the same info). When a dedicated /escalations dashboard route
      // ships in a follow-up, we'll swap to that link.
      await tx.insert(notifications).values({
        staffId,
        kind: "escalation",
        title: `Escalation: ${contextRow.venueName}`,
        body: `From ${staff.displayName} · ${cityLabel}\n\n${notes}`,
        linkPath: `/venues/${contextRow.venueId}`,
        metadata: {
          escalationEntryId: entryId,
          escalationTaskId: row?.id ?? null,
          venueId: contextRow.venueId,
          cityLabel,
          escalatedByStaffId: staff.id,
          escalatedByName: staff.displayName,
        },
      });

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

    // 4. Best-effort email notification. The in-app notification +
    // task above are the SOURCE OF TRUTH for "Brandon was told" — if
    // Gmail send fails, the operator's workflow still works. So we
    // don't await this in the request critical path; we run it
    // outside the try/catch and log success or failure independently.
    //
    // Sender: the escalator's first connected outreach inbox. The
    // From: header will read "Yesu <yesu@perse.io>" etc. — totally
    // fine for internal notification email since the assignee
    // recognizes their teammate's address. We don't try to use a
    // shared notifications@ inbox because we don't have one yet.
    //
    // If the escalator has no connected inbox (admin/web-only staff,
    // or never finished Gmail OAuth), we skip the email entirely and
    // log "skipped — no sender inbox". The in-app notification still
    // alerts Brandon.
    void sendEscalationEmail({
      escalatorStaffId: staff.id,
      escalatorName: staff.displayName,
      assigneeEmail: contextRow.assigneeEmail,
      assigneeName: contextRow.assigneeName,
      venueName: contextRow.venueName,
      cityLabel,
      venuePhone: contextRow.venuePhone,
      venueEmailAddr: contextRow.venueEmail,
      notes,
      taskId,
      venueId: contextRow.venueId,
    });

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
 * Send the escalation notification email — best-effort, never throws.
 *
 * Called fire-and-forget from escalateColdEntry. Failures are logged
 * via captureException (which now routes through Pino as well, since
 * commit cd68049) but DON'T propagate back to the operator. The
 * operator already got an ok response based on the DB writes; the
 * email is enhancement, not requirement.
 *
 * If the escalator has no connected outreach inbox, the function
 * exits early after logging — the assignee still gets the in-app
 * notification + task.
 */
async function sendEscalationEmail(opts: {
  escalatorStaffId: string;
  escalatorName: string;
  assigneeEmail: string;
  assigneeName: string;
  venueName: string;
  cityLabel: string;
  venuePhone: string | null;
  venueEmailAddr: string | null;
  notes: string;
  taskId: string;
  venueId: string;
}): Promise<void> {
  try {
    // Find the escalator's first connected outreach inbox. Any brand
    // works — we just need a valid Gmail OAuth refresh token to send
    // FROM. Order by created_at desc so the most-recently-set-up
    // brand wins (likely their currently-active workflow).
    const [inbox] = await db
      .select({
        emailAddress: staffOutreachEmails.emailAddress,
        refreshToken: staffOutreachEmails.gmailOauthRefreshToken,
      })
      .from(staffOutreachEmails)
      .where(
        and(
          eq(staffOutreachEmails.staffMemberId, opts.escalatorStaffId),
          eq(staffOutreachEmails.status, "connected"),
        ),
      )
      .orderBy(desc(staffOutreachEmails.createdAt))
      .limit(1);

    if (!inbox || !inbox.refreshToken || !isGmailOAuthConfigured()) {
      logger.info(
        {
          escalatorStaffId: opts.escalatorStaffId,
          gmailConfigured: isGmailOAuthConfigured(),
          hasInbox: Boolean(inbox),
        },
        "escalation email skipped — no sender inbox available",
      );
      return;
    }

    const subject = `Escalation: ${opts.venueName} (${opts.cityLabel})`;

    const textBody = [
      `Hi ${opts.assigneeName.split(" ")[0] ?? opts.assigneeName},`,
      "",
      `${opts.escalatorName} escalated a venue to you.`,
      "",
      `Venue: ${opts.venueName}`,
      `City: ${opts.cityLabel}`,
      opts.venuePhone ? `Phone: ${opts.venuePhone}` : null,
      opts.venueEmailAddr ? `Email: ${opts.venueEmailAddr}` : null,
      "",
      "What the venue wants to discuss:",
      opts.notes,
      "",
      "There's a task assigned to you in the system + a notification",
      "in your bell. Reply to this email if you have questions for",
      `${opts.escalatorName.split(" ")[0] ?? opts.escalatorName}.`,
      "",
      "— Perse",
    ]
      .filter(Boolean)
      .join("\n");

    // Minimal HTML — operator's email client will mostly show this
    // as plain text but the bullet points + bold venue line make it
    // scannable when rendered HTML-side. Inline styles only (Gmail
    // strips <style> blocks).
    const venuePhoneRow = opts.venuePhone
      ? `<li style="margin:2px 0"><strong>Phone:</strong> ${escapeHtml(opts.venuePhone)}</li>`
      : "";
    const venueEmailRow = opts.venueEmailAddr
      ? `<li style="margin:2px 0"><strong>Email:</strong> ${escapeHtml(opts.venueEmailAddr)}</li>`
      : "";
    const htmlBody = `
<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">
  <p>Hi ${escapeHtml(opts.assigneeName.split(" ")[0] ?? opts.assigneeName)},</p>
  <p><strong>${escapeHtml(opts.escalatorName)}</strong> escalated a venue to you.</p>
  <ul style="padding-left:18px;margin:8px 0">
    <li style="margin:2px 0"><strong>Venue:</strong> ${escapeHtml(opts.venueName)}</li>
    <li style="margin:2px 0"><strong>City:</strong> ${escapeHtml(opts.cityLabel)}</li>
    ${venuePhoneRow}
    ${venueEmailRow}
  </ul>
  <p style="margin-top:14px"><strong>What the venue wants to discuss:</strong></p>
  <blockquote style="margin:6px 0 12px 0;padding:8px 12px;border-left:3px solid #d4d4d8;background:#fafafa;white-space:pre-wrap">${escapeHtml(opts.notes)}</blockquote>
  <p style="color:#71717a;font-size:13px">
    There's a task assigned to you in the system + a notification in your bell.
    Reply to this email if you have questions for ${escapeHtml(opts.escalatorName.split(" ")[0] ?? opts.escalatorName)}.
  </p>
  <p style="color:#a1a1aa;font-size:12px;margin-top:18px">— Perse</p>
</div>`.trim();

    await sendGmailMessage({
      encryptedRefreshToken: inbox.refreshToken,
      from: inbox.emailAddress,
      to: opts.assigneeEmail,
      subject,
      htmlBody,
      textBody,
    });

    logger.info(
      {
        from: inbox.emailAddress,
        to: opts.assigneeEmail,
        venueId: opts.venueId,
        taskId: opts.taskId,
      },
      "escalation email sent",
    );
  } catch (err) {
    // Don't propagate — in-app notification + task already exist.
    // Engineers see this in pm2 logs.
    logger.error(
      {
        err,
        escalatorStaffId: opts.escalatorStaffId,
        assigneeEmail: opts.assigneeEmail,
        venueId: opts.venueId,
      },
      "escalation email send failed (notification + task still created)",
    );
  }
}

/**
 * Tiny HTML escaper for the email body — handles the 5 characters
 * that matter for the inline HTML construction above. Lighter than
 * pulling in a full dompurify import for this single use case.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

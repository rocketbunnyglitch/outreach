import "server-only";

/**
 * Send worker — drains scheduled_sends rows that are due (status='pending'
 * AND scheduled_for <= now).
 *
 * One iteration = one drain pass. The caller (cron / loop / API route)
 * decides cadence. Recommended: every 60 seconds.
 *
 * Per pass:
 *   1. SELECT up to BATCH_SIZE due rows WHERE status='pending' ORDER BY
 *      scheduled_for FOR UPDATE SKIP LOCKED. SKIP LOCKED prevents two
 *      worker invocations from claiming the same row.
 *   2. For each row: re-check the inbox throttle (cap may have shifted),
 *      render the template fresh from the latest content, call Gmail,
 *      insert outreach_log, flip status to sent.
 *   3. On error: increment failure_count. If <3, leave status=pending
 *      with scheduled_for bumped to now+5min. If ≥3, flip to failed.
 *
 * Returns a summary the caller can log.
 */

import {
  emailTemplates,
  outreachCadenceSteps,
  outreachLog,
  scheduledSends,
  venues,
} from "@/db/schema";
import { staffOutreachEmails } from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { isGmailOAuthConfigured, sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { advanceAfterFollowup, stopSequence } from "@/lib/outreach-sequences";
import { canSendNow, maybeGraduateWarmup } from "@/lib/send-throttle";
import { type RenderContext, renderTemplate } from "@/lib/template-render";
import { and, eq, sql } from "drizzle-orm";

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

export interface WorkerResult {
  claimed: number;
  sent: number;
  failed: number;
  deferred: number;
  errors: Array<{ scheduledSendId: string; reason: string }>;
}

type ProcessOutcome = "sent" | "failed" | "deferred";

export async function drainScheduledSends(opts: { now?: Date } = {}): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const result: WorkerResult = { claimed: 0, sent: 0, failed: 0, deferred: 0, errors: [] };

  // Claim up to BATCH_SIZE due rows in one transaction (SKIP LOCKED keeps
  // concurrent workers safe). Returns row IDs we're responsible for.
  const claimed = await db.execute<{ id: string }>(sql`
    WITH due AS (
      SELECT id
      FROM scheduled_sends
      WHERE status = 'pending'
        AND scheduled_for <= ${now}
      ORDER BY scheduled_for ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE scheduled_sends
    SET status = 'sending', updated_at = NOW()
    FROM due
    WHERE scheduled_sends.id = due.id
    RETURNING scheduled_sends.id
  `);

  const claimedIds: string[] = (
    Array.isArray(claimed)
      ? (claimed as unknown as Array<{ id: string }>)
      : ((claimed as unknown as { rows: Array<{ id: string }> }).rows ?? [])
  ).map((r) => r.id);
  result.claimed = claimedIds.length;

  if (claimedIds.length === 0) return result;

  // Process each claimed row. Errors per-row are captured; we don't bail
  // the whole pass on one bad row.
  for (const id of claimedIds) {
    try {
      const outcome = await processOne(id);
      if (outcome === "sent") result.sent++;
      else if (outcome === "deferred") result.deferred++;
      else if (outcome === "failed") result.failed++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        scheduledSendId: id,
        reason: err instanceof Error ? err.message : String(err),
      });
      logger.error({ err, scheduledSendId: id }, "scheduled send worker: row failed");
      // Mark the row as failed so we don't keep retrying a fundamentally
      // broken send. The error message goes into failure_reason.
      try {
        await db
          .update(scheduledSends)
          .set({
            status: "failed",
            failureReason: err instanceof Error ? err.message : String(err),
            failureCount: sql`${scheduledSends.failureCount} + 1`,
          })
          .where(eq(scheduledSends.id, id));
      } catch {
        /* swallow — the outer error path already logged */
      }
    }
  }

  return result;
}

/**
 * Phase 3 — drain due follow-ups. Called by the same cron tick after
 * drainScheduledSends. Picks up outreach_sequence_state rows where
 * next_step_due_at <= now, fires the corresponding template, advances
 * the sequence. Stops on bounce / inbox auth failure.
 */
export async function drainFollowups(opts: { now?: Date } = {}): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const result: WorkerResult = { claimed: 0, sent: 0, failed: 0, deferred: 0, errors: [] };

  // Claim due rows. Same SKIP LOCKED pattern but we don't have a status
  // column to flip — instead we bump next_step_due_at forward by 5min
  // optimistically so concurrent workers won't double-claim. The actual
  // status update happens after the send.
  const claimed = await db.execute<{
    id: string;
    venue_id: string;
    outreach_brand_id: string;
    staff_member_id: string;
    staff_outreach_email_id: string;
    recipient_email: string;
    last_step_sent: number;
    next_step_number: number;
    unsubscribe_token: string;
  }>(sql`
    WITH due AS (
      SELECT id
      FROM outreach_sequence_state
      WHERE stopped_at IS NULL
        AND next_step_number IS NOT NULL
        AND next_step_due_at <= ${now}
      ORDER BY next_step_due_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outreach_sequence_state oss
    SET next_step_due_at = oss.next_step_due_at + interval '5 minutes',
        updated_at = NOW()
    FROM due
    WHERE oss.id = due.id
    RETURNING oss.id, oss.venue_id, oss.outreach_brand_id,
              oss.staff_member_id, oss.staff_outreach_email_id,
              oss.recipient_email, oss.last_step_sent,
              oss.next_step_number, oss.unsubscribe_token
  `);

  type FollowupRow = {
    id: string;
    venue_id: string;
    outreach_brand_id: string;
    staff_member_id: string;
    staff_outreach_email_id: string;
    recipient_email: string;
    last_step_sent: number;
    next_step_number: number;
    unsubscribe_token: string;
  };

  const claimedRows: FollowupRow[] = Array.isArray(claimed)
    ? (claimed as unknown as FollowupRow[])
    : ((claimed as unknown as { rows: FollowupRow[] }).rows ?? []);
  result.claimed = claimedRows.length;

  if (claimedRows.length === 0) return result;

  for (const row of claimedRows) {
    try {
      const outcome = await processFollowup(row);
      if (outcome === "sent") result.sent++;
      else if (outcome === "deferred") result.deferred++;
      else if (outcome === "failed") result.failed++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        scheduledSendId: row.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      logger.error({ err, sequenceStateId: row.id }, "follow-up worker: row failed");
      try {
        await stopSequence({
          sequenceStateId: row.id,
          reason: "manual",
          staffMemberId: row.staff_member_id,
        });
      } catch {
        /* swallow */
      }
    }
  }

  return result;
}

async function processFollowup(row: {
  id: string;
  venue_id: string;
  outreach_brand_id: string;
  staff_member_id: string;
  staff_outreach_email_id: string;
  recipient_email: string;
  last_step_sent: number;
  next_step_number: number;
  unsubscribe_token: string;
}): Promise<ProcessOutcome> {
  // Lookup the cadence step template
  const stepRow = await db
    .select({ template: emailTemplates })
    .from(outreachCadenceSteps)
    .innerJoin(emailTemplates, eq(emailTemplates.id, outreachCadenceSteps.emailTemplateId))
    .where(
      and(
        eq(outreachCadenceSteps.outreachBrandId, row.outreach_brand_id),
        eq(outreachCadenceSteps.stepNumber, row.next_step_number),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  if (!stepRow) {
    // Cadence step missing — operator deleted it. Stop the sequence.
    await stopSequence({
      sequenceStateId: row.id,
      reason: "completed",
      staffMemberId: row.staff_member_id,
    });
    return "failed";
  }

  // Venue / inbox / unsubscribe check
  const venue = await db
    .select()
    .from(venues)
    .where(eq(venues.id, row.venue_id))
    .limit(1)
    .then((r) => r[0]);
  if (!venue || venue.unsubscribedAt || venue.doNotContact) {
    await stopSequence({
      sequenceStateId: row.id,
      reason: venue?.unsubscribedAt ? "unsubscribed" : "manual",
      staffMemberId: row.staff_member_id,
    });
    return "failed";
  }

  const inbox = await db
    .select()
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, row.staff_outreach_email_id))
    .limit(1)
    .then((r) => r[0]);
  if (!inbox) return "failed";

  // Throttle re-check
  const throttle = await canSendNow({ staffOutreachEmailId: inbox.id });
  if (!throttle.ok) {
    const isFatal = throttle.code === "auto_paused" || throttle.code === "inbox_not_connected";
    if (isFatal) {
      await stopSequence({
        sequenceStateId: row.id,
        reason: "manual",
        staffMemberId: row.staff_member_id,
      });
      return "failed";
    }
    // Defer via the optimistic +5min already applied
    return "deferred";
  }

  // Render template + append unsubscribe link to the body
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://outreach.barcrawlconnect.com";
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${row.unsubscribe_token}`;

  const context: RenderContext = {
    venue: {
      name: venue.name,
      address: venue.address,
      phone: venue.phoneE164,
      email: venue.email,
      website: venue.websiteUrl,
    },
  };
  const subject = renderTemplate(stepRow.template.subjectTemplate, context).output;
  const bodyText = `${renderTemplate(stepRow.template.bodyTemplateText, context).output}\n\n---\nUnsubscribe: ${unsubscribeUrl}`;
  const bodyHtml = stepRow.template.bodyTemplateHtml
    ? `${renderTemplate(stepRow.template.bodyTemplateHtml, context).output}\n<p style="font-size:11px;color:#999"><a href="${unsubscribeUrl}">Unsubscribe</a></p>`
    : `${textToHtml(renderTemplate(stepRow.template.bodyTemplateText, context).output)}\n<p style="font-size:11px;color:#999"><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;

  const isLive = !!inbox.gmailOauthRefreshToken && isGmailOAuthConfigured();
  let externalId: string | null = null;
  let notes: string | null = null;

  if (isLive) {
    try {
      const result = await sendGmailMessage({
        encryptedRefreshToken: inbox.gmailOauthRefreshToken as string,
        from: inbox.emailAddress,
        to: row.recipient_email,
        subject,
        htmlBody: bodyHtml,
        textBody: bodyText,
      });
      externalId = result.id;
    } catch (err) {
      // Treat as bounce-like → stop the sequence
      await stopSequence({
        sequenceStateId: row.id,
        reason: "bounced",
        staffMemberId: row.staff_member_id,
      });
      logger.error({ err, sequenceStateId: row.id }, "follow-up Gmail send failed");
      return "failed";
    }
  } else {
    notes = `(dev mode: would have sent follow-up step ${row.next_step_number})`;
  }

  // Write outreach_log + advance sequence
  await withAuditContext(row.staff_member_id, async (tx) => {
    await tx.insert(outreachLog).values({
      venueId: row.venue_id,
      outreachBrandId: row.outreach_brand_id,
      staffMemberId: row.staff_member_id,
      staffOutreachEmailId: inbox.id,
      channel: "email",
      outcome: "sent",
      subject,
      bodySnippet: bodyText.slice(0, 500),
      externalId,
      notes: notes ?? `(auto follow-up step ${row.next_step_number})`,
    });
  });

  // Advance to next step (or complete)
  await advanceAfterFollowup({
    sequenceStateId: row.id,
    staffMemberId: row.staff_member_id,
    stepJustSent: row.next_step_number,
  });

  try {
    await maybeGraduateWarmup(inbox.id);
  } catch {
    /* */
  }

  logger.info(
    { sequenceStateId: row.id, step: row.next_step_number, venue: venue.name },
    "follow-up delivered",
  );
  return "sent";
}

async function processOne(scheduledSendId: string): Promise<ProcessOutcome> {
  // Load the row + all the context we need for a send in one big join.
  const rows = await db
    .select({
      ss: scheduledSends,
      venue: venues,
      template: emailTemplates,
      inbox: staffOutreachEmails,
    })
    .from(scheduledSends)
    .innerJoin(venues, eq(venues.id, scheduledSends.venueId))
    .innerJoin(emailTemplates, eq(emailTemplates.id, scheduledSends.emailTemplateId))
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, scheduledSends.staffOutreachEmailId))
    .where(eq(scheduledSends.id, scheduledSendId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error("Scheduled send row vanished mid-pass");
  }
  const { ss, venue, template, inbox } = row;

  // Re-check throttle. The cap may have shifted (e.g. operator manually
  // sent some emails since this row was queued). Transactional sends
  // (cascade confirmations etc) bypass cold throttle — they go to
  // confirmed relationships not cold prospects.
  const throttle = await canSendNow({
    staffOutreachEmailId: inbox.id,
    bypass: ss.sendKind === "transactional",
  });
  if (!throttle.ok) {
    // Defer — bump scheduled_for and let the next pass try again.
    // Only defer non-fatal denials; auth issues are terminal.
    const isFatal = throttle.code === "auto_paused" || throttle.code === "inbox_not_connected";
    if (isFatal) {
      await db
        .update(scheduledSends)
        .set({ status: "failed", failureReason: throttle.reason })
        .where(eq(scheduledSends.id, scheduledSendId));
      return "failed";
    }
    // Bump 5 minutes out + back to pending so next drain picks it up.
    const nextTry = new Date(Date.now() + RETRY_BACKOFF_MS);
    await db
      .update(scheduledSends)
      .set({
        status: "pending",
        scheduledFor: nextTry,
        failureReason: `Deferred: ${throttle.reason}`,
      })
      .where(eq(scheduledSends.id, scheduledSendId));
    return "deferred";
  }

  // Render template fresh from current venue state
  const context: RenderContext = {
    venue: {
      name: venue.name,
      address: venue.address,
      phone: venue.phoneE164,
      email: venue.email,
      website: venue.websiteUrl,
    },
  };
  const subject = ss.subjectOverride ?? renderTemplate(template.subjectTemplate, context).output;
  const bodyText = ss.bodyTextOverride ?? renderTemplate(template.bodyTemplateText, context).output;
  const bodyHtml = template.bodyTemplateHtml
    ? renderTemplate(template.bodyTemplateHtml, context).output
    : textToHtml(bodyText);

  // Decide live vs dev mode
  const isLive = !!inbox.gmailOauthRefreshToken && isGmailOAuthConfigured();

  let externalId: string | null = null;
  let notes: string | null = null;

  if (isLive) {
    try {
      const result = await sendGmailMessage({
        encryptedRefreshToken: inbox.gmailOauthRefreshToken as string,
        from: inbox.emailAddress,
        to: ss.recipientEmail,
        subject,
        htmlBody: bodyHtml,
        textBody: bodyText,
      });
      externalId = result.id;
    } catch (err) {
      // Retry up to MAX_RETRIES
      const newCount = ss.failureCount + 1;
      if (newCount >= MAX_RETRIES) {
        await db
          .update(scheduledSends)
          .set({
            status: "failed",
            failureReason: err instanceof Error ? err.message : String(err),
            failureCount: newCount,
          })
          .where(eq(scheduledSends.id, scheduledSendId));
        return "failed";
      }
      const nextTry = new Date(Date.now() + RETRY_BACKOFF_MS);
      await db
        .update(scheduledSends)
        .set({
          status: "pending",
          scheduledFor: nextTry,
          failureCount: newCount,
          failureReason: err instanceof Error ? err.message : String(err),
        })
        .where(eq(scheduledSends.id, scheduledSendId));
      return "deferred";
    }
  } else {
    notes = "(dev mode: would have sent — Gmail OAuth not configured)";
  }

  // Write outreach_log + flip the scheduled row to sent
  const outreachLogId = await withAuditContext(ss.staffMemberId, async (tx) => {
    const [logRow] = await tx
      .insert(outreachLog)
      .values({
        venueId: ss.venueId,
        venueEventId: ss.venueEventId,
        outreachBrandId: ss.outreachBrandId,
        staffMemberId: ss.staffMemberId,
        staffOutreachEmailId: inbox.id,
        channel: "email",
        outcome: "sent",
        subject,
        bodySnippet: bodyText.slice(0, 500),
        externalId,
        notes,
      })
      .returning({ id: outreachLog.id });

    await tx
      .update(scheduledSends)
      .set({
        status: "sent",
        sentAt: new Date(),
        outreachLogId: logRow?.id ?? null,
      })
      .where(eq(scheduledSends.id, scheduledSendId));

    return logRow?.id ?? "";
  });

  // Auto-graduate warm-up
  try {
    await maybeGraduateWarmup(inbox.id);
  } catch {
    /* non-fatal */
  }

  logger.info(
    {
      scheduledSendId,
      outreachLogId,
      mode: isLive ? "live" : "dev",
      venue: venue.name,
    },
    "scheduled send delivered",
  );
  return "sent";
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p>${para
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");
}

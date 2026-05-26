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

import { emailTemplates, outreachLog, scheduledSends, venues } from "@/db/schema";
import { staffOutreachEmails } from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { isGmailOAuthConfigured, sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { canSendNow, maybeGraduateWarmup } from "@/lib/send-throttle";
import { type RenderContext, renderTemplate } from "@/lib/template-render";
import { eq, sql } from "drizzle-orm";

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

type ProcessOutcome = "sent" | "failed" | "deferred";

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
  // sent some emails since this row was queued).
  const throttle = await canSendNow({ staffOutreachEmailId: inbox.id });
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

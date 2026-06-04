import "server-only";

/**
 * Email-queue data loader (cold-send queue page).
 *
 * Surfaces the operator's own queued / sending / sent cold emails so they
 * can fire a batch and walk away. Reads email_drafts directly:
 *   - QUEUED  : unsent, scheduled_for in the future       -> waiting to send
 *   - SENDING : unsent, scheduled_for already elapsed      -> the
 *               scheduled-sends cron is about to dispatch it (or retrying)
 *   - SENT    : sent_at set within the last 24h            -> recently fired
 *
 * Owner-scoped (drafts are private). The page renders these three buckets;
 * Cancel removes a queued draft, Edit re-opens it in the composer.
 */

import { emailDrafts, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";

export interface EmailQueueItem {
  id: string;
  subject: string;
  toAddresses: string[];
  venueName: string | null;
  /** ISO; the planned send time (queued/sending) or null. */
  scheduledFor: string | null;
  /** ISO; when it actually sent (sent bucket) or null. */
  sentAt: string | null;
}

export interface EmailQueueData {
  queued: EmailQueueItem[];
  sending: EmailQueueItem[];
  sent: EmailQueueItem[];
}

function toItem(r: {
  id: string;
  subject: string;
  toAddresses: string[] | null;
  venueName: string | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
}): EmailQueueItem {
  return {
    id: r.id,
    subject: r.subject,
    toAddresses: r.toAddresses ?? [],
    venueName: r.venueName,
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
  };
}

export async function loadEmailQueue(ownerUserId: string): Promise<EmailQueueData> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60_000);

  const cols = {
    id: emailDrafts.id,
    subject: emailDrafts.subject,
    toAddresses: emailDrafts.toAddresses,
    venueName: venues.name,
    scheduledFor: emailDrafts.scheduledFor,
    sentAt: emailDrafts.sentAt,
  };

  const [queuedRows, sendingRows, sentRows] = await Promise.all([
    db
      .select(cols)
      .from(emailDrafts)
      .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
      .where(
        and(
          eq(emailDrafts.ownerUserId, ownerUserId),
          isNull(emailDrafts.sentAt),
          isNotNull(emailDrafts.scheduledFor),
          gte(emailDrafts.scheduledFor, now),
        ),
      )
      .orderBy(emailDrafts.scheduledFor)
      .limit(200),
    db
      .select(cols)
      .from(emailDrafts)
      .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
      .where(
        and(
          eq(emailDrafts.ownerUserId, ownerUserId),
          isNull(emailDrafts.sentAt),
          isNotNull(emailDrafts.scheduledFor),
          lte(emailDrafts.scheduledFor, now),
        ),
      )
      .orderBy(emailDrafts.scheduledFor)
      .limit(200),
    db
      .select(cols)
      .from(emailDrafts)
      .leftJoin(venues, eq(venues.id, emailDrafts.venueId))
      .where(
        and(
          eq(emailDrafts.ownerUserId, ownerUserId),
          isNotNull(emailDrafts.sentAt),
          gte(emailDrafts.sentAt, since),
        ),
      )
      .orderBy(desc(emailDrafts.sentAt))
      .limit(50),
  ]);

  return {
    queued: queuedRows.map(toItem),
    sending: sendingRows.map(toItem),
    sent: sentRows.map(toItem),
  };
}

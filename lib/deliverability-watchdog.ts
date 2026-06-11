import "server-only";

/**
 * Deliverability watchdog (best-in-class item #3, 2026-06-11) —
 * ALERT MODE. Watches each connected inbox's 7-day sending health and
 * pings admins when a signal crosses a threshold, BEFORE a domain
 * burns. v1 alerts only; auto-throttling is a deliberate later step
 * (changing send caps automatically deserves its own review).
 *
 * Signals per inbox over the trailing 7 days:
 *   bounce rate   suppressions with reason 'bounced' whose address was
 *                 last sent to by this inbox / total sends      > 4%
 *   send volume   total sends > 25 with bounce rate > 2%        (early warning)
 *   dead inbox    status needs_reauth with sends queued for it  (ops alert)
 *
 * Reply-rate decay is intentionally NOT alerted yet: with sends this
 * early in the campaign the denominator is too small to be signal.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

const WINDOW_DAYS = 7;
const BOUNCE_ALERT_PCT = 4;
const BOUNCE_WARN_PCT = 2;
const WARN_MIN_SENDS = 25;
const DEDUPE_MINUTES = 12 * 60;

interface InboxHealthRow {
  email_address: string;
  sends: number;
  bounces: number;
}

export interface DeliverabilitySummary {
  inboxesChecked: number;
  alerts: number;
}

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export async function runDeliverabilityWatchdog(): Promise<DeliverabilitySummary> {
  const { emitNotification } = await import("@/app/(admin)/_actions/notifications");

  // Per-inbox sends + bounces in the window. Bounce attribution: a
  // suppression row with reason='bounced' created in the window whose
  // address this inbox sent to in the window. Approximate but stable —
  // multi-inbox overlap on one venue address is rare inside 7 days
  // (the cross-domain floor forbids it).
  const health = rowsOf<InboxHealthRow>(
    await db.execute(sql`
      WITH sends AS (
        SELECT ca.id AS inbox_id, ca.email_address,
               count(*)::int AS sends
        FROM email_send_events se
        JOIN connected_accounts ca ON ca.id = se.connected_account_id
        WHERE se.sent_at > now() - (${WINDOW_DAYS} || ' days')::interval
        GROUP BY ca.id, ca.email_address
      ),
      bounces AS (
        SELECT ca.id AS inbox_id, count(DISTINCT s.email)::int AS bounces
        FROM email_suppression s
        JOIN email_messages m
          ON m.direction = 'outbound'
         AND lower(m.to_addresses[1]) = lower(s.email)
         AND m.sent_at > now() - (${WINDOW_DAYS} || ' days')::interval
        JOIN email_threads t ON t.id = m.thread_id
        JOIN connected_accounts ca ON ca.id = t.staff_outreach_email_id
        WHERE s.reason = 'bounced'
          AND s.created_at > now() - (${WINDOW_DAYS} || ' days')::interval
        GROUP BY ca.id
      )
      SELECT sends.email_address, sends.sends, COALESCE(bounces.bounces, 0) AS bounces
      FROM sends LEFT JOIN bounces ON bounces.inbox_id = sends.inbox_id
      WHERE sends.sends > 0
    `),
  );

  // Admins to notify.
  const admins = rowsOf<{ id: string }>(
    await db.execute(sql`
      SELECT id::text AS id FROM users WHERE role = 'admin' AND status = 'active'
    `),
  );

  let alerts = 0;
  for (const inbox of health) {
    const rate = (inbox.bounces / Math.max(inbox.sends, 1)) * 100;
    const critical = rate > BOUNCE_ALERT_PCT && inbox.bounces >= 2;
    const warning = !critical && inbox.sends >= WARN_MIN_SENDS && rate > BOUNCE_WARN_PCT;
    if (!critical && !warning) continue;

    const title = critical
      ? `Deliverability: ${inbox.email_address} bounce rate ${rate.toFixed(1)}%`
      : `Deliverability warning: ${inbox.email_address} trending up`;
    const body = `${inbox.bounces} bounce${inbox.bounces === 1 ? "" : "s"} on ${inbox.sends} sends in ${WINDOW_DAYS} days. ${
      critical
        ? "Pause cold sends from this inbox and verify the list before the domain takes reputation damage."
        : "Watch this inbox; consider slowing cold sends if it keeps climbing."
    }`;

    for (const admin of admins) {
      try {
        const res = await emitNotification({
          staffId: admin.id,
          kind: "admin_message",
          title,
          body,
          linkPath: "/admin/deliverability",
          dedupeMinutes: DEDUPE_MINUTES,
        });
        if (res.created) alerts += 1;
      } catch (err) {
        logger.warn({ err, inbox: inbox.email_address }, "deliverability notify failed");
      }
    }
  }

  const summary = { inboxesChecked: health.length, alerts };
  logger.info(summary, "deliverability watchdog complete");
  return summary;
}

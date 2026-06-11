import "server-only";

/**
 * Aging watchdog (best-in-class item #2, 2026-06-11): nothing in the
 * system rots silently. A daily scan puts a clock on every kind of
 * state that quietly goes stale and pings the person who owns it —
 * deduped so a stuck item nags at most once per day.
 *
 * Rules (v1, intentionally few and high-signal):
 *   1. Cold entries emailed/follow-up-due with no touch for 10+ days
 *      -> assigned staffer (else city lead)
 *   2. needs_reply threads with no answer for 48h+ -> assigned staffer
 *      (else city lead via the thread's city campaign)
 *   3. Confirmed wristband-role venues <14 days out with no shipped
 *      wristband -> city lead
 *   4. Priority 1-3 crawls <7 days out with confirmed venues but NO
 *      host assigned -> city lead
 *   5. Queued drafts whose scheduled_for passed 1h+ ago with send
 *      attempts recorded (stuck/failing) -> draft owner
 *
 * Notifications only — the watchdog never mutates workflow state
 * (humans decide; refdoc 0.4). Counts grouped per recipient so one
 * person with 12 stale items gets ONE digest line per rule, not 12
 * pings.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

const STALE_COLD_DAYS = 10;
const NEEDS_REPLY_HOURS = 48;
const WRISTBAND_WINDOW_DAYS = 14;
const HOST_WINDOW_DAYS = 7;
const DEDUPE_MINUTES = 24 * 60;

interface AgingRow {
  staff_id: string;
  n: number;
  detail: string | null;
}

export interface AgingWatchdogSummary {
  notified: number;
  rules: Record<string, number>;
}

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export async function runAgingWatchdog(): Promise<AgingWatchdogSummary> {
  const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
  let notified = 0;
  const rules: Record<string, number> = {};

  async function notifyGrouped(
    ruleKey: string,
    rows: AgingRow[],
    title: (n: number) => string,
    body: (n: number, detail: string | null) => string,
    linkPath: string,
  ) {
    rules[ruleKey] = rows.reduce((s, r) => s + Number(r.n), 0);
    for (const r of rows) {
      if (!r.staff_id) continue;
      try {
        const res = await emitNotification({
          staffId: r.staff_id,
          kind: "admin_message",
          title: title(Number(r.n)),
          body: body(Number(r.n), r.detail),
          linkPath,
          dedupeMinutes: DEDUPE_MINUTES,
        });
        if (res.created) notified += 1;
      } catch (err) {
        logger.warn({ err, ruleKey }, "aging-watchdog notify failed (non-fatal)");
      }
    }
  }

  // 1. Stale cold entries — grouped per assignee (fallback city lead).
  const staleCold = rowsOf<AgingRow>(
    await db.execute(sql`
      SELECT COALESCE(e.assigned_staff_id, cc.lead_staff_id)::text AS staff_id,
             count(*)::int AS n,
             string_agg(DISTINCT c.name, ', ' ORDER BY c.name) AS detail
      FROM cold_outreach_entries e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      WHERE e.status IN ('email_sent', 'follow_up_due')
        AND e.archived_at IS NULL
        AND e.last_touch_at < now() - (${STALE_COLD_DAYS} || ' days')::interval
        AND COALESCE(e.assigned_staff_id, cc.lead_staff_id) IS NOT NULL
      GROUP BY 1
    `),
  );
  await notifyGrouped(
    "stale_cold",
    staleCold,
    (n) =>
      `${n} cold ${n === 1 ? "venue has" : "venues have"} gone ${STALE_COLD_DAYS}+ days untouched`,
    (_n, d) =>
      `Cities: ${d ?? "—"}. They drop out of the funnel silently from here — follow up or archive.`,
    "/worklist",
  );

  // 2. needs_reply threads aging past 48h.
  const staleReplies = rowsOf<AgingRow>(
    await db.execute(sql`
      SELECT COALESCE(t.assigned_staff_id, cc.lead_staff_id)::text AS staff_id,
             count(*)::int AS n,
             NULL AS detail
      FROM email_threads t
      LEFT JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      WHERE t.state = 'needs_reply'
        AND t.deleted_at IS NULL
        AND t.last_inbound_at < now() - (${NEEDS_REPLY_HOURS} || ' hours')::interval
        AND COALESCE(t.assigned_staff_id, cc.lead_staff_id) IS NOT NULL
      GROUP BY 1
    `),
  );
  await notifyGrouped(
    "aging_replies",
    staleReplies,
    (n) => `${n} venue ${n === 1 ? "reply has" : "replies have"} waited ${NEEDS_REPLY_HOURS}h+`,
    () => "A venue that replied and got silence goes cold fast — clear the queue.",
    "/inbox?folder=needs_reply",
  );

  // 3. Wristband not shipped, event <14 days out.
  const wristbands = rowsOf<AgingRow>(
    await db.execute(sql`
      SELECT cc.lead_staff_id::text AS staff_id,
             count(DISTINCT ve.id)::int AS n,
             string_agg(DISTINCT c.name, ', ' ORDER BY c.name) AS detail
      FROM venue_events ve
      JOIN events ev ON ev.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = ev.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      LEFT JOIN wristbands w ON w.venue_event_id = ve.id
      WHERE ve.role = 'wristband'
        AND ve.status IN ('confirmed', 'scheduled', 'contract_signed')
        AND ve.cancelled_at IS NULL
        AND ev.archived_at IS NULL
        AND ev.event_date BETWEEN now()::date AND (now() + (${WRISTBAND_WINDOW_DAYS} || ' days')::interval)::date
        AND (w.id IS NULL OR w.status IN ('pending', 'ready_to_ship', 'issue'))
        AND cc.lead_staff_id IS NOT NULL
      GROUP BY 1
    `),
  );
  await notifyGrouped(
    "wristbands_unshipped",
    wristbands,
    (n) =>
      `${n} wristband ${n === 1 ? "venue" : "venues"} <${WRISTBAND_WINDOW_DAYS} days out, nothing shipped`,
    (_n, d) => `Cities: ${d ?? "—"}. Shipping needs lead time — order now or flag the issue.`,
    "/wristbands",
  );

  // 4. Prio 1-3 crawls <7 days out, confirmed venues, no host.
  const hostless = rowsOf<AgingRow>(
    await db.execute(sql`
      SELECT cc.lead_staff_id::text AS staff_id,
             count(DISTINCT ev.id)::int AS n,
             string_agg(DISTINCT c.name, ', ' ORDER BY c.name) AS detail
      FROM events ev
      JOIN city_campaigns cc ON cc.id = ev.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      WHERE ev.archived_at IS NULL
        AND ev.status IN ('planned', 'confirmed')
        AND cc.priority <= 3
        AND ev.event_date BETWEEN now()::date AND (now() + (${HOST_WINDOW_DAYS} || ' days')::interval)::date
        AND EXISTS (
          SELECT 1 FROM venue_events ve
          WHERE ve.event_id = ev.id AND ve.status IN ('confirmed','scheduled','contract_signed')
        )
        AND NOT EXISTS (SELECT 1 FROM crawl_hosts ch WHERE ch.event_id = ev.id)
        AND cc.lead_staff_id IS NOT NULL
      GROUP BY 1
    `),
  );
  await notifyGrouped(
    "hostless_crawls",
    hostless,
    (n) => `${n} priority crawl${n === 1 ? "" : "s"} <${HOST_WINDOW_DAYS} days out with NO host`,
    (_n, d) => `Cities: ${d ?? "—"}. Refdoc 7.13.3: Prio 1-3 needs two external hosts — hire now.`,
    "/external-hosts",
  );

  // 5. Stuck queued drafts (scheduled_for passed 1h+, attempts recorded).
  const stuckDrafts = rowsOf<AgingRow>(
    await db.execute(sql`
      SELECT d.owner_user_id::text AS staff_id, count(*)::int AS n, NULL AS detail
      FROM email_drafts d
      WHERE d.sent_at IS NULL
        AND d.scheduled_for < now() - interval '1 hour'
        AND COALESCE(d.send_attempts, 0) > 0
      GROUP BY 1
    `),
  );
  await notifyGrouped(
    "stuck_drafts",
    stuckDrafts,
    (n) => `${n} queued ${n === 1 ? "email is" : "emails are"} stuck failing`,
    () => "Scheduled sends keep failing — open the queue, check the error, fix or cancel.",
    "/email-queue",
  );

  const summary = { notified, rules };
  logger.info(summary, "aging watchdog complete");
  return summary;
}

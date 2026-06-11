import "server-only";

/**
 * Data-linkage integrity checks, in-app (FULL_AUDIT P006).
 *
 * The same invariants as scripts/audit-data-links.sh (the manual/dev
 * harness), runnable from the app so findings surface on
 * /admin/data-quality and the command center instead of rotting in a
 * log. Read-only; each check is one cheap aggregate. Wave-1 phases add
 * checks here AND to the bash harness — the two lists must stay in
 * sync (the bash harness is the pre-deploy/manual runner, this is the
 * always-visible one).
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface IntegrityCheck {
  name: string;
  desc: string;
  count: number;
}

const CHECKS: Array<{ name: string; desc: string; query: ReturnType<typeof sql> }> = [
  {
    name: "thread_message_count_drift",
    desc: "Thread message counts disagree with actual messages (poller duplicate bug class)",
    query: sql`SELECT count(*)::int AS n FROM (
      SELECT t.id FROM email_threads t
      JOIN email_messages m ON m.thread_id = t.id
      GROUP BY t.id, t.message_count
      HAVING count(m.id) <> t.message_count) d`,
  },
  {
    name: "threads_venue_merged",
    desc: "Threads still pointing at a merged-away venue",
    query: sql`SELECT count(*)::int AS n FROM email_threads t
      JOIN venues v ON v.id = t.venue_id
      WHERE v.merged_into_venue_id IS NOT NULL`,
  },
  {
    name: "threads_unlinked_exact_email",
    desc: "Threads >48h old matching a venue email exactly but never linked (nightly retro-link should heal)",
    query: sql`SELECT count(*)::int AS n FROM (
      SELECT t.id, lower((regexp_match(m.from_address, '<([^>]+)>'))[1]) AS addr
      FROM email_threads t
      JOIN LATERAL (SELECT from_address FROM email_messages
        WHERE thread_id = t.id AND direction = 'inbound'
        ORDER BY sent_at DESC LIMIT 1) m ON true
      WHERE t.archived_at IS NULL AND t.venue_id IS NULL
        AND t.created_at < now() - interval '48 hours') u
    JOIN venues v ON lower(v.email) = u.addr AND v.archived_at IS NULL`,
  },
  {
    name: "threads_venue_no_cc_unambig",
    desc: "Venue-linked threads with no campaign attribution despite a single unambiguous city-campaign (drop out of campaign views)",
    query: sql`WITH single_cc AS (
        SELECT coe.venue_id
        FROM cold_outreach_entries coe
        JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
        JOIN campaigns c ON c.id = cc.campaign_id
        WHERE coe.archived_at IS NULL AND c.archived_at IS NULL
        GROUP BY coe.venue_id
        HAVING count(DISTINCT coe.city_campaign_id) = 1)
      SELECT count(*)::int AS n FROM email_threads t
      JOIN single_cc s ON s.venue_id = t.venue_id
      WHERE t.archived_at IS NULL AND t.city_campaign_id IS NULL
        AND t.created_at < now() - interval '48 hours'`,
  },
  {
    name: "cold_touch_behind_mail",
    desc: "Cold-entry last touch older than newest outbound email (Gmail-send linkage class)",
    query: sql`SELECT count(*)::int AS n FROM cold_outreach_entries coe
      JOIN (SELECT t.venue_id, t.city_campaign_id, max(m.sent_at) AS max_sent
            FROM email_messages m JOIN email_threads t ON t.id = m.thread_id
            WHERE m.direction = 'outbound' AND t.venue_id IS NOT NULL
              AND t.city_campaign_id IS NOT NULL
            GROUP BY 1, 2) mm
        ON mm.venue_id = coe.venue_id AND mm.city_campaign_id = coe.city_campaign_id
      WHERE coe.archived_at IS NULL
        AND (coe.last_touch_at IS NULL OR coe.last_touch_at < mm.max_sent - interval '1 hour')`,
  },
  {
    name: "cold_duplicate_active",
    desc: "Duplicate active cold entries for the same venue + city-campaign",
    query: sql`SELECT count(*)::int AS n FROM (
      SELECT city_campaign_id, venue_id FROM cold_outreach_entries
      WHERE archived_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1) d`,
  },
  {
    name: "cold_on_archived_campaign",
    desc: "Active cold entries under an archived campaign (archive cascade missed)",
    query: sql`SELECT count(*)::int AS n FROM cold_outreach_entries e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE e.archived_at IS NULL AND c.archived_at IS NOT NULL`,
  },
  {
    name: "cold_on_archived_venue",
    desc: "Active cold entries on archived (non-merged) venues",
    query: sql`SELECT count(*)::int AS n FROM cold_outreach_entries e
      JOIN venues v ON v.id = e.venue_id
      WHERE e.archived_at IS NULL AND v.archived_at IS NOT NULL
        AND v.merged_into_venue_id IS NULL`,
  },
  {
    name: "drafts_venue_merged",
    desc: "Unsent drafts addressed to merged-away venues",
    query: sql`SELECT count(*)::int AS n FROM email_drafts d
      JOIN venues v ON v.id = d.venue_id
      WHERE d.sent_at IS NULL AND v.merged_into_venue_id IS NOT NULL`,
  },
  {
    name: "scheduled_past_stuck_silent",
    desc: "Scheduled sends >2h overdue with zero attempts (send cron not even trying)",
    query: sql`SELECT count(*)::int AS n FROM email_drafts d
      WHERE d.sent_at IS NULL AND d.scheduled_for < now() - interval '2 hours'
        AND d.send_attempts = 0`,
  },
  {
    name: "t11_gate_rows_missing",
    desc: "Confirmed wristband venues missing their participant_poster deliverable row",
    query: sql`SELECT count(*)::int AS n FROM venue_events ve
      WHERE ve.role = 'wristband' AND ve.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM crawl_deliverables d
          WHERE d.venue_event_id = ve.id AND d.deliverable_type = 'participant_poster')`,
  },
  {
    name: "deliverables_pending_on_cancelled",
    desc: "Pending deliverables on cancelled venue-events (dead work in queues)",
    query: sql`SELECT count(*)::int AS n FROM crawl_deliverables d
      JOIN venue_events ve ON ve.id = d.venue_event_id
      WHERE d.status = 'pending' AND ve.status = 'cancelled'`,
  },
  {
    name: "push_open_but_filled",
    desc: "Open replacement pushes whose slot already confirmed (close hook missed)",
    query: sql`SELECT count(*)::int AS n FROM replacement_pushes rp
      WHERE rp.status = 'open'
        AND EXISTS (SELECT 1 FROM venue_events ve
          WHERE ve.event_id = rp.event_id AND ve.role::text = rp.role
            AND ve.status = 'confirmed')`,
  },
  {
    name: "tasks_auto_pending_on_cancelled",
    desc: "Pending auto-tasks on cancelled venue-events",
    query: sql`SELECT count(*)::int AS n FROM tasks k
      JOIN venue_events ve ON ve.id = k.target_id
      WHERE k.target_type = 'venue_event' AND k.source = 'auto'
        AND k.status IN ('pending','in_progress') AND ve.status = 'cancelled'`,
  },
  {
    name: "suppressed_email_on_active_venue",
    desc: "Suppressed (bounced/unsubscribed) addresses still set as venue primary email",
    query: sql`SELECT count(*)::int AS n FROM venues v
      JOIN email_suppression s ON lower(s.email) = lower(v.email)
      WHERE v.archived_at IS NULL AND v.do_not_contact = false`,
  },
];

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

/** Run all checks; returns ONLY checks with findings (clean = empty). */
export async function runIntegrityChecks(): Promise<IntegrityCheck[]> {
  const results = await Promise.all(
    CHECKS.map(async (c) => {
      try {
        const res = await db.execute(c.query);
        return { name: c.name, desc: c.desc, count: Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0) };
      } catch {
        // A failing query is itself a finding (schema drifted under a check).
        return { name: c.name, desc: `${c.desc} (CHECK QUERY FAILED — schema drift?)`, count: -1 };
      }
    }),
  );
  return results.filter((r) => r.count !== 0);
}

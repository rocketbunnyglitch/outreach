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
        SELECT coe.venue_id, min(coe.city_campaign_id::text)::uuid AS cc_id
        FROM cold_outreach_entries coe
        JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
        JOIN campaigns c ON c.id = cc.campaign_id
        WHERE coe.archived_at IS NULL AND c.archived_at IS NULL
        GROUP BY coe.venue_id
        HAVING count(DISTINCT coe.city_campaign_id) = 1)
      SELECT count(*)::int AS n FROM email_threads t
      JOIN single_cc s ON s.venue_id = t.venue_id
      WHERE t.archived_at IS NULL AND t.city_campaign_id IS NULL
        AND t.created_at < now() - interval '48 hours'
        AND t.subject !~* 'st\\.?\\s*patrick|paddy|nye|new year|fifa|july\\s*4|4th of july|canada day|christmas|valentine'
        AND EXISTS (SELECT 1 FROM email_messages m
          JOIN city_campaigns cc2 ON cc2.id = s.cc_id
          JOIN campaigns c2 ON c2.id = cc2.campaign_id
          WHERE m.thread_id = t.id
            AND m.sent_at >= COALESCE(c2.start_date, '-infinity'::timestamptz))`,
  },
  {
    name: "tasks_on_precampaign_mail",
    desc: "Open smart-note tasks on threads with NO mail since their campaign's start_date (history tasked as work)",
    query: sql`SELECT count(*)::int AS n FROM tasks k
      JOIN email_threads t ON t.id = k.target_id
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE k.target_type = 'email_thread' AND k.source = 'smart_note'
        AND k.status IN ('pending','in_progress') AND c.start_date IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM email_messages m
          WHERE m.thread_id = t.id AND m.sent_at >= c.start_date)`,
  },
  {
    name: "threads_stamped_precampaign",
    desc: "Threads attributed to a campaign despite having NO mail since its start_date (mis-stamped history)",
    query: sql`SELECT count(*)::int AS n FROM email_threads t
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE c.archived_at IS NULL AND c.start_date IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM email_messages m
          WHERE m.thread_id = t.id AND m.sent_at >= c.start_date)`,
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
    name: "cold_touch_behind_calls",
    desc: "Cold-entry last touch older than the venue's newest matched call",
    query: sql`SELECT count(*)::int AS n FROM cold_outreach_entries coe
      JOIN (SELECT matched_venue_id AS venue_id, max(occurred_at) AS max_call
            FROM call_logs WHERE matched_venue_id IS NOT NULL GROUP BY 1) cl
        ON cl.venue_id = coe.venue_id
      WHERE coe.archived_at IS NULL
        AND (coe.last_touch_at IS NULL OR coe.last_touch_at < cl.max_call - interval '1 hour')`,
  },
  {
    name: "events_on_archived_campaign",
    desc: "Active events under an archived campaign (archive cascade missed)",
    query: sql`SELECT count(*)::int AS n FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE e.archived_at IS NULL AND c.archived_at IS NOT NULL`,
  },
  {
    name: "ve_confirmed_no_confirmed_at",
    desc: "Confirmed venue-events missing their confirmed_at stamp (breaks goals/learning by-period math)",
    query: sql`SELECT count(*)::int AS n FROM venue_events
      WHERE status = 'confirmed' AND confirmed_at IS NULL`,
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
    name: "sales_without_eb_link",
    desc: "Active events showing ticket sales with no Eventbrite link (frozen ghost numbers — sales only come from EB sync)",
    query: sql`SELECT count(*)::int AS n FROM events
      WHERE archived_at IS NULL AND eventbrite_event_id IS NULL
        AND ticket_sales_count > 0`,
  },
  {
    name: "deliverables_pending_on_cancelled",
    desc: "Pending deliverables on cancelled venue-events (dead work in queues)",
    query: sql`SELECT count(*)::int AS n FROM crawl_deliverables d
      JOIN venue_events ve ON ve.id = d.venue_event_id
      WHERE d.status = 'pending' AND ve.status = 'cancelled'`,
  },
  {
    name: "confirmed_wb_no_tracker_row",
    desc: "Confirmed future wristband venues with no shipping-tracker row (invisible to logistics/rot/health)",
    query: sql`SELECT count(*)::int AS n FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      WHERE ve.role = 'wristband' AND ve.status = 'confirmed'
        AND e.archived_at IS NULL AND e.event_date >= now()::date
        AND NOT EXISTS (SELECT 1 FROM wristbands w WHERE w.venue_event_id = ve.id)`,
  },
  {
    name: "pending_deliverables_on_archived_events",
    desc: "Pending deliverables on archived events (campaign-close cascade should have closed them)",
    query: sql`SELECT count(*)::int AS n FROM crawl_deliverables d
      JOIN venue_events ve ON ve.id = d.venue_event_id
      JOIN events e ON e.id = ve.event_id
      WHERE d.status = 'pending' AND e.archived_at IS NOT NULL`,
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
    name: "lineup_log_missed_confirm",
    desc: "Post-B1 confirms with no durable lineup-log row (a writer path was missed)",
    query: sql`SELECT count(*)::int AS n FROM venue_events ve
      WHERE ve.confirmed_at > '2026-06-11 14:00:00+00'
        AND ve.confirmed_at < now() - interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM lineup_change_events l
          WHERE l.venue_event_id = ve.id AND l.change_type = 'confirmed')`,
  },
  {
    name: "lineup_log_missed_cancel",
    desc: "Post-B1 cancels with no durable lineup-log row",
    query: sql`SELECT count(*)::int AS n FROM venue_events ve
      WHERE ve.cancelled_at > '2026-06-11 14:00:00+00'
        AND ve.cancelled_at < now() - interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM lineup_change_events l
          WHERE l.venue_event_id = ve.id AND l.change_type = 'cancelled')`,
  },
  {
    name: "tasks_thread_target_orphan",
    desc: "Open tasks targeting email threads that no longer exist",
    query: sql`SELECT count(*)::int AS n FROM tasks k
      WHERE k.target_type = 'email_thread' AND k.status IN ('pending','in_progress')
        AND NOT EXISTS (SELECT 1 FROM email_threads t WHERE t.id = k.target_id)`,
  },
  {
    name: "tasks_smartnote_out_of_scope",
    desc: "Open smart-note tasks on threads outside any active campaign (historical-mail pollution)",
    query: sql`SELECT count(*)::int AS n FROM tasks k
      JOIN email_threads t ON t.id = k.target_id
      WHERE k.target_type = 'email_thread' AND k.source = 'smart_note'
        AND k.status IN ('pending','in_progress')
        AND (t.city_campaign_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM city_campaigns cc JOIN campaigns c ON c.id = cc.campaign_id
          WHERE cc.id = t.city_campaign_id AND c.archived_at IS NULL))`,
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
    name: "drafts_gmail_sent_unsaved",
    desc: "Drafts claimed >24h with no thread link (Gmail-accepted-but-unsaved markers) — resolve each by hand: re-release if never delivered, link thread if it was",
    query: sql`SELECT count(*)::int AS n FROM email_drafts
      WHERE sent_at IS NOT NULL AND sent_thread_id IS NULL
        AND sent_at < now() - interval '24 hours'`,
  },
  {
    name: "audit_churn_connected_accounts",
    desc: "connected_accounts audit rows from system writes in the last 24h (churn suppression regressed — was 26k/day before migration 0139)",
    query: sql`SELECT CASE WHEN count(*) > 500 THEN count(*)::int ELSE 0 END AS n FROM audit_log
      WHERE table_name = 'connected_accounts' AND changed_by IS NULL
        AND changed_at > now() - interval '24 hours'`,
  },
  {
    name: "audit_secrets_in_snapshots",
    desc: "audit_log snapshots still containing gmail_oauth_refresh_token (migration 0139 redaction regressed)",
    query: sql`SELECT count(*)::int AS n FROM audit_log
      WHERE table_name = 'connected_accounts'
        AND (COALESCE(old_values ? 'gmail_oauth_refresh_token', false)
             OR COALESCE(new_values ? 'gmail_oauth_refresh_token', false))`,
  },
  {
    name: "self_venue_active",
    desc: "Active venues whose email is on one of OUR domains (own transactional/staff mail auto-created as a venue)",
    query: sql`SELECT count(*)::int AS n FROM venues v
      WHERE v.archived_at IS NULL AND v.email IS NOT NULL
        AND (lower(split_part(v.email,'@',2)) IN
               (SELECT lower(split_part(email_address,'@',2)) FROM connected_accounts)
             OR lower(split_part(v.email,'@',2)) IN ('barcrawlconnect.com','outreach.barcrawlconnect.com'))`,
  },
  {
    name: "corpus_own_domain_pollution",
    desc: "Learning-corpus rows whose inbound sender is one of OUR domains (staff inter-inbox mail poisoning few-shot)",
    query: sql`SELECT (
      (SELECT count(*) FROM reply_examples re JOIN email_messages m ON m.id = re.inbound_message_id
        WHERE lower(split_part(m.from_email_normalized,'@',2)) IN
          (SELECT lower(split_part(email_address,'@',2)) FROM connected_accounts))
      + (SELECT count(*) FROM classification_examples ce JOIN email_messages m ON m.id = ce.message_id
        WHERE lower(split_part(m.from_email_normalized,'@',2)) IN
          (SELECT lower(split_part(email_address,'@',2)) FROM connected_accounts))
    )::int AS n`,
  },
  {
    name: "account_sending_without_campaign",
    desc: "Connected accounts with venue threads in the last 30d but NO campaign assignment (brand resolution + touch logging silently fail for their sends)",
    query: sql`SELECT count(DISTINCT ca.id)::int AS n FROM connected_accounts ca
      JOIN email_threads t ON t.staff_outreach_email_id = ca.id
      WHERE t.created_at > now() - interval '30 days' AND t.venue_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM campaign_connected_accounts cca
          WHERE cca.connected_account_id = ca.id)`,
  },
  {
    name: "cca_null_brand_active",
    desc: "Campaign-account assignments on ACTIVE campaigns missing an outreach brand (sends cannot resolve brand context)",
    query: sql`SELECT count(*)::int AS n FROM campaign_connected_accounts cca
      JOIN campaigns c ON c.id = cca.campaign_id
      WHERE c.archived_at IS NULL AND cca.outreach_brand_id IS NULL`,
  },
  {
    name: "venues_email_malformed",
    desc: "Active venues whose email field is not a single clean address (status text / multi-address blobs break validation, suppression matching, retro-linking)",
    query: sql`SELECT count(*)::int AS n FROM venues
      WHERE archived_at IS NULL AND email IS NOT NULL
        AND email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+$'`,
  },
  {
    name: "placeholder_venue_active",
    desc: "Active venues with placeholder names (Test / Venue Name / TBD — template rows imported as venues)",
    query: sql`SELECT count(*)::int AS n FROM venues
      WHERE archived_at IS NULL
        AND lower(name) IN ('venue name','venue','name','test','tbd','example')`,
  },
  {
    name: "cold_outbound_no_touchrow",
    desc: "Cold-context outbound venue mail missing a cadence touch-log row (anti-spam floor undercounts; lifecycle mail to confirmed/cancelled venues is excluded by design)",
    query: sql`SELECT count(*)::int AS n FROM email_messages m
      JOIN email_threads t ON t.id = m.thread_id
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      JOIN campaign_connected_accounts cca
        ON cca.connected_account_id = t.staff_outreach_email_id
       AND cca.campaign_id = cc.campaign_id
      WHERE m.direction = 'outbound' AND t.venue_id IS NOT NULL
        AND cca.outreach_brand_id IS NOT NULL
        AND m.sent_at < now() - interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM venue_campaign_touch_log tl
          WHERE tl.email_message_id = m.id
             OR (tl.venue_id = t.venue_id AND tl.campaign_id = cc.campaign_id
                 AND tl.sent_at BETWEEN m.sent_at - interval '5 minutes'
                                    AND m.sent_at + interval '5 minutes'))
        AND NOT EXISTS (SELECT 1 FROM venue_events ve
          JOIN events e ON e.id = ve.event_id
          WHERE ve.venue_id = t.venue_id
            AND e.city_campaign_id = t.city_campaign_id
            AND ve.status IN ('confirmed','cancelled'))`,
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

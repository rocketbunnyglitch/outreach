#!/usr/bin/env bash
# Data-linkage integrity harness (FULL_AUDIT_PLAN P005).
#
# One named, READ-ONLY check per invariant. A check that returns a
# non-zero count prints FINDING with the count; the script exits with
# the number of failing checks. Wave-1 phases append checks here as
# they formalize each linkage family — this file is the living
# contract for "data that is the same must agree".
#
# Usage: bash scripts/audit-data-links.sh            (all checks)
#        bash scripts/audit-data-links.sh <name>     (one check)

set -u

PSQL() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -tAc "$1"
  else
    sudo -u postgres psql crawl_engine -tAc "$1"
  fi
}

FAILS=0
ONLY="${1:-}"

check() {
  local name="$1" desc="$2" sql="$3"
  if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then return; fi
  local n
  n=$(PSQL "$sql" 2>&1)
  if ! [[ "$n" =~ ^[0-9]+$ ]]; then
    echo "ERROR   $name: query failed: $n"
    FAILS=$((FAILS + 1))
    return
  fi
  if [ "$n" -gt 0 ]; then
    echo "FINDING $name: $n — $desc"
    FAILS=$((FAILS + 1))
  else
    echo "ok      $name"
  fi
}

# ---- threads ↔ venues / city_campaigns -----------------------------------
check threads_venue_orphan \
  "email_threads.venue_id points at a missing venue" \
  "SELECT count(*) FROM email_threads t WHERE t.venue_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM venues v WHERE v.id = t.venue_id)"

check threads_venue_merged \
  "threads still pointing at a MERGED-away venue (should follow merged_into chain)" \
  "SELECT count(*) FROM email_threads t JOIN venues v ON v.id = t.venue_id
   WHERE v.merged_into_venue_id IS NOT NULL"

check threads_cc_archived_campaign \
  "threads attributed to a city_campaign of an archived campaign" \
  "SELECT count(*) FROM email_threads t
   JOIN city_campaigns cc ON cc.id = t.city_campaign_id
   JOIN campaigns c ON c.id = cc.campaign_id
   WHERE c.archived_at IS NOT NULL AND t.archived_at IS NULL"

check threads_unlinked_exact_email \
  "threads >48h old whose inbound sender exactly matches a venue email but never linked (nightly retro-link should heal)" \
  "SELECT count(*) FROM (
     SELECT t.id, lower((regexp_match(m.from_address, '<([^>]+)>'))[1]) AS addr
     FROM email_threads t
     JOIN LATERAL (SELECT from_address FROM email_messages
       WHERE thread_id = t.id AND direction = 'inbound'
       ORDER BY sent_at DESC LIMIT 1) m ON true
     WHERE t.archived_at IS NULL AND t.venue_id IS NULL
       AND t.created_at < now() - interval '48 hours') u
   JOIN venues v ON lower(v.email) = u.addr AND v.archived_at IS NULL"

check threads_venue_no_cc_unambig \
  "venue-linked threads >48h old with NO campaign attribution despite an unambiguous single active city-campaign (nightly backfill should heal)" \
  "WITH single_cc AS (
     SELECT coe.venue_id
     FROM cold_outreach_entries coe
     JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
     JOIN campaigns c ON c.id = cc.campaign_id
     WHERE coe.archived_at IS NULL AND c.archived_at IS NULL
     GROUP BY coe.venue_id
     HAVING count(DISTINCT coe.city_campaign_id) = 1)
   SELECT count(*) FROM email_threads t
   JOIN single_cc s ON s.venue_id = t.venue_id
   WHERE t.archived_at IS NULL AND t.city_campaign_id IS NULL
     AND t.created_at < now() - interval '48 hours'
     AND t.subject !~* 'st\\.?\\s*patrick|paddy|nye|new year|fifa|july\\s*4|4th of july|canada day|christmas|valentine'"

# ---- messages ↔ threads ----------------------------------------------------
check thread_message_count_drift \
  "email_threads.message_count disagrees with actual email_messages rows" \
  "SELECT count(*) FROM (
     SELECT t.id FROM email_threads t
     JOIN email_messages m ON m.thread_id = t.id
     GROUP BY t.id, t.message_count
     HAVING count(m.id) <> t.message_count) d"

check thread_last_message_drift \
  "email_threads.last_message_at older than its newest message (>2min skew)" \
  "SELECT count(*) FROM (
     SELECT t.id FROM email_threads t
     JOIN email_messages m ON m.thread_id = t.id
     GROUP BY t.id, t.last_message_at
     HAVING max(m.sent_at) > t.last_message_at + interval '2 minutes') d"

# ---- drafts ----------------------------------------------------------------
check drafts_thread_orphan \
  "email_drafts.sent_thread_id points at a missing thread" \
  "SELECT count(*) FROM email_drafts d WHERE d.sent_thread_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM email_threads t WHERE t.id = d.sent_thread_id)"

check drafts_push_orphan \
  "email_drafts.replacement_push_id points at a missing push" \
  "SELECT count(*) FROM email_drafts d WHERE d.replacement_push_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM replacement_pushes p WHERE p.id = d.replacement_push_id)"

check drafts_venue_merged   "unsent drafts addressed to merged-away venues"   "SELECT count(*) FROM email_drafts d JOIN venues v ON v.id = d.venue_id
   WHERE d.sent_at IS NULL AND v.merged_into_venue_id IS NOT NULL"

check scheduled_past_stuck_silent   "scheduled sends >2h overdue with ZERO attempts (cron not even trying)"   "SELECT count(*) FROM email_drafts d
   WHERE d.sent_at IS NULL AND d.scheduled_for < now() - interval '2 hours'
     AND d.send_attempts = 0"

# ---- cold entries ----------------------------------------------------------
check cold_venue_merged \
  "active cold entries on merged-away venues" \
  "SELECT count(*) FROM cold_outreach_entries e
   JOIN venues v ON v.id = e.venue_id
   WHERE e.archived_at IS NULL AND v.merged_into_venue_id IS NOT NULL"

check cold_duplicate_active \
  "duplicate ACTIVE cold entries per (city_campaign, venue)" \
  "SELECT count(*) FROM (
     SELECT city_campaign_id, venue_id FROM cold_outreach_entries
     WHERE archived_at IS NULL
     GROUP BY 1, 2 HAVING count(*) > 1) d"

check cold_on_archived_campaign \
  "active cold entries under an ARCHIVED campaign (archive cascade missed)" \
  "SELECT count(*) FROM cold_outreach_entries e
   JOIN city_campaigns cc ON cc.id = e.city_campaign_id
   JOIN campaigns c ON c.id = cc.campaign_id
   WHERE e.archived_at IS NULL AND c.archived_at IS NOT NULL"

check cold_on_archived_venue \
  "active cold entries on archived (non-merged) venues" \
  "SELECT count(*) FROM cold_outreach_entries e
   JOIN venues v ON v.id = e.venue_id
   WHERE e.archived_at IS NULL AND v.archived_at IS NOT NULL
     AND v.merged_into_venue_id IS NULL"

check cold_touch_behind_mail \
  "cold entry last_touch_at older than newest outbound message for same venue+cc (>1h)" \
  "SELECT count(*) FROM cold_outreach_entries coe
   JOIN (
     SELECT t.venue_id, t.city_campaign_id, max(m.sent_at) AS max_sent
     FROM email_messages m JOIN email_threads t ON t.id = m.thread_id
     WHERE m.direction = 'outbound' AND t.venue_id IS NOT NULL
       AND t.city_campaign_id IS NOT NULL
     GROUP BY 1, 2) mm
     ON mm.venue_id = coe.venue_id AND mm.city_campaign_id = coe.city_campaign_id
   WHERE coe.archived_at IS NULL
     AND (coe.last_touch_at IS NULL OR coe.last_touch_at < mm.max_sent - interval '1 hour')"

check cold_touch_behind_calls \
  "cold entry last_touch_at older than newest matched call for the venue (>1h)" \
  "SELECT count(*) FROM cold_outreach_entries coe
   JOIN (SELECT matched_venue_id AS venue_id, max(occurred_at) AS max_call
         FROM call_logs WHERE matched_venue_id IS NOT NULL GROUP BY 1) cl
     ON cl.venue_id = coe.venue_id
   WHERE coe.archived_at IS NULL
     AND (coe.last_touch_at IS NULL OR coe.last_touch_at < cl.max_call - interval '1 hour')"

# ---- venue_events ----------------------------------------------------------
check events_on_archived_campaign \
  "active events under an ARCHIVED campaign (archive cascade missed)" \
  "SELECT count(*) FROM events e
   JOIN city_campaigns cc ON cc.id = e.city_campaign_id
   JOIN campaigns c ON c.id = cc.campaign_id
   WHERE e.archived_at IS NULL AND c.archived_at IS NOT NULL"

check ve_confirmed_no_confirmed_at \
  "confirmed venue_events missing their confirmed_at stamp (writer hole)" \
  "SELECT count(*) FROM venue_events
   WHERE status = 'confirmed' AND confirmed_at IS NULL"

check ve_event_orphan \
  "venue_events pointing at missing events" \
  "SELECT count(*) FROM venue_events ve
     WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ve.event_id)"

check ve_confirmed_on_archived_event \
  "confirmed venue_events on archived FUTURE events (a live booking on a crawl someone archived)" \
  "SELECT count(*) FROM venue_events ve JOIN events e ON e.id = ve.event_id
   WHERE ve.status = 'confirmed' AND e.archived_at IS NOT NULL
     AND e.event_date >= now()::date"

check ve_cross_city_confirmed \
  "future confirmed venue_events whose venue city <> crawl city" \
  "SELECT count(*) FROM venue_events ve
   JOIN venues v ON v.id = ve.venue_id
   JOIN events e ON e.id = ve.event_id
   JOIN city_campaigns cc ON cc.id = e.city_campaign_id
   WHERE ve.status = 'confirmed' AND v.city_id <> cc.city_id
     AND e.event_date >= now()::date"

check sales_without_eb_link \
  "active events showing ticket sales with NO Eventbrite link (sales only ever come from EB sync — frozen ghost numbers)" \
  "SELECT count(*) FROM events
   WHERE archived_at IS NULL AND eventbrite_event_id IS NULL
     AND ticket_sales_count > 0"

# ---- deliverables / wristbands / pushes ------------------------------------
check t11_gate_rows_missing \
  "confirmed wristband venue_events with NO participant_poster deliverable row" \
  "SELECT count(*) FROM venue_events ve
   WHERE ve.role = 'wristband' AND ve.status = 'confirmed'
     AND NOT EXISTS (SELECT 1 FROM crawl_deliverables d
       WHERE d.venue_event_id = ve.id AND d.deliverable_type = 'participant_poster')"

check deliverables_pending_on_cancelled \
  "pending deliverables on CANCELLED venue_events (dead work in queues)" \
  "SELECT count(*) FROM crawl_deliverables d
   JOIN venue_events ve ON ve.id = d.venue_event_id
   WHERE d.status = 'pending' AND ve.status = 'cancelled'"

check confirmed_wb_no_tracker_row \
  "confirmed future wristband venues with NO wristband shipping-tracker row (invisible to logistics/rot/health)" \
  "SELECT count(*) FROM venue_events ve
   JOIN events e ON e.id = ve.event_id
   WHERE ve.role = 'wristband' AND ve.status = 'confirmed'
     AND e.archived_at IS NULL AND e.event_date >= now()::date
     AND NOT EXISTS (SELECT 1 FROM wristbands w WHERE w.venue_event_id = ve.id)"

check pending_deliverables_on_archived_events \
  "pending deliverables on ARCHIVED events (campaign-close cascade should have N/A-ed them)" \
  "SELECT count(*) FROM crawl_deliverables d
   JOIN venue_events ve ON ve.id = d.venue_event_id
   JOIN events e ON e.id = ve.event_id
   WHERE d.status = 'pending' AND e.archived_at IS NOT NULL"

check push_open_but_filled \
  "open replacement pushes whose (event, role) already has a confirmed venue" \
  "SELECT count(*) FROM replacement_pushes rp
   WHERE rp.status = 'open'
     AND EXISTS (SELECT 1 FROM venue_events ve
       WHERE ve.event_id = rp.event_id AND ve.role::text = rp.role
         AND ve.status = 'confirmed')"

check lineup_log_missed_confirm \
  "post-B1 confirms with NO lineup_change_events row (durable-log writer missed a path; 1h grace)" \
  "SELECT count(*) FROM venue_events ve
   WHERE ve.confirmed_at > '2026-06-11 14:00:00+00'
     AND ve.confirmed_at < now() - interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM lineup_change_events l
       WHERE l.venue_event_id = ve.id AND l.change_type = 'confirmed')"

check lineup_log_missed_cancel \
  "post-B1 cancels with NO lineup_change_events row (1h grace)" \
  "SELECT count(*) FROM venue_events ve
   WHERE ve.cancelled_at > '2026-06-11 14:00:00+00'
     AND ve.cancelled_at < now() - interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM lineup_change_events l
       WHERE l.venue_event_id = ve.id AND l.change_type = 'cancelled')"

# ---- polymorphic targets ----------------------------------------------------
check tasks_thread_target_orphan \
  "open tasks targeting email threads that no longer exist" \
  "SELECT count(*) FROM tasks k
   WHERE k.target_type = 'email_thread' AND k.status IN ('pending','in_progress')
     AND NOT EXISTS (SELECT 1 FROM email_threads t WHERE t.id = k.target_id)"

check tasks_smartnote_out_of_scope \
  "open smart-note tasks on threads NOT attributed to an active campaign (historical-mail pollution class)" \
  "SELECT count(*) FROM tasks k
   JOIN email_threads t ON t.id = k.target_id
   WHERE k.target_type = 'email_thread' AND k.source = 'smart_note'
     AND k.status IN ('pending','in_progress')
     AND (t.city_campaign_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM city_campaigns cc JOIN campaigns c ON c.id = cc.campaign_id
       WHERE cc.id = t.city_campaign_id AND c.archived_at IS NULL))"

check tasks_target_orphan_ve \
  "tasks targeting venue_events that no longer exist" \
  "SELECT count(*) FROM tasks k
   WHERE k.target_type = 'venue_event' AND k.status IN ('pending','in_progress')
     AND NOT EXISTS (SELECT 1 FROM venue_events ve WHERE ve.id = k.target_id)"

check tasks_target_orphan_venue \
  "open tasks targeting missing venues" \
  "SELECT count(*) FROM tasks k
   WHERE k.target_type = 'venue' AND k.status IN ('pending','in_progress')
     AND NOT EXISTS (SELECT 1 FROM venues v WHERE v.id = k.target_id)"

check tasks_auto_pending_on_cancelled \
  "pending AUTO tasks on cancelled venue_events" \
  "SELECT count(*) FROM tasks k
   JOIN venue_events ve ON ve.id = k.target_id
   WHERE k.target_type = 'venue_event' AND k.source = 'auto'
     AND k.status IN ('pending','in_progress') AND ve.status = 'cancelled'"

check notes_target_orphan_venue \
  "notes targeting missing venues" \
  "SELECT count(*) FROM notes n
   WHERE n.target_type = 'venue'
     AND NOT EXISTS (SELECT 1 FROM venues v WHERE v.id = n.target_id)"

# ---- suppression ↔ venues ---------------------------------------------------
check venues_email_malformed \
  "active venues whose email field is not a single clean address (status text / multi-address blobs break validation, suppression matching, retro-linking)" \
  "SELECT count(*) FROM venues
   WHERE archived_at IS NULL AND email IS NOT NULL
     AND email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+\$'"

check placeholder_venue_active \
  "active venues with placeholder names (Test / Venue Name / TBD — spreadsheet template rows imported as venues)" \
  "SELECT count(*) FROM venues
   WHERE archived_at IS NULL
     AND lower(name) IN ('venue name','venue','name','test','tbd','example')"

check cold_outbound_no_touchrow \
  "cold-context outbound venue mail with NO cadence touch-log row (floor undercounts; lifecycle mail correctly excluded; 1h grace)" \
  "SELECT count(*) FROM email_messages m
   JOIN email_threads t ON t.id = m.thread_id
   JOIN city_campaigns cc ON cc.id = t.city_campaign_id
   JOIN campaign_connected_accounts cca
     ON cca.connected_account_id = t.staff_outreach_email_id
    AND cca.campaign_id = cc.campaign_id
   WHERE m.direction = 'outbound' AND t.venue_id IS NOT NULL
     AND cca.outreach_brand_id IS NOT NULL
     AND m.sent_at < now() - interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM venue_campaign_touch_log tl
       WHERE tl.email_message_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM venue_events ve
       JOIN events e ON e.id = ve.event_id
       WHERE ve.venue_id = t.venue_id
         AND e.city_campaign_id = t.city_campaign_id
         AND ve.status IN ('confirmed','cancelled'))"

check suppressed_email_on_active_venue \
  "suppressed addresses still set as an active venue's primary email" \
  "SELECT count(*) FROM venues v
   JOIN email_suppression s ON lower(s.email) = lower(v.email)
   WHERE v.archived_at IS NULL AND v.do_not_contact = false"

echo "----"
echo "failing checks: $FAILS"
exit "$FAILS"

# FULL DEEP AUDIT PLAN — every tab, every feature, every linkage

> Operator directive (2026-06-11): full deep review + audit of every tab and
> every feature; cross-check ALL data for linkage breaks and orphans (the
> email-analytics class); every tab 10/10 UI/UX desktop AND mobile; every
> page + feature best-in-class for its purpose. Fix everything found. Audit
> own work after each fix. Multi-week; never stop to ask; skip-and-flag
> blockers. THIS DOCUMENT is the durable plan — compaction-proof.

## Standing protocol (read every session)
- Work the next unchecked phase. Check off `[x sha]` (or `[x note]` for
  data-only phases) IMMEDIATELY after each phase completes. Findings go
  inline under the phase line as indented `» finding/fix` notes.
- Ship loop: edit local mirror D:\Projects\Bash\_work\qa-fixes (cd FIRST —
  cwd drifts) → scp → biome --write + biome error-level + tsc + vitest +
  audit-server-only-imports.sh + audit-raw-sql.sh → commit (msg via file if
  apostrophes) → push → bash /root/deploy.sh. Batch multiple phases per
  deploy; deploy at least once per session end.
- Raw SQL: verify EVERY column against live schema first (psql \d).
- After each fix: re-run the scan/check that found the issue + the full
  test suite. A fix is not done until its own audit passes.
- Memory file project_qa_pass_2026_06_10.md holds the CURSOR (next phase).
  Update it at every session end + after every 10 phases.
- SKIP-AND-FLAG list (not implemented yet; do not build, collect at end):
  participant-poster generation pipeline, Twilio/SMS provider build-out,
  E3 autonomy dispatch (user sign-off), E4 restore drill (user approval).
- UI verification: Claude-in-Chrome against the user's logged-in session
  when available; otherwise reasoned DOM/code audit + screenshot requests.
  Mobile = 390px; desktop = 1440px.

## Wave 0 — Foundations
- [x 8b3bdfd] P001 Commit this plan; memory cursor entry
- [x 8b3bdfd] P002 Route inventory snapshot docs/_audit/routes.txt (94 routes)
- [x] P003 Harness skeleton (folded into P005)
- [x] P004 Polymorphic refs catalogued: tasks/notes(target_type,target_id), goals(scope,scope_id), action_verdicts(subject_id), smart-note suggestions; logical-FK columns covered check-by-check in Wave 1
- [x] P005 scripts/audit-data-links.sh built — 21 named read-only checks, exit=#failures
- [x] P006 Integrity checks wired IN-APP instead of OS cron (permission layer
  declined a new crontab entry; in-app is better anyway): lib/data-integrity.ts
  mirrors the harness invariants, surfaces on /admin/data-quality (red
  "Linkage integrity" section) AND the command center (problems-only). Bash
  harness stays the manual/pre-deploy runner; the two lists must stay in sync.
- [x] P007 Feature inventory vs refdoc section map — 6 features were missing
  from Wave 3; appended as P348-P353 (see Wave 3 extension). Refdoc sections
  confirmed otherwise covered: §0 principles (enforced via gates/audits),
  §1 priorities (P296/P316), §3 domains (P314+P078), §4 conventions (E3
  compliance gate), §6 cadence (P280), §7 lifecycle (P292-295), §8 templates
  (P288), §10 future items (out of scope by refdoc's own ruling).
- [x] P008 Baseline run: 5 failures (2 harness bugs + 3 real)
  » thread_message_count_drift 2353: WRITER BUG — gmail poller bumped thread counters on duplicate redeliveries (onConflictDoNothing no-op still incremented message_count/unread_count and advanced last_*_at). Fixed: ingestMessage early-returns null when no row inserted. Data: 3,381 threads reconciled (counts + unread clamped to real inbound).
  » cold_touch_behind_mail 8: residue since earlier backfill — topped up; poller fix (9f788b5) keeps it green forward.
  » suppressed_email_on_active_venue 2: Classic Jewel + Kremwerk had hard-bounced primary emails — cleared to NULL + internal note so re-enrichment is driven instead of a fake contact method.
  » harness bugs fixed: drafts check now uses sent_thread_id; push check casts ve.role::text.
  » Re-run after repairs: 21/21 ok.

## Wave 1 — Data linkage + integrity (define invariant → scan → fix data → fix writer → permanent check)
Each family = 3 phases: (a) scan+diagnose, (b) fix data + fix writing code, (c) permanent check added + re-scan clean.
- [x] P009-P011 email_threads ↔ venues
  » orphans 0, merged-chain 0 (harness green from baseline).
  » Match QUALITY finding: 648 unmatched threads with parseable sender; 21
    exactly matched a venue primary email + 6 by website domain (non-freemail)
    — threads that arrived BEFORE their venue existed; nothing retro-linked.
    Data: 27 linked (domain ones at 0.70 confidence). Writer: nightly
    retro-link step added to stale-tagger (exact-email only — domain too
    fuzzy to automate). Permanent check threads_unlinked_exact_email (>48h)
    added to BOTH lists. Remaining ~620 unmatched = genuinely non-venue or
    unknown senders; revisit rate in P282 (poll/match-rate feature audit).
- [x] P012-P014 email_threads ↔ city_campaigns
  » 81 venue-linked threads had NULL cc despite an unambiguous single active
    city-campaign — invisible to city inbox / campaign scope / NBA warm
    loaders / learning stats. Backfilled all 81. cc-vs-cold mismatches: 0.
    Archived-campaign cc: 0 (harness). Writer: same temporal class — nightly
    stale-tagger now also backfills unambiguous cc. Invariant
    threads_venue_no_cc_unambig (>48h) in BOTH lists. Ambiguous multi-cc
    venues deliberately left null for human attribution.
- [x] P015-P017 email_messages ↔ threads
  » Counter corruption fixed at P008 (poller duplicate bump @b695aea; 3,381
    reconciled). last_message drift: 0. Direction consistency: 0 both ways
    (should-be-mixed and marked-mixed-but-single). Family closed.
- [x] P018-P020 email_drafts family
  » ALL CLEAN: lifecycle-draft-without-VE 0, drafts-on-closed-push 0, venue
    orphans 0, merged-venue drafts 0, silently-stuck scheduled 0. Two
    invariants added to BOTH lists (drafts_venue_merged,
    scheduled_past_stuck_silent — the latter catches a dead send-cron).
    Lesson: python file edits on Windows need newline='' (CRLF broke the bash
    harness once; both copies LF-normalized).
- [x] P021-P023 email_send_events
  » ALL CLEAN over 30d window (114 sends): thread attribution 0 missing, VE
    references 0 dangling, draft-vs-send template agreement 0 mismatches.
    The attribution chain under analytics/learning/Loop C is sound.
- [x] P024-P026 cold_outreach_entries ↔ venues/city_campaigns
  » BIG: 8,780 active cold entries under three ARCHIVED past campaigns
    (Halloween 2025 / NYE 2026 / St Paddy's 2026) — campaign archive never
    cascaded to its working set. Data: all archived with the campaign's own
    archive date. Writer: archiveCampaignWrites shared core now cascades in
    both archive actions, atomically. +2 active-on-archived-venue entries
    closed. venue-on-crawl-with-no-cold-entry: 0 (promote wiring sound).
    Invariants cold_on_archived_campaign + cold_on_archived_venue in BOTH
    lists.
- [x] P027-P029 touch reconciliation, call side
  » cold_touch_behind_calls: 0 — call paths already bump touches correctly.
    Invariant added to BOTH lists so it stays watched. Email side previously
    healed + chained in the nightly tagger.
- [x] P030-P032 venue_events ↔ events/venues
  » Orphans/archived/cross-city/duplicates: all 0 (harness + new probes).
  » FINDING: 2,507 confirmed VEs had NULL confirmed_at (stamp only existed
    on the update path, added recently) — goals confirmations, E1 learning
    by-period and "confirmed N days ago" were blind to ALL historical
    confirms. Backfilled every one with REAL timestamps mined from
    audit_log (earliest status->confirmed transition; zero needed the
    created_at fallback). Writer hole closed: addVenueToEvent now stamps
    direct-as-confirmed inserts. Invariant ve_confirmed_no_confirmed_at in
    BOTH lists.
- [x] P033-P035 venue_events cadence stamps vs drafts
  » CLEAN all four directions (sent 2wk/1wk drafts all stamped; all stamps
    backed by a real sent draft). The lifecycle bookkeeping matches reality.
- [x] P036-P038 events chain + format consistency
  » Same archive-cascade class as P024: 679 active events under the three
    archived past campaigns — archived with the campaign date; the
    archiveCampaignWrites cascade now closes events too. day_party-with-
    final-required: 0. Future events with zero required counts: 0.
    Invariant events_on_archived_campaign in BOTH lists.
  » OPERATOR CONTEXT (2026-06-11): the three archived campaigns are IMPORTED
    HISTORICAL DATA (old venue events seeded for relationship history) — the
    operator has never run a campaign besides Halloween 2026. Archival is
    therefore doubly correct. Nuance: their backfilled confirmed_at = import
    moment (May 31 / Jun 1), not original real-world dates (never captured).
    Verified outside the Recent-wins 7d window (current window = 12 real
    Halloween confirms). Do not read archived-event VE timestamps as
    operational telemetry.
- [ ] P039-P041 eventbrite links ↔ events (eb id set but sync never ran; sales>0 with no eb link; dangling eb ids)
- [ ] P042-P044 wristbands ↔ venue_events (wristband rows on non-wristband-role VE; confirmed wristband VE with no wristband row; status vs shipped_at/delivered_at consistency)
- [ ] P045-P047 crawl_hosts/internal_hosts/external_hosts ↔ events (hosts on archived events; external_host_shipments cc mismatch with host assignment)
- [ ] P048-P050 crawl_deliverables ↔ venue_events (deliverables on cancelled VE still pending; T11-gate rows present for all confirmed wristbands — re-verify backfill)
- [ ] P051-P053 replacement_pushes ↔ events/drafts (open pushes whose role since confirmed → should be filled; drafts with push_id whose push closed)
- [ ] P054-P056 lineup_change_events ↔ events (writer coverage: every confirm/cancel since deploy has a row; payload allowlist re-audit)
- [ ] P057-P059 tasks (polymorphic targetType/targetId): orphan targets per type; auto tasks on cancelled VE still pending
- [ ] P060-P062 notes + smart_notes (polymorphic): orphan targets; suggestions pointing at deleted notes
- [ ] P063-P065 notifications (link_path validity sample; staff_id orphans; unread counts sane)
- [ ] P066-P068 outreach_log ↔ venues/staff/brands (orphans; channel/outcome enum drift; provenance rows counted in metrics — re-verify after linkage fix)
- [ ] P069-P071 venue_campaign_touch_log ↔ messages/venues (touch rows without message; messages without touch row where expected)
- [ ] P072-P074 email_suppression ↔ messages/venues (suppressed addresses still on active venues' email field; bounce reason vs thread bounce flags)
- [ ] P075-P077 venue_contacts/alternate_emails ↔ threads (replying senders not in contacts; contacts never linked to any thread)
- [ ] P078-P080 connected_accounts ↔ campaign_connected_accounts ↔ brands (accounts with no campaign assignment sending venue mail; alias coverage — re-verify; owner_user_id vs users.status)
- [ ] P081-P083 learning loop tables ↔ threads/drafts (reply_examples thread orphans; classification_examples drift; suggestion_meta ids valid)
- [ ] P084-P086 action_verdicts/autonomy_policies (subject_id orphans per action_type; verdict counts vs dashboard)
- [ ] P087-P089 goals ↔ scopes (scopeId orphans per scope type; period sanity)
- [ ] P090-P092 venues master-field sync (email/phone/contact_name vs newest venue_contacts + crawl night-of contacts — the "venue details not syncing" class; define canonical direction + reconcile)
- [ ] P093-P095 cities (timezone blanks; venues in archived cities; cc city vs venue city overlaps)
- [ ] P096-P098 calls (call_logs/quo) ↔ venues/cold entries (matched_venue orphans; call outcomes not bumping last_touch — same class as email fix)
- [ ] P099-P101 saved views / labels / snippets ↔ owners (orphan owners; team scoping)
- [ ] P102-P104 audit_log sanity (recent writes attributed; no PII leak in diffs sample)
- [ ] P105 Harness complete: all checks green or accepted-with-note; baseline vs final counts recorded here

## Wave 2 — Tab-by-tab audits (per tab: F=function+data, D=desktop UI 10/10, M=mobile 10/10, B=best-in-class gaps, X=fixes+re-audit)
Order = operator-critical first. Each tab gets 4 phase slots (F+D, M, B, X) unless noted.
- [ ] P106-P109 / (dashboard: KPIs, command card, NBA widget, tracker, digest)
- [ ] P110-P113 /inbox (list, folders, bulk, filters) — heaviest tab, double care
- [ ] P114-P117 /inbox/[threadId] + ThreadPane (read, reply, chips, classification, snooze, assign)
- [ ] P118-P121 composer (windowed, templates, merge preview, attachments, schedule, signatures)
- [ ] P122-P125 /city-campaigns/[id] (cold table, warm table, crawl tables, map, city inbox, handoff)
- [ ] P126-P129 /city-campaigns/[id]/print + print fidelity
- [ ] P130-P133 /venues + /venues/new (list, filters, bulk, dedupe warning)
- [ ] P134-P137 /venues/[id] (deal room: contacts, comm timeline, activity, relationships, enrichment, wristbands, duplicates card)
- [ ] P138-P141 /events/[id] (form, venue-events section, gates UX, cancellation playbook, replacement push, EB cell)
- [ ] P142-P145 /pipeline (board, drags, gates, post-confirm board strays — resolve or remove strays)
- [ ] P146-P149 /tracker (sales, statuses, refresh, EB linkage)
- [ ] P150-P153 /crawl-management (deliverables tree, graphics queue, rot chips)
- [ ] P154-P157 /crawl-support (board, nights grid, HOURS gantt, cancellation review)
- [ ] P158-P161 /worklist (sections incl. floor-staff calls, slot-change approvals)
- [ ] P162-P165 /tasks + /tasks/[id] + /tasks/new (SLA, sources, bulk)
- [ ] P166-P169 /calendar
- [ ] P170-P173 /campaigns + /campaigns/[id] + /campaigns/new
- [ ] P174-P177 /cities + /cities/[id] + /cities/new
- [ ] P178-P181 /brands (crawl + outreach, new/edit)
- [ ] P182-P185 /templates + /templates/[id] + /templates/new (merge fields, spintax, picker preview)
- [ ] P186-P189 /campaign-info (aliases, personas, connected inboxes)
- [ ] P190-P193 /email-queue (scheduled, failing, resume)
- [ ] P194-P197 /maps + public JSON API surface
- [ ] P198-P201 /import (CSV, sheets, dedupe-on-import)
- [ ] P202-P205 /wristbands + /external-hosts + /internal-hosts
- [ ] P206-P209 /crawl-matrix + /all-crawls + /readiness + /support-hours
- [ ] P210-P213 /goals + /goals/[id] + /goals/new + /admin/goals
- [ ] P214-P217 /me + /me/activity + /me/inbox-health + /me/preferences
- [ ] P218-P221 /settings/inboxes (connect, resync, health)
- [ ] P222-P225 /audit + /misclassifications + /event-submission + /pick-campaign
- [ ] P226-P229 /admin/users + /admin/roles (invites, role gates)
- [ ] P230-P233 /admin/analytics (+funnel, send-time, templates, [staffId]) — verify linkage fix rendered truthfully
- [ ] P234-P237 /admin/command + /admin/workload + /admin/data-quality + /admin/learning (the new brain pages — fresh-eyes audit)
- [ ] P238-P241 /admin/cron-health + /admin/email-health + /admin/deliverability + /admin/alerts + /admin/ai-usage
- [ ] P242-P245 /admin/autonomy + /admin/suppression + /admin/labels + /admin/snippets
- [ ] P246-P249 /admin/archived-* (3 pages) + /reference/[slug]
- [ ] P250-P253 (print)/events/[id]/staff-sheet + poster (poster generation = SKIP-FLAG if pipeline absent; audit page shell only)
- [ ] P254-P257 public pages: /login, /about, /faq, /features, /contact, /privacy, /terms, /security, /changelog, /set-password/[token]
- [ ] P258-P261 Global shell: side-nav, top bar, notifications bell, palette (Cmd+K), presence, toasts — desktop
- [ ] P262-P265 Global shell mobile: drawer, full-width inbox, touch targets, safe areas
- [ ] P266-P270 Cross-tab mobile sweep at 390px: every Wave-2 tab opened on mobile viewport; defects logged + fixed
- [ ] P271-P275 Cross-tab desktop polish sweep: spacing/typography/empty/loading/error states consistency pass

## Wave 3 — Feature-by-feature audits (A=audit vs best-in-class, X=fix+re-audit)
- [ ] P276-P277 Send pipeline end-to-end (compose→safety→caps→persona→relationship→send→record) incl. failure paths
- [ ] P278-P279 Scheduled sends + email queue + send worker cadence
- [ ] P280-P281 Cadence engine + follow-up floors + overrides
- [ ] P282-P283 Reply ingestion (gmail poll: history API, backfill, bounce, misroute, venue match rates)
- [ ] P284-P285 Classification (auto + suggested + misclassification review loop; measure accuracy vs human labels)
- [ ] P286-P287 Quick-reply chips + reply corpus retrieval quality
- [ ] P288-P289 Template system (merge fields all 44, spintax, picker incl. Loop C live behavior)
- [ ] P290-P291 Stage gates (all 4 entry paths re-tested incl. board drag + direct add)
- [ ] P292-P293 Confirmation cascade + lifecycle scheduler (T9-T17 full chain on a test venue)
- [ ] P294-P295 Cancellation flow + playbook + replacement push lifecycle (fire drill on test data)
- [ ] P296-P297 Health v2 (verify every input live: hosts, wristbands, ownership, stale-warm, sending) + NBA ordering shift test
- [ ] P298-P299 Rot system (thresholds vs watchdog parity re-check; chips render where claimed)
- [ ] P300-P301 Watchdogs + alerts + notification escalation (force-fire each rule on test rows)
- [ ] P302-P303 Dedupe v2 (merge a real duplicate pair end-to-end; verify history re-pointing + decisions)
- [ ] P304-P305 Import pipeline (CSV + sheets: dedupe-on-import, CONTACT-class garbage test)
- [ ] P306-P307 Eventbrite sync (link, 4h sales pull, venue-block push markers)
- [ ] P308-P309 Maps/public API (lineup correctness, never-do #6 fields, cursor feed consumer simulation)
- [ ] P310-P311 Quo calls (dial, webhook outcomes, call windows, last-touch bump incl. backfill)
- [ ] P312-P313 SMS surfaces (audit what exists; Twilio build-out = SKIP-FLAG)
- [ ] P314-P315 Auth/roles/superuser/machine routes (re-probe all)
- [ ] P316-P317 Goals + analytics suite truthfulness (reconciliation: every metric vs raw SQL — the user-trust metric pass)
- [ ] P318-P319 Learning report + autonomy evidence (verdict capture rates; dashboard math)
- [ ] P320-P321 Backups (sheets v2 tabs re-verified; pg backup cron; restore drill = SKIP-FLAG)
- [ ] P322-P323 Search/palette + saved views + labels + snippets
- [ ] P324-P325 Notifications + daily digest + mentions
- [ ] P326-P327 Print surfaces (staff sheet fidelity; poster = SKIP-FLAG)
### Wave 3 extension (P007 refdoc gap findings)
- [ ] P348 Hosts end-to-end (refdoc §2 + §7.13): roster, assignment, confirmation timing, SMS consent, payment-flow surfaces
- [ ] P349 Guest-count math (refdoc §5): pitch numbers by priority×slot + sales-update math in merge fields — verify against the locked tables
- [ ] P350 Cross-domain handoff + escalation (refdoc §6.2): full flow audit incl. cadence-floor interaction
- [ ] P351 Wristband shipping logistics (refdoc §7.12): tracker, statuses, shipment timing alerts
- [ ] P352 Venue enrichment (places-based): trigger, fields written, attempt-log skip logic
- [ ] P353 Smart notes + mentions + suggestions loop

## Wave 4 — Cross-cutting + closeout
- [ ] P328-P330 Performance pass: slowest 10 pages profiled (server timing), N+1s fixed, indexes verified
- [ ] P331-P333 Error/empty/loading states: every tab has all three, consistent
- [ ] P334-P336 Accessibility pass: keyboard nav, focus, contrast on core flows
- [ ] P337-P339 Security re-probe: authz on every new route, IDOR spot-checks, header probes
- [ ] P340-P342 Hydration-safety: drive advisory warns to zero where feasible
- [ ] P343-P345 Full regression: suite green, smoke all tabs, Sentry zero-new
- [ ] P346 Final report to operator: scores per tab/feature, all fixes, SKIP-FLAG list
- [ ] P347 Plan retrospective + permanent weekly self-audit cron proposal

## SKIP-FLAG log (collected for final report)
- (running list; add as encountered)

## Findings log
- (inline under phases; major cross-cutting findings also summarized here)

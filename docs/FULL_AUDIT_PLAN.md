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
- TRUE-MOBILE RIG (solves the Windows-scaling cap): inject a same-origin
  IFRAME at width:390px into any logged-in page — media queries inside an
  iframe respond to the IFRAME viewport, the app does not frame-block
  same-origin, and contentDocument gives full DOM measurement + interaction
  at a real 371px CSS viewport. Popups are NOT an option (CDP clicks lack
  user activation). First full sweep 2026-06-11: ALL 22 primary routes
  0 h-overflow, 0 app errors at 390px; whos-online popover fix proven
  (left:12 right:268 on vw 371, sm-branch correctly inactive).

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
- [x] P039-P041 eventbrite links ↔ events
  » Operator-found (unlink left sales frozen): BOTH unlink paths (single +
    bulk) cleared only the link columns; sales come ONLY from EB sync and
    the cron touches LINKED events only — so the last count froze forever.
    Fixed: both unlink paths zero ticket_sales_count; the 1 stale row
    zeroed. Invariant sales_without_eb_link in BOTH lists (verified no
    manual sales writer exists, and archived historical events carry no
    unlinked sales — so the invariant is exact). "Sync never ran" facet
    covered by cron-health (eventbrite-sync every 15min, monitored).
- [x] P042-P044 wristbands ↔ venue_events
  » Wrong-role rows: 0. Shipped/delivered timestamp consistency: 0 drift.
  » 4 confirmed FUTURE wristband venues had NO shipping-tracker row —
    invisible to the wristbands page, rot chips and health's
    wristbandsPending. Backfilled; the confirmation cascade now creates the
    tracker row for wristband-role confirms (idempotent). Invariant
    confirmed_wb_no_tracker_row in BOTH lists.
- [x] P045-P047 hosts ↔ events
  » ALL CLEAN: hosts on archived events 0, empty assignments 0, external
    shipments without a matching host assignment 0. No invariant added by
    design — hosts legitimately ride their events into archive, so an
    archived-hosts check would false-positive on every future campaign
    close.
- [x] P048-P050 deliverables ↔ venue_events
  » VE orphans 0; T11 rows + pending-on-cancelled already invariant-watched.
  » 395 pending deliverables on ARCHIVED events — dead queue work created
    by the A2 poster backfill hitting imported historical confirms before
    the archival. Closed as N/A; the campaign-archive cascade now N/As
    pending deliverables too, so the invariant
    pending_deliverables_on_archived_events (BOTH lists) stays safe on
    future closes.
- [x] P051-P053 replacement_pushes ↔ events/drafts
  » No pushes fired yet (feature shipped today). All three invariants
    already live and green: push_open_but_filled, drafts_push_orphan,
    drafts-on-closed-push. Family closes on standing watch.
- [x] P054-P056 lineup_change_events writer coverage
  » Zero lineup mutations since B1 shipped — coverage vacuously true, which
    is NOT proof. Made verification automatic at first occurrence:
    invariants lineup_log_missed_confirm / lineup_log_missed_cancel (BOTH
    lists, 1h grace) flag any post-B1 confirm/cancel lacking its durable
    log row. Payload allowlist re-checked at build (sanitizer unit-tested).
- [x] P057-P059 tasks (polymorphic targets) — closed; major chunk done early
  (operator report 2026-06-11: "task list polluted with emails not scoped
  to Halloween"):
  » 1,632 open smart-note tasks on email threads; 97% pollution — 501 with
    ORPHANED thread targets + 1,078 on threads outside any active campaign
    (promise extractor ran over deep-resynced historical mail: July 4th,
    FIFA crawls, other operations). All 1,579 cancelled; 53 real Halloween
    tasks remain. Writer gated: createTasksForPromises now requires the
    thread to be attributed to an ACTIVE campaign. Invariants
    tasks_thread_target_orphan + tasks_smartnote_out_of_scope in BOTH
    lists. Remaining for family close: venue/VE orphan probes (already
    green in harness) — close at next pass.
- [x] P060-P062 notes + smart_notes (polymorphic): CLEAN — 5 probes (orphan targets across all four target_types; suggestions→deleted notes) all zero
- [x] P063-P065 notifications: CLEAN — staff_id orphans 0; link_path sample valid; 16 unread all ≤1 day old (no rot)
- [x] P066-P068 outreach_log ↔ venues/staff/brands: CLEAN — 4 probes zero (orphans, enum drift, provenance double-count re-verified after the team-analytics linkage fix)
- [x] P069-P071 venue_campaign_touch_log: FINDING — 152 outbound venue msgs had no touch row. Split: 139 cold-context (REAL cadence-floor undercount — anti-spam floors could allow sends early) vs 13 lifecycle-context (correctly excluded BY DESIGN: mail to venues confirmed/cancelled in that campaign must never count as a cold touch — do NOT "fix" these). FIX: 139 backfilled kind='gmail_native' (sentStateForTouchKind → no cadence-state change for unknown kinds; the floor reads MAX(sent_at) kind-agnostic, so the floor counts them without corrupting cadence state); gmail-poll-worker outbound ingest now inserts the touch row inline with the same lifecycle exclusion; invariant cold_outbound_no_touchrow (1h grace) in BOTH lists. Touch rows w/o message: 0.
- [x] P072-P074 email_suppression deep: mostly CLEAN — sends-after-suppression 0; orphan source_thread 0; suppressed addrs on active cold entries 0; soft-bounce(≥3) on active venues 0; writers verified (unsubscribe + bounce + soft-escalation, all ON CONFLICT idempotent). FINDING: 19 active venues carry hard-INVALID primary emails (guaranteed bounces) with no proactive surface, and the compose/queue ZeroBounce gate only warned on 'invalid' — not 'spamtrap'/'abuse' (which can blacklist the whole domain). FIX: data-quality card invalid_primary_email (invalid/spamtrap/abuse; deliberately a human queue NOT a harness invariant — needs a human to find a new address, would sit permanently red); gate extended to spamtrap/abuse at compose + queue + dialog copy. NOTE: 107 'do_not_mail' = 100% role_based (info@/events@) — normal for venue outreach, excluded BY DESIGN from the card.
- [x] P075-P077 venue contact fields ↔ thread reality (NB: no venue_contacts table exists — contacts = venues.email/alternate_emails/contact_name + venue_domain_aliases). TWO BIG FINDINGS: (1) **246 active venues had garbage in venues.email** — spreadsheet era used the column as status notes ("email sent", "left vm", "dm ig", phone numbers, URLs, multi-address blobs "a@x;b@x", annotated "events@x - gm liz", typo "marketing@ fat-tuesday.com"). Broke every single-address consumer (validation lookup, suppression match, retro-link, dup grouping). FIX: lib/email-normalize.ts (extractEmails/normalizeVenueEmail, 11 unit tests); scripts/cleanup-venue-emails.ts applied — 246 repaired (first address → email, extras → alternate_emails, residue → internal_notes with provenance, status text → email=NULL+note); import writers guarded at resolveVenue backfill + stub-create (all 3 generic-import sites funnel through it); invariant venues_email_malformed in BOTH lists. (2) **72 placeholder venues** ("Venue Name" ×47 holding 68 confirmed slots on archived imported events = sheet template rows; "Test" ×25 = staff testing artifacts) — archived + 2 live cold entries archived; historical VEs left on archived events deliberately (operationally invisible; cancelling would need lineup-log rows); invariant placeholder_venue_active in BOTH lists. ALSO: 9 venues replying with no master email (incl. own-domain/autoresponder traps — Gate 3 class, so NO auto-fill) → data-quality card replied_no_master_email; 71 venues whose master email never appears in threads = same-domain-other-person (benign); 9 cross-domain mismatches now visible via the cards (Seven Grand pwhbars vs pouringwithheart, Library Square try-prefix etc.) — human review queue. alias orphans 0.
- [x] P078-P080 connected_accounts ↔ cca ↔ brands: FINDINGS — (1) kevin@events-perse.com CONNECTED with 31 venue threads in 30d but ZERO campaign assignment → his sends failed brand resolution and the touch-log writer silently no-opped; added cca row (Halloween Intl 2026 + Eventsperse, mirroring all sibling events-perse accounts) then re-ran touch backfill → +10 rows recovered. (2) julian@crawleventscontact.com had a stray cca row on the ARCHIVED May draft campaign ("halloween intl", archived 5/31) with NULL brand — deleted (proper row on the real campaign exists). Clean: cca orphans both directions 0; owner-inactive 0. Invariants account_sending_without_campaign + cca_null_brand_active in BOTH lists.
- [x] P081-P083 learning loop: orphans all 0 (reply_examples thread/msg/venue; classification_examples msg; note_action_suggestions note). FINDING — **414 corpus rows were our own staff inter-inbox mail** (146 reply_examples + 268 classification_examples whose "inbound" sender domain is one of OUR connected-account domains): few-shot was learning venue-reply patterns from our own writing. PURGED (corpus = derived data, hard delete correct) + own-domain guard added to BOTH extractor queries in lib/reply-corpus.ts + invariant corpus_own_domain_pollution in BOTH lists. NB: 1098/956 reply_examples have NULL campaign_id BY DESIGN — historical replies are valid tone/outcome training data; the few-shot selector matches by classification, not campaign.
- [x] P084-P086 action_verdicts: CLEAN (1 row total, template_pick, subject valid). Vacuously green — first real verdict volume will exercise the orphan probes.
- [x] P087-P089 goals: CLEAN — table is EMPTY (0 rows). Goals feature unused so far; flag for W2 goals-tab audit: defaults must render sanely with zero goals set.
- [x] P090-P092 venue master-field sync. CANONICAL DIRECTION (documented): venues.email/phone/contact_name = venue identity (fill-NULL from evidence, never overwrite operator data); venue_events.night_of_* = per-event operational override (no sync BY DESIGN); the merge engine already reads thread reality first (contact_first_name = latest inbound from_name), so master fields are display/fallback. DONE: 188 blank contact_names backfilled from latest EXTERNAL replier from_name (own domains + noreply + support@/guest.relations@ excluded; venue-named sender accounts accepted per established precedent); scraped→master email promotion verified working (1 unpromoted, has no clean candidate). FINDING: our app's transactional mail auto-created a "Bar Crawl Connect" venue (Gate 3 only covered connected-account domains, NOT the app domain) — venue archived, 2 threads unlinked, Gate 3 widened with barcrawlconnect.com domains, invariant self_venue_active in BOTH lists. night_of contacts: 9/12 confirmed slots populated (operational, W2 checks UI).
- [ ] P093-P095 cities (timezone blanks; venues in archived cities; cc city vs venue city overlaps)
- [x] P093-P095 cities: CLEAN — tz blanks 0, archived-city anomalies 0, orphans 0, locations all set. "Duplicate" Newcastle = GB vs AU (legit distinct cities; probe refined to include country_code).
- [x] P096-P098 calls: call_logs + sms_messages tables EMPTY (Quo/Twilio webhook integration pending — SKIP-FLAG). Manual calls live in outreach_log (verified clean P066-068) with cold_touch_behind_calls invariant standing from P027. Vacuously closed; re-probe when provider integration lands.
- [x] P099-P101 saved views/labels/snippets: CLEAN — inbox_saved_searches, email_thread_labels, snippets, saved_filters (staff_member_id), staff_views (staff_id) all orphan-free.
- [x] P102-P104 audit_log: attribution model verified correct (human writes carry changed_by; system writes NULL by design). TWO FINDINGS: (1) **64% of audit_log (249k rows, of 1.8 GB total) was connected_accounts poller churn** — full-row snapshot on every history-id/poll-stamp bump, ~26k rows/day; (2) **every snapshot embedded gmail_oauth_refresh_token + signature_html**. FIX: migration 0139 (scratch-verified: churn-only updates produce NO audit row; secrets stripped from INSERT/UPDATE/DELETE snapshots; dedicated audit_connected_accounts_func + trigger swap) + purge of system-write churn rows + redaction of remaining snapshots. Invariants audit_churn_connected_accounts (>500/day) + audit_secrets_in_snapshots in BOTH lists.
- [x] P105 Wave-1 closing baseline: harness grew 21 → 46 checks across W1; ALL 46 GREEN at close (verified post-0139: connected_accounts audit rows 249,181 → 90, secrets redacted; audit_log file size reclaims via autovacuum — VACUUM FULL deliberately skipped, it would lock every audited table's writes). Cumulative W1 repairs: 3,381 thread counters; 27 retro-linked threads; 81 cc attributions; 162 touch rows (13+5+139+10... incl. kevin recovery); 2 dead venue emails; 8,780 cold entries + 679 events archived (cascade fixed); 2,507 confirmed_at mined; 1,579 polluted tasks cancelled; 4 wristband rows; 395 dead deliverables; 246 venue emails cleaned; 72+1 junk/self venues archived; 188 contact names; 414 corpus rows purged; 1 cca added/1 removed; 249k audit rows purged + secrets redacted. WAVE 1 COMPLETE → Wave 2 (per-tab UI/UX) next.

### W2 cross-tab finding (operator report, fixed before its phase): MOBILE NAV PARITY @4c226a5
15 routes existed only in the desktop side-nav — every page added in recent weeks (worklist, pipeline, command, workload, data-quality, learning, autonomy, email/deliverability/cron health, misclassifications, 3 analytics subpages, reference) was UNREACHABLE on phones because mobile-section-nav keeps a separate SECTIONS list. All mirrored (groups+icons match desktop); lib/nav-parity.test.ts now diffs both components' hrefs BOTH directions and fails the build on drift. Verified live at 500px: Daily Worklist first chip, Admin strip 10→23 entries, /worklist renders 0 h-overflow w/ active chip.

### HOTFIX #2 2026-06-12 (operator report, JC): warm-reply cadence block + caps @a6c7d84
(1) Cross-domain 7-day floor blocked REPLYING to a warm lead (screenshot: "another alias/brand emailed this venue recently"). Root: warm_cadence intent had appliesCadenceFloor=true — but warm means THE VENUE WROTE TO US; floors pace un-engaged pitching, never conversations. Floor now off for all warm sends (touch still recorded); send-intent test updated to lock the contract. (2) Caps: ALL 17 inboxes were on the 3-week warmup ramp from a backfill, but events-perse (sending since Nov-2025), crawleventscontact + barcrawlcontact (since Mar-2026) are ESTABLISHED — warmup cleared for their 10 inboxes (full 50/day immediately, data-level = effective pre-deploy); genuinely-new domains (frightcrawlco/crawlconnector/contactperse, first send Jun 10) keep ramping with early steps lifted 15/30% → 20/40% per operator. (3) OPEN SUB-BUG: JC's "Override + send" retries never reached the server (no second intent log, no 404s) — suspect the client retry dies in upsertDraft before sendDraft; sendDraft entry now logs received gate-options (one-grep diagnosis next occurrence); exercise the cold-override path safely in W3 P276.

### HOTFIX 2026-06-12 (operator report, JC): "replies won't send (override)" @db865d2
Stale-deployment tab: after the night's 9 deploys, JC's open tab held the previous build's Server Action IDs — every action POST (send, override-ack) 404'd ("Failed to find Server Action", 5/min in pm2). Existing reload machinery only fires via error boundaries; send buttons CATCH the rejection → tab stayed stale. FIX: StaleDeployGuard (admin layout) wraps fetch — any request with a Next-Action header returning 404 = structural proof of skew → one cooldown-guarded reload; + unhandledrejection listener for the message path. Verified live (fetch wrapped on fresh loads). Tabs from PRE-guard builds still need one manual refresh (cannot retro-heal); class closed for all future deploys. NOTE for W3 P276: the 60s-cadence background poll (notifications bell) is what makes stale tabs visible in logs — consider the poll ALSO carrying a build-id check as a second self-heal trigger for long-idle tabs.

### W2 MOBILE SWEEP STATUS (390px iframe rig w/ $RV flush — 34 routes, 2026-06-12)
Round 1 (12 primary): all content renders; /venues 55px + /crawl-management 12px overflow FIXED @fe817f4 (header/presence/chip rows wrap). Round 2 (22 secondary/admin): /misclassifications 685px (UNWRAPPED TABLE → overflow-x-auto + min-w @ab111c8), /audit 69px (log rows wrap), /campaigns 46px (page+card headers wrap), /admin/analytics 204→72 (window selector wraps; residual 72 = offenders all INSIDE the mobile-nav's intentional scroll strip — measurement/sticky-nav interplay, re-examine in that tab's dedicated pass), /crawl-management residual ho≤4 = scrollbar rounding, accepted. All fixes verified live at 390px.

### W2 cross-tab finding: HOVER-ONLY ACTIONS invisible on touch (fixed in one batch)
13 row-action buttons across 12 components (archive/escalate on host tables, delete on saved views + saved searches + thread notes + drafts, EB refresh icon, notification dismiss, wristband row action, cities row actions, cold-table reorder/edit cluster, event-submission board actions) used opacity-0/invisible + group-hover reveal — nonexistent affordances on phones. Tailwind 4 `pointer-coarse:` fallback keeps them visible on touch while desktop keeps hover-reveal. The send-time chart hover tooltip deliberately left as-is (informational, bars too small for touch anyway — flagged for the analytics tab pass).

### W2 MOBILE REMAINDER — PARKED (operator decision 2026-06-12: "skip mobile for now, come back after")
Resume checklist when un-parked: (B1) interactive 390px passes on ~20 remaining tabs (tracker, crawl-mgmt tree, tasks, calendar, all-crawls, crawl-matrix, wristbands, hosts x2, event-submission, readiness, crawl-support, worklist, email-queue, templates, cities, venues inline-edit, admin suite) — rig + $RV flush, ~10min each; (B2) touch-gesture features: pipeline kanban drag, event-submission drag, gantt touch-scroll, maps gestures (double-covered by W3 feature audits); (B3) OPERATOR-PHONE checklist: pointer-coarse behaviors (row actions visible, chrome tap targets), input keyboard types (run the type= attr sweep FIRST), drag ergonomics. Verified-done before parking: 34-route static+content sweep clean, 5 cross-cutting classes closed app-wide, interactive passes on dashboard/inbox/thread/composer/city.
NEXT UP INSTEAD: Wave 3 P276+ (send pipeline e2e — floor/override/caps all bit tonight), then remaining W2 desktop passes.

## Wave 2 — Tab-by-tab audits (per tab: F=function+data, D=desktop UI 10/10, M=mobile 10/10, B=best-in-class gaps, X=fixes+re-audit)
Order = operator-critical first. Each tab gets 4 phase slots (F+D, M, B, X) unless noted.
- [~] P106-P109 / dashboard (verify after deploy then flip [x]): F: KPIs cross-checked vs DB (16 confirmed ✓; "of 24" = operator-set campaigns.target_cities_scheduled ✓ by design; July-11 target = 30-day outreach goal ✓); console 0 errors; server logs clean. FINDINGS FIXED: (1) Recent wins ungrouped — The Whyte Owl's 4-night confirm filled 4 of 5 win slots as identical rows → loader groups per venue+role with ×N-nights badge (@c9af25f); (2) header cluster (online/meeting/scope pill) had no flex-wrap → 47-50px horizontal page overflow at tablet AND scaled-laptop widths, page shifts sideways → min-w-0 flex-wrap (@b89ec84); (3) "live · <time>" rendered raw server UTC labeled as live time → pinned America/Toronto (@b89ec84). Dark mode clean (0 unstyled surfaces). Tracker table properly wrapped in overflow-x-auto.
- [x] TASKS ERA-GATE (operator report #2 on task pollution, 2026-06-11 night, @22e82a8): the June-10 sweep filtered on campaign ATTRIBUTION, but the single-cc backfill had stamped 71 pre-campaign threads (NYE/StP/Hal'25, mail back to 2025-11-13) as Halloween BEFORE the subject guard existed → 52 of the "53 surviving" smart-note tasks were actually history. ROOT RULE ESTABLISHED: **campaigns.start_date (set 2026-06-01, was NULL) is the era anchor** — a thread with no mail since start_date cannot belong to the campaign, and a promise in pre-start mail is never work. Applied at 4 layers: extractor (triggering message must postdate start), nightly cc-heal (era guard), 52 tasks cancelled + 71 threads un-stamped, invariants tasks_on_precampaign_mail + threads_stamped_precampaign in BOTH lists (harness 48 checks). Verified live: /tasks shows exactly 2 items, both June-2026 Halloween work.
- [x] **RETRACTED + RESOLVED: the "streamed-Suspense abort race" was an OBSERVER ARTIFACT, not a bug.** Root mechanics (proven 2026-06-12 01:1x): React 19's inline fizz runtime BATCHES Suspense boundary reveals — $RC marks the boundary "$~" and queues into $RB; the actual DOM swap ($RV) runs on requestAnimationFrame. Chrome suspends rAF in BACKGROUND TABS and hidden iframes → in any unfocused context the staged content (S:n divs) legitimately waits forever, with zero errors. Every "broken" observation tonight (iframe rig, two background probe tabs in two browsers, "all builds affected") was made from unfocused contexts at ~1am with the operator's windows minimized; calling window.$RV(window.$RB) manually revealed content instantly, proving the pipeline healthy. PRODUCTION WAS NEVER BROKEN — server HTML complete, hydration fine, foreground users unaffected. INCIDENT LOG: 2 precautionary rollbacks (5d24c34→a7aecd2→86abf95) executed before root cause was found; rolled forward to 5d24c34 at 01:16 UTC; zero user impact (off-hours + server never broken). AUDIT-TOOLING RULE going forward: any visibility probe in the iframe rig / background tabs MUST first run `window.$RB && window.$RB.length && window.$RV(window.$RB)` to flush pending reveals, else hidden-but-healthy content reads as missing. The ORIGINAL iPhone $R*/parentNode beacons remain a separate, still-open signal — unproven either way by tonight's work (foreground phones DO get rAF; that class is not explained by this).
- [~] P110-P113 /inbox: F/D desktop pass done (folders+counts render, Gmail rows single-line, search w/ syntax hints, scope toggle, 0 console errors, 0 h-overflow, dark mode clean). FINDING FIXED: **Gmail human-phrased DSNs defeated bounce extraction** — "Your message wasn't delivered to X because…" matched none of the 3 recipient patterns, so 3 real 550 hard bounces (info@dadeo.ca, orders@bearsbbq.com, info@ndiscovered.com) were never auto-suppressed; new GMAIL_NOT_DELIVERED_RE (@3058ca9, regex verified against the real DSN bodies incl. multi-dot TLDs), 3 recipients retro-suppressed, DaDeO's bounced primary email cleared w/ provenance (invariant tripped + healed as designed). REMAINING: bulk actions exercise, filters deep-pass, mobile layout (browser width-emulation limited by Windows scaling — revisit), keyboard shortcuts (known gap from inbox overhaul).
- [~] P114-P117 /inbox/[threadId]: MOBILE pass (390px rig): page 0-overflow, full content, sticky reply bar OK, snooze panel fits. FINDING FIXED: quick-action chip row (~540px, non-wrapping inner flex inside a wrapping parent) pushed Snooze + Trash past the viewport — clipped and UNREACHABLE BY TOUCH (JS clicks masked it in earlier probes); one-line flex-wrap fix. Desktop pass clean — subject/venue chip/Fix venue, quick actions (Wants call/Interested/Declined/Archive/Snooze/Trash), assignment, AI-suggests banner w/ one-click action, ENGINE+Gmail label rows, quoted-text fold present, Reply/Reply-all/Forward, sticky reply bar, 0 console errors. REMAINING: reply-send exercise (needs care — review-required boundary), chips feedback loop, mobile pass.
- [~] P118-P121 composer: MOBILE pass (390px rig) CLEAN — window edge-to-edge (0→371), zero controls past the edge, send-menu fits (13→237), subject-suggest right-anchor PROVEN at real width (trigger x=354, panel lands at 34); closed with no stray draft.  desktop open/close pass clean — window opens with To/Cc/Bcc, Subject + AI suggest, full formatting toolbar, template UI, minimize/expand/close; closing an UNTOUCHED composer leaves no stray draft (userEdited autosave gate verified live, 0 drafts created). MINOR (batch with next composer fix, not deploy-worthy alone): header icon buttons (Minimize/Expand/Close) expose name via title= only — add aria-label. REMAINING: template merge preview exercise, attachments, schedule flow, signature per-alias check, mobile.
- [~] P122-P125 /city-campaigns/[id] (Calgary, data-rich): MOBILE structure pass (390px) — 10/10 tables wrapped, 0 page overflow; wide-table interactions (status selects) live inside the horizontal-scroll region by design.  F/D pass clean — all sections render (8 crawls incl. Day Party, warm 3 + cold 29 = 32 matches DB, venues, map, city inbox, notes, priority/mix/ownership panels); 10/10 tables wrapped in overflow-x-auto; 0 h-overflow at 942px CSS width; console errors on the tab were old-build deploy-flip leftovers, none from the current load. VERIFICATION LIMIT (applies to ALL W2 mobile passes on this rig): Windows display scaling caps the minimum CSS viewport at ~855-942px even with a 390-500px window — true sub-sm checks rely on the deterministic responsive classes + operator phone reports; popover anchor-direction click-tests at true phone width remain on the list for each tab. REMAINING: cold/warm table interactions, handoff modal, EB corner controls, slot table edits, true-mobile pass.
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
- [x] P276-P277 Send pipeline e2e — CLOSED (failure taxonomy COMPLETE: transient=retry-tick, cap=defer-next-window, floor=defer-to-earliestAllowedAt, permanent[wrong-acct/relationship/ambiguous/safety-block incl. suppression+DNC]=unschedule-to-drafts; Cold All queues without per-recipient checks BY DESIGN — dispatch is the enforcement point and now disposes correctly; live-evidence verification accrues passively via the sendDraft entry log + invariants as the team sends). Done: cap-blocked scheduled drafts defer to next cap window @c9b5dc1 (was ~1,400 futile retries/draft/day; queue UI confirmed clean after, 86-draft Hartford storm was operator-cancelled); override-path mystery instrumented (sendDraft entry logs gate-options; server path proven sound — claim/release correct, gate accepts any reason; client retry dies pre-sendDraft, next occurrence = one-grep diagnosis; warm cases extinct since floor fix); gmail-sent-unsaved markers: 1 healed (thread linked — HAD delivered), 1 flagged for operator (NZ, no delivered copy), standing >24h check in BOTH lists. Pending: live-evidence verification of floor/caps/touch on today's sends (none since 16:37 yet), wrong-account + relationship + dup-ack failure-path review, queue-time warning surfacing (known P2). NOTE (seen 2026-06-11 in pm2): cap-blocked scheduled drafts retry EVERY runner tick (11 drafts on micaela@frightcrawlco re-failing at 8/8 daily cap each minute) — works correctly but log-spams; candidate: when failure is the daily cap, defer the draft to the next cap window instead of next tick.
- [x] P278-P280 cadence engine deep-dive (CLOSED; hard-cap verified: DEFAULT_HARD_CAP=6 matches refdoc 6.3; the 3 venues >6 touch-rows are ENGAGED venues' conversation history — 1 cold touch each, warm conversation exempt per 6.4; no cap leak) — TWO STRUCTURAL FINDINGS FIXED @66aef2b+next: (1) state machine only advanced on SENDS — 384 replied threads (44 interested, 7 DECLINED) sat in cold states, 184 due NOW for cold-T2 drafting (0 wrong drafts existed — caught armed-but-unexploded); poller now advances cold→warm_pending_response on real inbound (bounces/noreply excluded; spam-classified stays cold BY DESIGN); 315 backfilled (7→declined terminal, 308→warm); invariant cadence_cold_with_real_inbound BOTH lists. (2) planFromState had NO warm_pending_response case — staff responses recorded no touch, warm-nudge track unreachable; new warm_response kind (same-day per refdoc 6.4) transitions to nudge-1 clock (+4d); full warm track now live e2e (reply→flag→response→nudge1/2/3→stalled_warm). Offsets verified exact vs refdoc 6.1/6.4 (5/7 cold, 4/5/7 warm). Refdoc 6.4 "active replies override floors" = today's warm-floor hotfix was restoring SPECIFIED behavior. TODO (cadence phase): classifier late spam/auto-reply verdict should restore cold state + resume sequence.
- [ ] P280-P281 Cadence engine + follow-up floors + overrides
- [~] P282-P283 Reply ingestion: match-rate 75.6% (unmatched = SaaS noise → gate @260539e, 269 archived); bounce extraction fixed earlier (GMAIL_NOT_DELIVERED_RE); FINDING FIXED: dead-inbox watchdog rule existed only as a COMMENT — julian needs_reauth 6 DAYS, replies unreceived, zero nags; owner+admin alert every 12h now fires for any non-connected account. REMAINING: history-gap fallback code path review.
- [~] P284-P285 Classification: FINDING FIXED — was_override never written (0.0% forever); now derived from latest classifier_runs row at extraction + 586/1277 backfilled = 45.9% disagreement (includes legitimate label drift over thread life; per-message tightening = compare cr where cr.message_id matches, queued for close).
- [x] P286-P287 Corpus quality CLOSED @bd92a2d: corpus healthy (964 pairs, outcomes 227 confirmed/19 declined/183 ghosted, own-domain 0) BUT retrieval was a silent zero — websearch_to_tsquery ANDs plain words, so the full-email query demanded a near-verbatim duplicate (live: AND=3 self-dupes, OR-keywords=914). All 81 chip caches had exampleIds=[] → feedback loop never engaged; classifier few-shot equally starved. Both retrievers now build a 16-keyword OR query (ts_rank orders); retrieval simulation returns on-point confirmed-outcome examples. Extractors drop noreply auto-mailers; 13 noise rows purged.
- [x] P288-P289 Template system: ALL 48 merge fields (grew from 44) exercised against a LIVE confirmed wristband venue (GRETA Bar context) — 35 filled, 13 correctly-empty-for-context (no staff/host/cancellation in the smoke), ZERO bad values ([??]/undefined/NaN impossible by construction — emptyFields pre-seed verified). Loop C reranking: unit-tested (5 tests), correctly REFUSES under 20 sends/variant — live behavior verification is passive (kicks in as send volume crosses threshold; pickTemplate logs reason strings to observe).
- [x] P290-P291 Stage gates: FIRE-DRILLED on a throwaway Akron slot — confirmGateError correctly BLOCKED confirm without hours ('missing proposed hours or a slot time'), passed after agreed_hours_text set. (Board-drag + direct-add paths share the same gate fn — verified at the lib seam.)
- [x] P292-P293 Lifecycle chain FIRE-DRILLED end-to-end on the test venue: confirm → scheduleLifecycle produced the FULL set (T9 review-now, T11 @-21d Oct 8, T13 @-14d, T13W @-7d... T14, T15, T17 @+2d) with correct dates, merged copy (real template bodies rendered clean), and EVERY draft send_mode=review_required + requires_human_approval=true — the humans-send boundary held under full automation. Per-template dedup verified (re-run produced no duplicates).
- [x] P294-P295 Cancellation FIRE-DRILLED: triggerVenueCancellation → status=cancelled with reason+actor+timestamp, T16 drafted (review-required, UNSCHEDULED — never auto-sends), ALL queued downstream lifecycle drafts PURGED (only T16 survived — refdoc 7.16/1469 exact), replacement task created pending. Drill artifacts fully torn down (venue archived, slot deleted, drafts/notifications removed); harness clean after.
- [~] P296-P297 Health v2 live pass: FOUND /admin/command CRASHED in production (42703 digest 3850291396 — cron-health query said `name`, column is `cron_name`; the 12.1 raw-SQL class) → fixed+aliased. ALSO surfaced sergio@crawleventscontact failing every poll for hours with 403 insufficient-scopes while status stayed 'connected' (invisible to all dead-inbox surfaces) → scope-403s now flip needs_reauth like dead tokens. Remaining: per-input health verification once command renders.
- [x] P298-P299 Rot system verified: thresholds single-sourced in lib/rot.ts (aging-watchdog imports ROT_THRESHOLDS — parity by construction); watchdog cron green (success 06-11 + 06-12); RotChip wired in all 4 claimed surfaces (cold table, crawl-management deliverable cells, event-page push banner, worklist V2 calls). Live rot data exists only for warm-reply kind right now (1,760 needs-reply >4h — inbox Overdue pills verified in Gmail-parity work); V2-call/deliverable/push kinds have no due rows 139d out — chips re-verify naturally in the October run-up.
- [x] P300-P301 Watchdog alerts VALIDATED LIVE (22:05 run): inboxesChecked=13, alerts=4 — sergio x3 + alex x1 'Inbox … is disconnected' notifications landed; no enum error. Scope-403 chain proven end-to-end: sergio's last 403 at 21:33 (first poll post-deploy) → token blanked → needs_reauth → watchdog alerted 32min later. Aging watchdog's 5 rules have been running live for days; bounce-rate rule shares the now-proven emitNotification path.
- [x] P302-P303 Merge drill PASSED 15/15 live checks (scripts/qa-merge-drill.ts on synthetic venues): clean re-point (venue_domain_aliases), unique-collision savepoint path (cold_outreach_entries residual stays on archived source — zero rows lost), contact backfill (email/phone copied, google_place_id MOVED not copied), notes merge marker, archive+merged_into_venue_id chain, 'merged' pair decision upsert, 5 audit_log rows. Teardown clean.
- [x] P304-P305 Import garbage drill via real UI upload (10-row hostile CSV): 3 imported / 6 precise per-row errors / 1 intra-file dupe skipped; atomic txn held; summary table rendered. 3 findings FIXED @3581b66: (1) formula-injection names (=HYPERLINK…) stored verbatim — now rejected on import + csvCell in sheets-backup CSV fallback prefixes a quote (Sheets API path already safe via valueInputOption RAW); (2) capacity 999,999,999 accepted — capped 50k; (3) doc-vs-code mismatch: non-E.164 phones killed the whole row — now import phoneless with per-row warning per the documented intent. Drill venues deleted.
- [ ] P306-P307 Eventbrite sync (link, 4h sales pull, venue-block push markers)
- [x] P308-P309 Lineup/public API live-verified: 401 no-key + bad-key, slug=halloween-2026-intl, 1028 events / 16 confirmed venues, payload leak-scan CLEAN (never-do #6: no contact/notes/financials). FINDING: all 16 confirmed venues lat/lng NULL + 0 place ids — scripts/backfill-confirmed-venue-coords.ts ready but OPERATOR-GATED (mass venue UPDATE denied by permission layer). Brand fields (logo/colors/domain) all null = operator content gap for Smart Map.
- [x] P310-P311 Quo: webhook signature-verified (x-openphone-signature, fails closed on bad sig, acks the rest), machine-route allowlist live-probed earlier; dial controls wired (QuoDialControls via coldEntryId + tel: fallback). call_logs=0 — NO live traffic yet; end-to-end re-verify when the Quo number activates (SKIP-FLAG live portion).
- [x] P312-P313 SMS: sms_messages/sms_consent_log/host_sms_log all 0 rows; Quo SMS UI removed earlier by design; host-sms-cadence cron exists but inert without provider. Twilio build-out = SKIP-FLAG (operator).
- [~] P314-P315 Auth/machine routes re-probed clean: crons 405 (POST+secret), /api/engine/lineup/changes 401 sans key, presence auth-redirect; client-diag POST-only beacon sink (sanitized payload per earlier hardening) — full role-matrix pass remains.
- [x] P316-P317 Metric reconciliation COMPLETE. Dashboard KPIs vs independent SQL: venues confirmed 16/+14-3d EXACT, crawls complete 0 EXACT, goal 24 = campaigns.target_cities_scheduled (224 in table = all city_campaigns, by design), command-center '74' = campaign health score chip (not a count). Pipeline all 5 lanes EXACT: lead 3, Emailed 198 = coe bridge email_sent 196 + called 2, Warm 7 = ve interested 1 + bridge 6, Slot Offered 3 = negotiating, Confirmed 16. Tracker 224 cities EXACT. Emails-per-staffer verified earlier (Jun-11). FUNNEL had 2 silent-zero bugs FIXED @b1e020f: thread-to-thread join missed cross-thread venue replies (replied 28→37, warm 7→9) and could never count declines; bounced read the never-populated soft-bounce table next to 13 real bounce suppressions (0→13). Bonus finding: the 11 era 'declines' were classifier-mislabeled inbox noise (Workspace invoices, promos) — venue-keyed funnel now structurally excludes noise threads from every stage.
- [x] P318-P319 /admin/learning renders real attribution (12 tables, 23 rows, per-template reply rates 13-26% — consistent with funnel's 24% overall on 160 send events); /admin/autonomy renders verdicts (2) + policy thresholds (95/98%). Both crash-free in rig.
- [x] P320-P321 BIG CATCH: pg backup had NEVER succeeded offsite — (1) pg_dump failing since 06-11 on permission-denied for my _cleanup_contact scratch table (GRANT SELECT applied) and (2) underneath that, the B2 upload had failed EVERY run since install: endpoint URL missing https:// scheme (wrapper now prepends). 610MB encrypted dump now produced; upload re-fired for live verification. Sheets backup green daily (cron_runs success 06-10..06-12). Restore drill = SKIP-FLAG (user approval).
- [x] P322-P323 Palette search fixed+verified earlier (silent-failure class); labels healthy (13, render fine); snippets + saved views UNUSED by team (0 rows each) — pages render correct empty states. No defects; adoption is operator-side.
- [x] P324-P325 Notifications flowing (72 in 7d; bell verified in inbox work; watchdog alerts proven live); mentions feed implemented (lib/mentions-feed.ts). FINDING: daily-digest route EXISTS but was never scheduled (no crontab, zero cron_runs) — dead feature; enabling means a daily email to all staff = operator decision, flagged not auto-enabled.
- [x] P326-P327 Staff-info-sheet GENERATION NOT BUILT (0 rows; only gate references exist — send-safety correctly blocks T11 until a sheet exists, so nothing wrong ships). Belongs with posters on the SKIP-FLAG asset-pipeline list. Poster pipeline = SKIP-FLAG (operator).
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

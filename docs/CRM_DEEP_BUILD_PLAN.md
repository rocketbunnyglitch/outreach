# Deep CRM Build Plan — from skeleton to operating system

> The execution plan for the best-in-class layer (2026-06-11 audit).
> This file is the SOURCE OF TRUTH for the multi-week build: every work
> session picks the next unchecked item, builds it behind the existing
> gates (biome, tsc, server-only, hydration, vitest), ships it through
> the atomic deploy, and checks it off WITH the commit sha. Do not
> reorder phases — enforcement ships before intelligence on purpose:
> everything that prevents a WRONG action lands before everything that
> adds smarts.
>
> Locked constraints that bound every item (canonical reference doc):
> engine drafts / humans send (0.4), venue-side only (0.6), low buy-in
> (0.1), never auto-confirm (never-do #5), no open tracking on cold
> (never-do #8), expand/contract migrations (CLAUDE.md 12.6).

## Status legend
- [ ] not started   [~] in progress   [x] shipped (sha)

---

## Phase A — Enforcement: staff cannot fake progress (days 1–2)

### A1. Strict stage gates on venue-event transitions  [x d7e583a]
- lib/stage-gates.ts: pure core (unit-tested) computing transition
  requirements. Confirmed requires: venue + event linkage (structural),
  a CONTACT METHOD (venue email OR phone OR night-of contact) — hard
  block; missing slot time / agreed hours -> warning chip, not block
  (operators legitimately confirm before times settle).
- Wristband-venue "event-ready" definition: night-of contact, wristband
  shipping row not pending/issue, staff sheet, participant_poster
  deliverable done, V2 call when inside the 4-day window. Surfaced as a
  readiness checklist; hard-blocks T11/T13 sends, not the status field.
- Admin override: allowed with reason; writes an audit row; warning
  chip stays visible after override.
- Gate sites: events/_venue-event-actions.ts updateVenueEvent, every
  promote-to-confirmed path in city-campaigns/_slot-actions.ts + crawl
  slot table promote flows (grep status.*confirmed setters).
- Acceptance: confirming a venue with NO contact method fails with an
  actionable error; admin override logged; tests on the pure core.

### A2. T11 participant-sheet gate for wristband venues  [x d7e583a + cascade]
- The artifact IS modeled: crawl_deliverables.deliverable_type =
  'participant_poster'. Gate: t11BlockReason additionally requires, for
  wristband-role venue events, a participant_poster deliverable with
  status='done' (staff sheet requirement stays for all roles).
- Auto-create pending deliverable rows (social_media_graphics,
  staff_sheet, participant_poster for wristband) when a venue flips to
  confirmed, so the NBA lifecycle_blocker category and the gate have
  rows to track from day one.
- Acceptance: wristband T11 blocked until both sheets done; middle/
  final T11 unchanged; blockers visible in NBA.

### A3. Alias/persona enforcement for venue sends  [x]
- FIRST verify coverage: campaign_connected_accounts persona per
  connected inbox (query prod). If coverage is complete -> hard-block
  cold/outreach sends from inboxes without a configured persona
  ("No campaign alias configured for this inbox"); if incomplete ->
  fix config THEN enforce. Local-part-derived display names stay legal
  ONLY for internal/system mail.
- Acceptance: venue email cannot send with a guessed display name once
  enforced; actionable error; internal mail unaffected.

---

## Phase B — Event-night infrastructure (days 2–4)

### B1. Durable lineup change events + cursor API  [x]
- Migration: lineup_change_events (id, cursor bigserial, event_id,
  venue_event_id, venue_id, change_type enum [confirmed, swapped,
  cancelled, slot_changed, times_changed], public_payload jsonb,
  created_at). Writes from every lineup-mutating action (confirm,
  cancel, replace, slot/time edits).
- GET /api/engine/lineup/changes?since=<cursor> behind ENGINE_API_KEY
  (route already session-public as of 29deea2). Stable cursor ordering,
  public-safe payload only (never notes/DNC/financials — never-do #6).
- Set ENGINE_API_KEY in prod env (route currently fails closed 500).
- In-memory ring buffer demoted to optimization or deleted.
- Acceptance: change rows survive restart; polling since cursor
  returns ordered diffs; key required; payload audit for private
  fields; tests on insert + poll.

### B2. Emergency replacement playbook  [x]
- Guided flow from a cancelled/missing slot: (1) lock the exact event
  + role; (2) candidate venues ranked by past-partner history, warm
  threads, contactability (email+phone present), proximity; (3) batch
  T8 replacement drafts (review-required, as always); (4) call list
  with Quo dial controls; (5) first confirm closes the playbook and
  cancels sibling replacement drafts; (6) every step audited.
- Acceptance: from cancellation to ranked candidates in two clicks;
  no sends without review; sibling drafts auto-cancelled on fill.

### B3. Cancellation playbook UI  [x]
- lib/cancellation-flow.ts already does the engine side (stop
  downstream, T16 draft, fan-out). Wrap it in a guided modal: pick
  exact venue-event/night, cancelled-by-us vs by-them, show what will
  stop, confirm -> flow runs -> replacement playbook offered when the
  slot is required.
- Acceptance: a cancellation cannot target the wrong night; staff see
  exactly what stops before confirming.

---

## Phase C — The brain deepens (week 2)

### C1. Health score v2  [x]
- Add inputs to the health core: host assignment (P1-3 two-host rule),
  wristband shipping state, V2 call state, stale warm replies count,
  staff assignment coverage, lifecycle blocker count, inbox/domain
  health for the campaign's sending brand. Output: score + REASONS
  array (the why), severity bands.
- Health drives ordering: NBA priority boost from city/crawl health;
  tracker + dashboard surface the band with reasons on hover.
- Acceptance: a red crawl always explains itself in one line; NBA
  ordering shifts when health shifts; pure core unit-tested.

### C2. Rotting detection everywhere  [x — slot-table chips intentionally skipped: open slots already surface via health v2, NBA needs_venues, slot-need grid and tracker statuses]
- lib/rot.ts: shared staleness math (object type -> rot thresholds).
  Surfaced as chips on: warm threads (hours), open required slots
  (days), pending deliverables, V2 calls, shipping, replacement tasks.
  The aging watchdog (b6d0818) keeps notifying; this makes rot VISIBLE
  in place on every list row.
- Acceptance: any list row that is rotting shows how long; thresholds
  in one file; watchdog + chips agree.

### C3. Staff workload + accountability view  [x]
- /admin/workload: per staffer — urgent NBA items, overdue tasks,
  needs-attention replies, high-risk cities owned, blockers cleared
  (7d), response-time median. NO venues-confirmed leaderboard (bad
  incentive per audit).
- Acceptance: manager can spot overload + reassign in one screen.

### C4. Manager command center (problems-only morning screen)  [x]
- /admin/command: aggregates NBA fire-drills, watchdog rule hits,
  deliverability alerts, cancellation-review queue, system-health
  failures, backup status — only items needing a decision. Each row
  deep-links to the fix surface.
- Acceptance: zero problems renders a calm empty state; every row is
  actionable; loads under 2s.

---

## Phase D — Data + learning (weeks 2–3)

### D1. Duplicate detection v2  [x]
- Match on google_place_id (exact), phone E.164 (exact), email +
  website domain (exact, normalized), name+address trigram similarity
  within city radius. Actions: merge (with relation re-pointing),
  link-as-same-org, suppress-with-reason; every decision audited and
  remembered (no re-warning).
- Acceptance: CONTACT-import-class garbage gets caught at creation;
  merge preserves outreach history; decisions persist.

### D2. Data-quality center  [ ]
- /admin/data-quality weekly hygiene screen: missing email/phone/place
  id, venues with no city tz, impossible slot assignments, stale
  owners, contacts on multiple venues, bad domain relations. Each row
  one-click fixable or dismissible.

### D3. Timeline completeness  [ ]
- Venue timeline gains: deliverable events (graphic done, sheets),
  backup/export events, manual overrides, campaign ids on email
  entries (so campaign filtering never hides context).

### D4. Sheets backup v2  [ ]
- Add tabs/columns: health scores + reasons, V2 status per venue
  event, readiness blockers, lifecycle (T9-T17) state, replacement/
  cancellation state, NBA snapshot. The backup must be a real
  emergency fallback for the CURRENT operating model.

---

## Phase E — Post-campaign + autonomy graduation (weeks 3–4)

### E1. Post-campaign learning reports  [ ]
- Reply/confirm conversion by template, domain, sender, slot type,
  priority band; cancellations by cause; replacement success rate;
  venues-to-reuse + venues-to-avoid lists feeding next campaign's
  seeding. Turns Halloween into training data for NYE/St Pats.

### E2. Template pick by measured reply rate (Loop C)  [ ]
- Within-stage variant choice by reply rate per priority band
  (min n=20, 10% exploration). Rule table (refdoc 8.7) stays
  authoritative for STAGE.

### E3. Review-window dispatch hook  [ ]
- The deliberately-unbuilt piece of the autonomy rails (80d09f7).
  Build ONLY after: /admin/autonomy shows eligibility, operator
  flips the policy, AUTONOMY_DISPATCH_ENABLED=1 set after the
  compliance read for UK/EU/CA venues. Scheduled-send runner honors
  review_window: engine-queued drafts dispatch after the veto window
  iff policy + env + relationship/suppression gates all pass.

### E4. Hardening close-out  [ ]
- lib/env.ts canonical contract + .env.example complete; package
  manager docs match reality (npm ci is canonical, pnpm references
  removed); QA_MATRIX release-gate section (machine-route auth check,
  relationship block test, alias block, lineup polling, sales
  freshness); E2E proof of one live scheduled send through the cron;
  backup restore drill (needs operator approval — passphrase).

---

## Standing context for any session executing this plan
- Working clone: /root/work/outreach on root@203.161.61.240 (SSH key
  on the operator's Windows box). Local edit mirror:
  D:\Projects\Bash\_work\qa-fixes (re-pull files before editing).
- Ship loop: edit -> scp -> biome --write + biome --diagnostic-level=
  error + tsc + server-only audit + hydration + vitest -> Conventional
  commit (<=100 char subject, Co-Authored-By: Claude <noreply@anthropic.com>)
  -> push -> bash /root/deploy.sh (atomic, smoke-gated, ~8 min).
- Verify raw SQL columns against db/schema/* FIRST (CLAUDE.md 12.1).
- Never touch promoter-engine. Never auto-send venue mail.

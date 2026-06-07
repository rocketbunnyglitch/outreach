# Manual QA Matrix -- Live Integration Acceptance

Scope: acceptance items that CANNOT be covered by the pure-unit tests in
`*.test.ts` because they require a logged-in app, a real Gmail account, real
Google Sheets, or real Google Maps. Run these against a staging/live deploy
with a seeded operator account. Check each box only after observing the
described behavior end-to-end.

Legend: `[ ]` not run / `[P]` pass / `[F]` fail (note the failure inline).

---

## 1. Send cap (cold/warm) -- real Gmail

- [ ] Cold send #31 in one local day is BLOCKED at the per-account cap (default 30).
- [ ] The block surfaces a clear at-cap message, not a silent failure.
- [ ] Admin `bypassCap` lets the 31st cold send through and records `capBypassed=true`.
- [ ] A WARM reply (thread already has >=1 inbound) sends even at 30/30 -- warm never blocks.
- [ ] Operational/transactional mail does NOT consume a cold slot (counted_against_cap=false).
- [ ] Cap counter resets at midnight in the inbox owner's timezone (not UTC).
- [ ] Usage pill shows `used / cap (+N bypassed)` correctly after a bypassed send.

## 2. Gmail label / star / read sync (both directions)

- [ ] Star applied in the app appears as a star in Gmail.
- [ ] Star applied in Gmail appears in the app after poll.
- [ ] Marking read/unread in the app syncs to Gmail.
- [ ] Marking read/unread in Gmail syncs back to the app.
- [ ] A label added in the app is reflected in Gmail, and vice versa.

## 3. Venue communication timeline

- [ ] Sent emails are backfilled onto the venue page (not only inbound).
- [ ] Threads are account-scoped: an account only sees threads on its own inbox.
- [ ] Venue timeline aggregates across multiple connected accounts.
- [ ] Venue timeline aggregates across multiple subjects/threads for the same venue.
- [ ] An inbound from a known venue alias domain attaches to the right venue
      (note: domain-alias auto-attach is a ready-to-wire helper -- confirm whether
      it is wired before marking pass; see lib/venue-domain-match.ts).

## 4. Crawl matrix + slot-need pills

- [ ] Crawl matrix shows correct roll-up status: complete / need_final / need_middle /
      need_wristband / at_risk / outreach / stale.
- [ ] Wristband / middle / final columns reflect confirmed (incl. scheduled,
      contract_signed) venues only; declined/cancelled do NOT fill a slot.
- [ ] A day_party crawl never gets stuck at "need_final" (no final slot).
- [ ] Middle group: 1-of-2 required reads as Partial, 2-of-2 reads as Confirmed.
- [ ] Slot-need pills: 0-of-2, 1-of-2, 2-of-2 middles render the right pills.
- [ ] City status pill: need_1_venue / need_2_venues / need_3_venues / complete /
      outreach / to_be_cancelled / cancelled all reachable with the right slot math.
- [ ] A venue reused across roles/crawls does NOT overcount any role's fill.
- [ ] Stale: a city with no outreach activity in 5 days flags stale.

## 5. CSV / Maps / Sheets integrations

- [ ] CSV import prevents duplicate venues (existing email/domain match is skipped).
- [ ] Google Maps import dedupes against existing venues.
- [ ] Google Sheets export produces the expected rows/columns for a campaign.
- [ ] Reuse warning fires when adding a venue already used on another crawl/campaign.

## 6. Venue page UX

- [ ] Readiness pill on the venue page reflects current confirmed-slot state.
- [ ] Archive flow requires/records an archive reason.
- [ ] Sent backfill (section 3) is visible on the venue page specifically.

---

## 7. To / CC / BCC send safety + recipient logging

Setup: open the composer on a venue thread from a connected account.

- [ ] To-only send: enter a single To address, send. The delivered message has
      that address in To and an empty CC/BCC.
- [ ] CC send: add a CC address. Recipient (To) AND cc recipient both receive it;
      the venue timeline records BOTH addresses.
- [ ] BCC send: add a BCC address. The BCC recipient receives it but does NOT
      appear in the headers visible to the To/CC recipients.
- [ ] Recipient logging: after each of the three sends, the stored message row
      lists every recipient (to + cc + bcc) used, so the cap/audit trail is complete.
- [ ] Multi-recipient To: "Last, First <a@x.com>, plain@y.com" is split into two
      distinct recipients (the quoted comma does NOT create a third). (unit-covered;
      confirm the composer UI passes the same string through unmangled)
- [ ] Duplicate guard: the same address typed in both To and CC is de-duplicated
      to a single delivery, not sent twice.
- [ ] A malformed address in any field surfaces a validation error BEFORE send,
      not a silent drop after.

## 8. Account-scoped Gmail threads + cross-account venue timeline

Setup: connect at least TWO Gmail accounts (Account A and Account B) to one operator.

- [ ] In the inbox with AccountSwitcher set to A only, NO thread owned by B is visible.
- [ ] `?accounts=<A-uuid>` URL param scopes the inbox to A; a stale/garbage id in the
      param does NOT 500 the page (falls back to all-accounts). (parser unit-covered)
- [ ] `?accounts=<A>,<B>` shows threads from both, none from a third account.
- [ ] Same venue emailed from A and from B: the venue timeline aggregates BOTH
      account threads into one chronological history.
- [ ] Same sender, DIFFERENT subject (two separate threads): the venue timeline
      shows both threads grouped under the venue, not merged into one thread.
- [ ] Same sender, same subject across accounts A and B: each stays its own thread
      (no cross-account thread collision on subject alone).

## 9. Inbound matching: manual link, unmatched, ambiguous domain

- [ ] An inbound from a known venue address auto-attaches to the correct venue.
- [ ] An inbound with no venue match lands in an "unmatched" state (not silently dropped).
- [ ] Manual link: operator can attach an unmatched inbound to a venue by hand;
      the thread then appears on that venue's timeline.
- [ ] Ambiguous domain (e.g. shared host like gmail.com / a domain used by 2+ venues):
      the engine SUGGESTS candidates rather than auto-attaching to the wrong venue.
- [ ] Accepting an ambiguous-domain suggestion attaches the thread; declining leaves
      it unmatched for manual handling.
- [ ] After a manual link, a subsequent inbound on the same thread/address auto-attaches
      (the link is remembered).

## 10. Gmail sent backfill + label/star/read sync (directional detail)

- [ ] Open a venue that was emailed BEFORE it was added to the system: previously
      sent messages are backfilled onto the venue page (not only post-add inbound).
- [ ] Backfill is account-scoped: only sent mail from the connected account(s) appears.
- [ ] Star in app -> star in Gmail within one poll cycle (note the latency).
- [ ] Star in Gmail -> star in app within one poll cycle.
- [ ] Mark read in app -> read in Gmail; mark unread in Gmail -> unread in app.
- [ ] Label add/remove round-trips both directions without creating duplicate labels.
- [ ] A sync conflict (changed in both places between polls) resolves deterministically
      (note which side wins).

## 11. Google Sheets export (now armed) + Event-Day Readiness blockers

- [ ] Sheets export for a campaign produces one row per expected entity with the
      documented columns (header row present, no shifted/missing columns).
- [ ] Re-running the export updates the SAME sheet/tab rather than appending a duplicate set.
- [ ] An empty campaign exports headers only (no crash, no phantom rows).
- [ ] Event-Day Readiness shows a BLOCKER when a required slot (wristband / final /
      a required middle) is unfilled.
- [ ] Readiness CLEARS to ready once every required slot is confirmed
      (confirmed / scheduled / contract_signed).
- [ ] A day_party crawl (no final slot) does NOT show a "missing final" blocker.
- [ ] Each blocker links to or names the specific unfilled slot so the operator
      knows exactly what to fix.

## 12. Dedupe paths: CSV re-import + Google Maps paste-add

- [ ] CSV re-import of a file already imported adds ZERO new venues (email/domain match skips).
- [ ] CSV import with a new venue + an existing venue imports only the new one.
- [ ] Google Maps paste-add of a venue already present is detected as a duplicate
      (matched on name+address or place id, not silently re-added).
- [ ] Google Maps paste-add of a genuinely new venue is added normally.
- [ ] City-name fuzzy match on import: an exact name auto-accepts; a 1-char typo
      auto-accepts; a duplicate city name surfaces as ambiguous for review;
      an unknown name lands in not-found. (matcher unit-covered; confirm UI wiring)

## 13. Slot scenarios + crawl matrix (0 / 1 / 2-of-2)

For a single crawl, walk each state and confirm the roll-up pill + slot pills:

- [ ] Missing WRISTBAND only -> status need_wristband; wristband pill empty.
- [ ] Missing FINAL only -> status need_final; final pill empty.
- [ ] Missing MIDDLE 1 only (middle 2 filled) -> status need_middle; 1-of-2 partial.
- [ ] Missing MIDDLE 2 only (middle 1 filled) -> status need_middle; 1-of-2 partial.
- [ ] BOTH middles missing -> 0-of-2; status reflects two-venue need.
- [ ] Both middles filled -> 2-of-2 Confirmed; middle need cleared.
- [ ] Venue REUSE across roles in the same crawl does NOT overcount (one venue
      cannot fill both a middle and the final and clear both needs).
- [ ] SAME-CRAWL duplicate: adding the same venue twice to one crawl is rejected
      or de-duplicated (no double-fill of a single slot).
- [ ] Shared-template OVERRIDE: a crawl using a shared template with a per-crawl
      override sends the override copy, not the shared default.
- [ ] Crawl matrix across a 2-crawl city: 0-of-2 complete, 1-of-2 complete, and
      2-of-2 complete each render the correct city-level roll-up.
- [ ] Declined / cancelled venue does NOT fill any slot even if it occupies a row.

---

## 14. Send-intent & cadence safety (P0/P1 audit, 2026-06-06)

The dangerous flows from the "push to 10/10" audit. Legend additions: `[U]` =
proven by automated unit tests (`npm test`); `[V]` = verified read-only against
prod (no send); `[ ]` = needs a live send (the production send-gate the operator
deferred). "Counts as cold" is checked via `email_send_events`
(`send_intent`, `counted_against_cap`) + `venue_campaign_touch_log`.

### Explicit send intent (`lib/send-intent.ts`)
- [U] T9 / T14 / T13 / T15 derive `send_intent = lifecycle`; T16 -> `cancellation`;
      T17 -> `post_event`; T1 / T3 / T4 / T8 -> `cold_cadence`; warm reply ->
      `warm_cadence`; H0a/H0b -> `host`; V1 -> `lifecycle`. (28 tests in
      `lib/send-intent.test.ts`.)
- [U] A new venue thread with NO template/touch derives `unknown` -- it never
      seeds cold cadence and never records a cadence touch (it still counts vs the
      cold cap for deliverability). No silent fallback to `cold_touch_1`.
- [ ] LIVE: a human sends a T9 to a confirmed venue. Expect: a new send_event row
      with `send_intent='lifecycle'`, `counted_against_cap=false`, NO new
      `venue_campaign_touch_log` row, and the thread is NOT stamped
      `cold_pending_touch_1`. Repeat for T11/T14/T16/T17.
- [ ] LIVE: a human sends a T1 cold opener. Expect `send_intent='cold_cadence'`,
      `counted_against_cap=true`, a `cold_touch_1` touch-log row, thread seeded
      `cold_pending_touch_1`. (Cold cadence still works -- zero behavior change.)
- [ ] LIVE: a cold follow-up advances to `cold_touch_2`/`cold_touch_3`; a warm
      reply records `warm_nudge_*` only when the thread's cadence_state is a
      pending-nudge (else no touch).

### Scheduled-send cron safety (boundary intact)
- [V] No venue draft can auto-send: `SELECT count(*) FROM email_drafts WHERE
      recipient_type='venue' AND send_mode='auto_allowed'` = **0** on prod.
- [U] `cronMaySendDraft` allows only `operator_scheduled+approved_at` or
      `auto_allowed` for host/internal/system (10 tests in `send-mode-gate.test.ts`).
- [ ] LIVE: an `auto_allowed` VENUE message is refused by the cron; an
      `auto_allowed` host/system message sends only if creds allow.

### Cross-domain handoff scope (P0-2)
- [V] Code now constrains the handoff UPDATE to `email_threads.id = thread.id`
      (re-asserting exhausted-cold state) -- `_handoff-actions.ts`.
- [ ] LIVE: a venue with TWO exhausted-cold threads; hand off ONE. Expect only the
      selected thread reset + re-attributed; the other exhausted thread and any
      warm/confirmed/lifecycle threads untouched.

### Cancellation: event-specific + fan-out (P0-3 / P1-1)
- [V] Cleanup is scoped by `venue_event_id` (drafts) / `target_id`
      (tasks); T16 is built with the cancelled `eventId` (night-specific).
      Relationship is left neutral (no auto-bad-flag).
- [ ] LIVE: a venue confirmed Thursday (wristband) + Friday (middle). Cancel
      Thursday. Expect: Thursday drafts/tasks stop, Friday's survive, Thursday slot
      needs-replacement, Friday stays confirmed, T16 references only Thursday.
- [ ] LIVE: cancellation notifies city lead + booking owner + campaign_manager +
      lifecycle_owner; host_payment_coordinator only if a host is assigned;
      wristband_coordinator only if the slot was a wristband; graphics_designer
      only if a `social_media_graphics` deliverable is pending. Week-of/day-of:
      a pending `sms_messages` row with `status='unconfigured'` per notified
      staffer with a phone.

### V2 floor-staff readiness (P1-2)
- [U] A confirmed event 0-4 days out, not briefed, is a readiness `blocker` +
      `at_risk`; briefed or outside the window is not (11 tests in
      `event-readiness-core.test.ts`).
- [ ] LIVE: a confirmed event 2 days out with no floor-staff briefing shows the red
      BLOCKER chip and sorts to the top of its date bucket in /worklist.
- [ ] LIVE: recording a `no_answer`/`voicemail` outcome creates a deduped "Retry
      floor-staff call" task due tomorrow; 3+ attempts escalates a notification.

### T10 / T11 lifecycle blockers (P0-4)
- [U] `isT11Touch` gates a T11 draft until a `staff_info_sheets` row exists for its
      `venue_event_id` (covered around `send-mode-gate.test.ts`).
- [ ] LIVE: attempting to send/approve a T11 with no info sheet is blocked with a
      clear message; T10 is a confirmation-cascade TASK (no auto venue email) and
      the graphic attaches only once uploaded.

### Effective priority sorting (P1-4)
- [U] Inside 21 days a selling P4 outranks a quiet P1; static stays visible; reason
      string present (10 tests in `effective-priority.test.ts`).
- [ ] LIVE: the call queue AND the floor-staff briefing queue show the
      `P{static}->P{effective}` badge and order by effective priority.

---

## Notes for the tester

- "Local day" for the cap is the INBOX OWNER's timezone, default America/Toronto.
- "Confirmed" everywhere in the matrix/pills = status in
  (confirmed, scheduled, contract_signed).
- Pure parsing/label logic (email header parsing, day-part labels, country
  abbrev) is already covered by automated unit tests (`npm test`); this matrix
  is only for the live-integration paths those tests cannot reach.

# Implementation status -- canonical reference doc -> code

> This file records HOW the engine currently implements the business rules in
> `lib/reference-docs/halloween-2026-intl-engine-reference.md` (the canonical
> reference doc). It is the canonical-doc-section -> code mapping.
>
> The canonical reference doc holds only business rules / operating principles
> / template + cadence + lifecycle logic / definitions. Implementation STATUS
> (what shipped, in which phase, in which file) lives here, NOT in the canonical
> doc, because that doc is embedded for AI retrieval and must stay free of
> implementation churn.
>
> These notes were moved out of the canonical doc (the inline
> "[ENGINE - current behavior]" subsections and the former section 13). They
> are organized by the business-section number they implement. Known gaps
> between the rules and the code live in `docs/REFERENCE_DOC_GAPS.md`.
>
> Last updated: 2026-06 build (Phases 3.5, 5, 6, follow-ups).

---

## 1.6 Sales-driven scheduling pivot (effective priority) -> lib/effective-priority.ts (Phase 2.15)

`lib/effective-priority.ts` `computeEffectivePriority({ staticPriority, ticketsSold, daysToEvent })` returns `{ effective, reason, pivotActive }`. Priority range is the real `city_campaigns.priority` scale, **1 (highest) .. 10 (lowest)** (not 1-6); results clamp to that range. Concrete bands (calibrated to the LOCKED example -- Toronto 1/0 sold/14d -> 3, Detroit 4/35 sold/14d -> 2):

- `daysToEvent > 21`: pivot inactive, `effective = static`.
- Inside the window (`<= 21` days), by ticket sales:
  - `> 30` sold -> up 2 tiers; `> 20` sold -> up 1 tier (up = lower number = more important).
  - `0` sold and `<= 14` days out -> down 2 tiers; `0` sold and `15-21` days out -> down 1 tier.
  - `1-20` sold inside the window -> no tier change.

Sales source = `SUM(events.ticket_sales_count)` per city campaign; `daysToEvent` = earliest upcoming `events.event_date`. With no events / no sales the pivot stays inactive, so this is safe before any ticketing integration is live.

Wired into the **worklist Calls queue** (`lib/worklist-data.ts` `loadWorklistCalls` re-ranks by effective priority before the 8-row cap; the badge shows `P{static}->{effective}` with the reason on hover). The cold-outreach table is scoped to a **single** city campaign, so every row shares the same effective priority -- a per-row sort there is a no-op; the cross-city pivot lives in the worklist instead.

---

## 3.3 Per-venue x per-domain relationship history -> lib/venue-relationships.ts (Phase 3.9/3.10/3.11)

Stored in `venue_domain_relationships` (one row per venue x outreach_brand). Helpers in `lib/venue-relationships.ts`.

- **Auto-detect (3.9):** the inbound classifier (`lib/ai-classify.ts`) updates the flag after each classification -- `hard_no` -> `bad` with `auto_clear_at = now + 1 year` (overrides any prior flag, `set_by = auto_inbound`); a first `engaged` -> `neutral` only when no row exists yet (never downgrades a good/bad; `good` still needs an explicit operator/post-event signal); `cancelled_by_them` never auto-flags bad.
- **Hard block (3.10):** `composeAndSend` refuses to send when the venue x sending-brand flag is `bad` (`relationshipBlocked`). Admins override via the same `bypassCap` path as the cap/cooldown; non-admins are hard-blocked. NOTE: this gate is on the interactive composer; the scheduled-send runner re-checks it only for T17 (see 7.15.2 below) -- see `docs/REFERENCE_DOC_GAPS.md` for the remaining gap.
- **Decay (3.11):** `POST /api/cron/relationship-decay` (daily, cron_runs-logged) clears `bad` flags past `auto_clear_at` back to `no_history`. Operator must add the crontab entry.

---

## 5.7 Where the pitch number is surfaced -> merge engine (ENGINE - current behavior)

The initial-pitch number from 5.2 is derived from **city priority x slot type** and is available **even before a venue is booked** -- when the venue has no confirmed role yet the engine falls back to the city's primary crawl and a default slot, so an opener can still quote the expected turnout. It is surfaced in:

- **Warm re-engagement opener (T3):** a light expected-guests mention -- "around {{guest_count}} guests through each venue across the night" -- so a past partner sees the upside up front.
- **Slot-detail follow-up (T4):** the full quote -- "around {{guest_count}} people for your slot" -- paired with the 5.1 wave qualifier.

The bare cold openers (T1/T2) intentionally omit a number (the ask is the slot, not the turnout pitch). Detailed turnout quotes (T4 onward) always carry the wave framing from 5.1; the T3 one-liner is a teaser, not a precise commitment.

(Note: the business rule "slot-type x priority drives the number" lives in canonical section 5.6; this is where that number is wired into templates.)

---

## 6.2 Cross-domain handoff -> handoff actions (Phase 2.14)

On the cold-outreach table, a row whose thread `cadence_state = 'cold_exhausted_ready_for_handoff'` shows a **Handoff** button. It opens a picker of the org's other active outreach brands (`app/(admin)/city-campaigns/_handoff-actions.ts` `loadHandoffOptions`), each showing that brand's last touch to the venue and whether the 7-day floor is met (computed from `venue_campaign_touch_log`: floor = 7 days since the most recent touch from a *different* brand). Brands still inside the floor are disabled with the available date.

Selecting a brand (`handoffColdOutreach`) re-checks the floor server-side, then resets the venue's `email_threads` row for the campaign to `cadence_state='cold_pending_touch_1'` (next-due now) and re-attributes that thread's `outreach_brand_id` to the target brand. The fresh T1 opener is generated by the composer (the operator picks the target brand's inbox/alias to send from). Data-model note: cold entries carry no brand and the sending domain is the chosen inbox, so the handoff does not invent a per-venue brand-override column -- it reuses the thread's brand attribution + the composer's inbox selection.

---

## 6.9 Send pacing -- cold-send cooldown + email queue (ENGINE - current behavior)

On top of the cadence floors (6.1-6.4) and the per-campaign hard cap (6.3), the engine paces individual SENDS to protect deliverability -- Gmail flags bursts. Every queued or sent email is still **human-written and human-reviewed**; pacing only controls WHEN a message leaves the inbox, never what it says.

- **Cold-send cooldown.** After a cold send to a NEW thread, that inbox enters a randomized **5-8 minute** cooldown before the next cold send is allowed. Warm replies / in-thread sends are exempt (those are responses, not outreach). The composer shows a live countdown ring next to the inbox's daily send counter; an admin can override.
- **Email queue.** Instead of "Send now", an operator can **Queue** a cold email and move on. Queued sends auto-stagger per inbox on an irregular schedule -- roughly **4-9 minutes apart, with sub-minute jitter and an occasional longer pause** -- so a batch never goes out as a burst and the spacing isn't a detectable fixed rhythm. A background cron dispatches each one when its time arrives; the **Email Queue** page shows Queued / Sending / Sent with cancel + edit. The per-inbox daily send cap still applies at dispatch time.

The intent: an operator can write and review a batch of cold emails, queue them, and switch to other work while they trickle out naturally.

---

## 6.10 How open slots are communicated in openers (ENGINE - current behavior)

When an opener lists what's still open (the {{slot_list_detailed}} field in T1/T2/T3), the engine writes it the way a person would -- concise, not an exhaustive machine dump:

- **Identical days collapse.** Dates that share the same set of open roles are grouped into ONE block -- the dates are listed together and the slot times written once ("Thu, Fri & Sat -- every slot open: ...") rather than repeating an identical list for each date. Only dates whose openings genuinely differ are itemized separately.
- **Past / completed crawls are dropped** from the list automatically -- the engine never pitches a slot on a date that has already happened.
- **Social proof.** A separate line names venues already confirmed elsewhere in the city (deduped, so a venue never repeats), kept visually distinct from the open-slot list so it reads as momentum, not availability.

General copy principle: summarize the common case, surface only the exceptions, and never overwhelm -- a real person collapses repetition.

---

## 7.1 Post-confirm lifecycle scheduling -> lib/lifecycle-scheduler.ts (Phase 3.1/3.2)

`lib/lifecycle-scheduler.ts` `scheduleLifecycle({ venueEventId, ownerStaffId, teamId })` auto-creates the post-confirm scheduled `email_drafts` when a venue_event flips to `confirmed` (wired in `updateVenueEvent` alongside the existing confirmation-cascade, which keeps owning the operational TASKS + graphics deliverable -- the scheduler owns the EMAILS). Touches: **T9 / T9-near** (confirm time, REVIEW draft -- `scheduled_for` null, operator reviews/edits/sends per 7.2; inside the 3-week window the loaded T9-near variant replaces the sparse T9 and bundles the T11 info), **T11 (event -21d, far confirms only)**, **T13 (-14d), T13W (-7d, week-out), T14 (-1d, day-before), T15 (morning-of), T17 (+2d)**. T9/T9-near/T11 were seeded 2026-06-05 (operator-approved copy; live DB only -- `scripts/seed-halloween-2026-templates.ts` not yet updated, but it isn't run on deploy so the live rows persist). T10 is the graphics email, gated by graphics readiness rather than time, so it is not time-scheduled here. The `{{wristband_ask_line}}` field (the shipping-address ask in T9-near) is populated only for wristband venues. Each draft is rendered through the real merge engine (`buildFlatMergeContext` -> `renderTemplate`), `scheduled_for` set, owned by the `lifecycle_owner` engine role (falls back to the confirming operator). Idempotent: T13/T14 skip when `venue_events.two_week_email_sent_at` / `one_week_email_sent_at` is already stamped, past-window touches are skipped, and a re-confirm drops prior unsent future drafts for the same venue+template before re-inserting. Multi-night (3.3): when a venue is confirmed for more than one crawl in the campaign, the schedule anchors to the EARLIEST confirmed night (so confirming a later night doesn't shift or drop the set via the per-template dedup), and the `{{venue_nights_summary}}` merge field names every night ("Thursday Oct 29 as wristband + Friday Oct 30 as middle"). Per-night day-of (T15) splits and the late-addition T9-near collapse (3.4) are later refinements -- see `docs/REFERENCE_DOC_GAPS.md`.

### Week-out (T-7) touch -- T13W (week-out cadence, 2026-06-05)

Added a **week-out (T-7) touch, `T13W`**, and re-anchored the day-before touch. Previously `T14` (whose copy is "see you tomorrow") was scheduled at event -7 days, so venues got a day-before email a week early and there was no true week-out update. Now: **`T13W` at -7d** is a turnout-update + asset-bundle summary -- it leads with the range-safe `{{turnout_quote_current}}` figure, tells the venue the number will climb (70-80% of sales land in the final days, per 0.2) and that a firmer headcount follows a day or two before, and flags the assets heading their way (staff info sheet, participant poster, social graphics). **`T14` is re-anchored to -1d** (a true day-before check-in; it already carries the range-safe turnout figure, which only made sense the day before). Owner is the `lifecycle_owner` engine role (Bryle). `T13W` reuses the `one_week_email_sent_at` idempotency column; `T14` at -1d relies on the per-venue+template delete-then-insert dedup. Eventbrite links + an exact headcount in the bundle await the Eventbrite pull integration (Phase 5.9) -- `events.ticket_sales_count` is 0 until then, so the turnout figure is the Section 5.3 range, not a live count.

---

## 7.13.9 Host briefing flow -> lib/host-briefing.ts (Phase 3.6/3.7)

`lib/host-briefing.ts` `scheduleHostBriefings({ crawlHostId, externalHostId, staffId, teamId })` runs from `assignExternalHostToCrawl` (the hire/link trigger -- a host links to a CRAWL via `crawl_hosts.event_id`, not a venue_event). It drafts both briefings as `email_drafts` rendered through the real merge engine, addressed to `external_hosts.email`:

- **H0a** -> `scheduled_for = null` (review-and-send now, so the host manager confirms pay/identity before it goes out).
- **H0b** -> `scheduled_for` = Monday 13:00 UTC of the event week.

The wristband venue of the crawl supplies the venue address + lineup merge fields; host identity/pay/shift fields come from `external_hosts` via `hostExternalId`. Idempotent on re-assign (drops the prior unsent draft to the same host email per template). Internal-staff hosts get nothing here (their info flows through T11/T13/T14).

---

## 7.15.2 T17 relationship gate at auto-send -> scheduled-send runner (Phase 4 / follow-up)

The scheduled-send runner re-checks the venue x outreach-brand relationship before auto-sending a relationship-gated lifecycle template (T17). If the pair is flagged bad, the draft is cancelled (stamped sent_at with a null sent_thread_id so it never retries) and not delivered. Good/neutral pairs send as before.

---

## 7.16 Cancellation flow -> lib/cancellation-flow.ts (Phase 4.1/4.3/4.4/4.5)

`lib/cancellation-flow.ts` `triggerVenueCancellation({ venueEventId, reason, byStaffId, teamId })`. Operator-initiated -- it fires from the inbox "Cancelled" quick-action (the human confirming `cancelled_by_them`), which cancels the venue's confirmed bookings in that thread's campaign (campaign-scoped so it never touches another campaign's bookings). It:

- marks the `venue_events` row `status='cancelled'` + stamps `cancelled_at` / `cancellation_reason` / `cancelled_by` (migration 0112);
- **stops downstream** -- deletes the venue's unsent SCHEDULED lifecycle drafts (T13-T17) and cancels the pending AUTO tasks for the event;
- **drafts T16** to the venue with `cancellation_reason_phrase` = the operator's reason, `scheduled_for = null` (review + send, never auto-sent);
- **notifies** the city lead.

Consistent with 7.16.4, it does NOT touch the relationship flag (no auto-bad on cancellation). Not yet built: acknowledgment tracking + auto-escalation (4.6), comeback flow (4.8), misrouted-positive-reply routing (4.9), and the dedicated cancelled-venues view (4.7) -- see `docs/REFERENCE_DOC_GAPS.md`.

---

## 8.2 Inbox ordering -> inbox thread list (ENGINE - current behavior)

The inbox thread list is Gmail-style: a thread is bumped to the top only when an **inbound reply** arrives, NOT when the operator sends. Sending an email leaves the thread where it was (it sorts by last inbound activity, falling back to thread creation time for threads with no reply yet). This keeps "what needs my attention" -- i.e. who replied -- at the top, instead of the operator's own outbound churn reshuffling the list.

---

## 9.4 Slot-change replies -> lib/slot-change-detect.ts (mirrors section 9.4)

Inbound replies are scanned by a conservative heuristic detector (`lib/slot-change-detect.ts`) -- NOT a new AI classification value. It fires only when the venue already holds a confirmed venue_event AND the reply contains a change-intent phrase (for example "can't do", "switch to", "move to", "different night"). A match sets `email_threads.slot_change_requested`. The operator's worklist shows a "Slot change requested" section; "Approve swap" cancels the original slot (triggerVenueCancellation) and confirms the operator-chosen new slot, firing the confirmation cascade + lifecycle. The swap is operator-driven; the engine never re-slots automatically.

---

## 8.5 Confirmed -> crawl from the inbox (never auto-confirm)

A new inbox "Confirmed" quick action records classification=confirmed and creates a venue_events row at status=lead (role=middle placeholder, no slot position) on the thread's earliest upcoming event. This surfaces the venue in the crawl table as an unplaced lead. It does NOT set status=confirmed -- placing the venue on a real slot remains a human click, per the never-auto-confirm rule.

---

## 7.14.2 Host SMS cadence H1-H5 (mirrors section 7.14.2)

External hosts assigned to a crawl get an automated SMS cadence computed from event_date by the host-sms-cadence cron: H1 about 7 days out, H2 about 2 days out, H3 day-of, H4 about 1 hour before shift, H5 on arrival reply or escalation. Idempotency is per (external host, event, touch) via host_sms_log. Inbound "YES"/replies mark the latest pending touch responded. Lineup-change, payment-confirmation, and post-event distribution-count SMS are also available. ALL SMS is INERT until Twilio + A2P 10DLC creds are set: sends are logged to sms_messages with status=unconfigured and no message leaves the system.

---

## 7.9 Cancellation-review queue (mirrors section 7.9)

A Tue/Wed/Thu cron (cancellation-review) scans confirmed venues on upcoming events for risk signals (no/low ticket sales in the lean-cancel band, structural gaps, or a quiet/stalled confirmed venue) and notifies the city lead to review. It never cancels automatically -- human-in-the-loop.

---

## 7.16 Emergency replacement (mirrors section 7.16)

When a confirmed venue drops, the operator can trigger an emergency replacement for the open slot from the event page: the engine drafts review-and-send outreach (cadence floors suspended via the existing override) to reachable same-city backup venues. Drafts are never auto-sent. There is no T8 template; the campaign cold opener is used.

---

## 3.13 / 7.14 Event readiness + floor-staff escalation (mirrors section 3.13 / 7.14)

The floor-staff worklist shows a readiness pill (prep steps done vs pending from the venue_events timestamps). Three or more floor-staff call attempts with no briefing confirmed auto-escalates a notification to the city lead (fallback host-payment coordinator).

---

## 0.7 Engine lineup read API (mirrors Smart Map / Eventbrite glossary)

The engine exposes a public-safe confirmed-lineup JSON API (app/api/engine/lineup) for Smart Map / Eventbrite to consume instead of Sheets/web-form. It returns only confirmed venue facts (name, address, role, slot times, lat/lng) + CrawlBrand public branding -- never internal notes, financials, or cross-brand history. A recordLineupChange hook signals consumers on lineup changes.

---

## 7.15 Operator debrief (mirrors section 7.15)

The event page has a post-event debrief notes field (events.debrief_notes) -- a single last-writer-wins field stamped with who/when, for the whole crawl night.

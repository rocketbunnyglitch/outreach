# Engine Reconciliation — spec vs. actual code

**Purpose.** Before continuing the phased build, this reconciles every assumption the remaining spec (`docs/engine-build-spec-phased.md`, phases 1.9 → 6) makes about field names, function signatures, migrations, and existing systems against the real code, so we stop building modules that don't connect.

**Companion file:** `docs/recon-inventory.md` — the exhaustive, auto-generated inventory (every table + column from the live DB, every `lib/` export, every `app/api` route). This document is the *analysis*; that file is the *reference*.

**Status:** awaiting operator approval. No spec edits made yet.

---

## Part 1 — How the current engine actually works

Next 15 App Router + Drizzle + Postgres. Crons are `POST` routes hit by system crontab with an `X-Cron-Secret` header (no `vercel.json`; schedules live in route docstrings). Engine is **Anthropic-only** (`claude-haiku-4-5`), **no embeddings/pgvector** — retrieval is the curated map + Postgres FTS.

**Send pipeline (live, mature).** `email_drafts` → `sendDraft` → `sendDraftAsUser` (packs FormData) → `composeAndSend` (`"use server"`) → `composeAndSendImpl(staff, formData)` in `lib/compose-send-impl.ts` (kept out of `"use server"` so the scheduled-send cron can call it with an explicit owner). Order of gates: role ≥ outreach → recipient validation → inbox on-team + send-ownership → `runSendSafetyForRecipients` (HARD: suppression, venue `do_not_contact`; WARN+ack: duplicate, recent_decline 90d, cross_staff_owner, domain_alias_suggestion) → `preflightSend` cold-cap (admin `bypassCap`) → reply wrong-account guard. Writes `email_send_events` (via `recordSendEvent`), `email_threads`, `email_messages`, updates `email_drafts.sent_at`. **On send it clears the OLD cadence: `follow_up_stage=0, follow_up_next_due_at=null`.**

**Cadence — TWO systems; OLD is live, NEW is dormant.**
- OLD (live): `lib/follow-up-cadence.ts`, state on `email_threads.follow_up_stage` (smallint 0/1/2) + `follow_up_next_due_at`. `runFollowUpCadence()` flips silent cold threads to `follow_up_due` (+4d) then creates a "Call venue" task (+7d). Driven by `app/api/cron/follow-up-cadence/route.ts` (daily 9am). `clearCadenceOnAction(threadId)` is called by `app/(admin)/inbox/_actions.ts` on operator actions.
- NEW (built by phases 1.7/1.8, **NOT wired**): `lib/cadence-engine.ts` + `-core.ts`, state on `email_threads.cadence_state` (pgEnum, 20 values) + `cadence_next_due_at`, plus `venue_campaign_touch_log`. `planNextTouch`, `checkCadenceFloors`, `recordTouch`. Only referenced by its own test. **Nothing triggers it yet.**

**Reply classification (live).** `lib/ai-classify.ts` → `claude-haiku-4-5`, writes **only** `email_threads.suggested_classification` / `_confidence` / `_at` (never overwrites operator-confirmed `classification`; skips if already classified). Then `lib/ai-auto-status.ts` `syncColdStatusFromClassification` maps it to `cold_outreach_entries.status`. Triggered by the gmail-poll worker after ingesting an inbound message. Enum `reply_classification` (10): interested, warm, confirmed, question, callback_requested, decline, unsubscribe, auto_reply, spam, unclassified.

**Confirmation / lifecycle (live, task-based — NOT email-based).** `lib/confirmation-cascade.ts` `generateConfirmationCascade(tx, venueEventId)` runs inside the venue_event update transaction (triggered by `app/(admin)/events/_venue-event-actions.ts` on status→confirmed). It deletes prior `source='auto'` tasks and inserts 4 `tasks` (poster, 2-week confirm, 1-week confirm, floor-staff brief) assigned to `city_campaign.lead_staff_id`. Post-confirm timing is tracked by **5 timestamp columns on `venue_events`** (`confirmed_at`, `two_week_email_sent_at`, `one_week_email_sent_at`, `three_day_call_completed_at`, `floor_staff_call_completed_at`) + the `crawl_deliverables` table (migration 0075). **There is no automated post-confirm email lifecycle today** — it's tasks + checkboxes.

**Crons:** gmail-poll (5m), scheduled-sends (5m), stale-tagger (10m), eventbrite-sync (15m), inbox-alerts (30m), follow-up-cadence (daily 9am, OLD), daily-digest (daily 1pm), inbox-daily-stats (daily). All wrap `recordCronRun`.

**Templates + merge (just fixed).** Single render path: `buildFlatMergeContext` (44 flat fields from real tables) → `renderTemplate`. Used by both `/templates` preview and the live composer. `pickTemplate` scores campaign templates via `template-picker-score`. `email_templates.trigger_context` already has channels `cancellation`/`post_confirm`/`lifecycle`/`host_brief`/`venue_confirm_internal` — taxonomy anticipates unbuilt phases.

**Greenfield (only enum/template scaffolding exists, no functional code):** cancellation workflow, relationship flags, SMS/Twilio, `/worklist`.

---

## Part 2 — Cross-cutting corrections (apply to the whole spec)

| # | Issue | Reality | Spec fix |
|---|---|---|---|
| C1 | **Migration numbers collide.** Spec hardcodes 0095 (1.9), 0096 (1.12), 0097 (1.13), 0098 (1.14), 0099 (3.8), 0100 (3.13). | 0093–0096 are already taken (0093 engine_picked, 0094 cadence, **0095 campaign_email_brand**, **0096 external_host_brief**). | Renumber the spec's migration chain to **start at 0097** and shift each by +2: 1.9→0097, 1.12→0098, 1.13→0099, 1.14→0100, 3.8→0101, 3.13→0102, 4.6→0103. Treat all spec migration numbers as relative, not absolute. |
| C2 | **`staff_outreach_emails(id)` referenced in DDL** (1.7 touch log; any FK to the sending email). | Renamed to **`connected_accounts`** in migration 0042 (`staffOutreachEmails` is a Drizzle alias of `connectedAccounts`). | Every FK the spec writes to "staff_outreach_emails" must target `connected_accounts`. (Already done in 0094.) |
| C3 | **Appendix B assumes `OPENAI_API_KEY` + pgvector installed.** | Engine is **Anthropic-only** (`claude-haiku-4-5`); no embeddings, FTS-based retrieval; pgvector apt-installed but **unused**. | Strike OPENAI/pgvector from the spec's pre-flight. Classifier prompt phases (1.13) use the existing Anthropic `lib/ai.ts` path + `retrieveRelevantSections` (FTS). |
| C4 | **Spec says "modify `compose-send-impl.ts` or equivalent", "classifier in `lib/ai.ts`", "confirm action in `_slot-actions.ts`".** | Exact paths: send = `lib/compose-send-impl.ts`; classifier = **`lib/ai-classify.ts`** (not `ai.ts`); venue-confirm = **`app/(admin)/events/_venue-event-actions.ts`**; cadence cron = `app/api/cron/follow-up-cadence/route.ts`. | Pin the real paths in each phase block. |
| C5 | **Named-person dependencies** (Bryle as default lifecycle owner, Brandon for wristband/host pay). | No code resolves these. | Add a config/lookup (e.g. role-based or a `campaign.lead_staff_id` / a settings row) instead of hardcoding user_ids; or capture the IDs explicitly before Phase 3. **Needs operator input.** |
| C6 | **Phase 6.1–6.8** referenced in the run brief. | The spec's Phase 6 is a **single placeholder** with no enumerated sub-phases. | Either flesh out Phase 6 before building, or treat 4.9 as the autonomous stop (matches the existing stop rule). |

---

## Part 3 — Per-phase reconciliation (1.9 → 4.9)

Legend: **REUSE** = wire to existing code; **EXTEND** = add to existing; **NEW** = greenfield (verify connection points); **FIX** = spec assumption wrong.

### Phase 1 remainder
- **1.9 Cadence floor enforcement** — FIX migration → **0097** (not 0095). REUSE `checkCadenceFloors` (built). Enforcement point = `lib/compose-send-impl.ts`; campaign+brand are **not threaded through** the send path today → derive server-side from venueId/cityCampaignId, fail-open. Admin-override flag mirrors the existing `bypassCap` pattern. The send pipeline does **not** call `recordTouch` yet — 1.9 is read-side only; the touch log is populated by 1.10/1.11.
- **1.10 Daily cadence cron rewrite** — REUSE `planNextTouch`. The "existing cadence cron" = `app/api/cron/follow-up-cadence/route.ts`. **Decision:** add a NEW cron (e.g. `cadence-advance`) and leave the OLD one until 1.11 backfills, rather than mutating the live cron in place. Writes `email_drafts`, logs `cron_runs`. Also must call `recordTouch` when a draft is actually sent (or the floor never has data) — clarify in spec.
- **1.11 Migrate threads to cadence_state** — REUSE. `scripts/migrate-cadence-state.ts`. Maps OLD `follow_up_stage` (0/1/2) + thread `state` (closed_won/lost/dnc) → `cadence_state`. **Connection risk:** the send pipeline currently *clears* `follow_up_stage` on send and the inbox calls `clearCadenceOnAction`; after cutover those must also (or instead) maintain `cadence_state`. Sequence 1.9→1.10→1.11 must also update `compose-send-impl` + `inbox/_actions` to write the NEW fields, else the new engine and the live send path disagree. **This is the highest-risk integration in the build.**
- **1.12 reply_classification enum +2 values** — EXTEND. FIX migration → **0098**. `ALTER TYPE reply_classification ADD VALUE 'stalled_warm','cancelled_by_them'`. Mirror in `db/schema/enums.ts`. Note: enum already has `interested/warm/decline/unsubscribe` so the doc's engaged/soft-no/hard-no map to existing values.
- **1.13 Classifier prompt uses Reference Doc** — EXTEND `lib/ai-classify.ts` (NOT `ai.ts`). FIX migration → **0099** (`classifier_runs`). Uses Anthropic, `retrieveRelevantSections` (FTS) — C3.
- **1.14 90% confidence + needs_attention** — EXTEND. FIX migration → **0100** (`email_threads.needs_attention`). `is_stale` already exists (stale-tagger) — distinct concept; keep separate. Classifier already writes `suggested_classification_confidence`; threshold logic lives in the classify path.

### Phase 2 — Worklist + inbox (NEW UI over mostly-existing data)
- **2.1–2.6 `/worklist`** — NEW page. Data sources exist: `email_drafts`, `email_threads` (state/classification/needs_attention/cadence_next_due_at), `cold_outreach_entries`, `call_logs`, `email_send_events`. No migration. 2.5 Calls uses the **existing Quo/OpenPhone** integration (`lib/call-matching.ts`, `webhooks/quo`).
- **2.7 Inbox suggestion bar** — REUSE `pickTemplate`. File = the existing reply bar component (confirm exact name; agent saw `ThreadReplyBar.tsx` referenced).
- **2.8 Classification chip** — REUSE existing `suggested_classification` columns + inbox confirm flow (already partly built — the pill that clears `suggested_*`).
- **2.9 Suggested-response** — REUSE `email_threads.aiQuickReplies` (already exists, `lib/ai-quick-replies.ts`). Don't rebuild.
- **2.10 Cadence warning in composer** — pairs with 1.9 (the UI half). REUSE `checkCadenceFloors`.
- **2.11 Quick-action chips** — EXTEND inbox actions; sets `classification`/`cadence_state`. Depends 1.12.
- **2.12–2.14 Cold-outreach table** — EXTEND `cold-outreach-table.tsx`; uses `cadence_state` + `venue_campaign_touch_log`. 2.14 handoff resets `cold_exhausted_ready_for_handoff`→`cold_pending_touch_1`.
- **2.15 Effective priority** — NEW pure lib + test. Eventbrite ticket count source exists (`eventbrite-sync`). Non-blocking.

### Phase 3 — Lifecycle + relationship flags
- **3.1 `lib/lifecycle-scheduler.ts`** — **NEW, but MUST integrate with the existing `confirmation-cascade.ts`.** Today confirmation creates 4 *tasks*; this phase adds *scheduled emails* (T9–T17). **Connection risk:** two systems reacting to the same confirm transition. Spec must say whether lifecycle-scheduler replaces, supplements, or is gated against the task cascade — otherwise the operator gets duplicate "2-week confirm" task + email. Recommend: lifecycle-scheduler owns the *emails*, confirmation-cascade keeps the *call/checkbox tasks*, and they share the `venue_events` timestamp columns to avoid double-fire.
- **3.2 Schedule on confirm** — EXTEND **`app/(admin)/events/_venue-event-actions.ts`** (the real confirm action), inside/after the same transaction as `generateConfirmationCascade`.
- **3.3 Multi-night bundling** — NEW merge field `{{venue_nights_summary}}` (add to the 44-field builder).
- **3.4 Late-addition** — EXTEND scheduler (`daysToEvent<14`).
- **3.5 Slot-change reply** — EXTEND classifier; depends on Phase 4 cancellation. Needs a new intent value or flag.
- **3.6/3.7 H0a/H0b host briefs** — NEW host-email triggers. Host fields now exist (`external_hosts` host-brief cols, migration 0096). H0a trigger = the create-external-host action (confirm path); H0b = a new cron. **Host-brief preview context still missing** (the merge builder needs a host+event context).
- **3.8 venue_domain_relationships** — NEW table. FIX migration → **0101**. Spec says check `venue_domain_aliases` (0084) first — that table is for **domain matching**, a different concern; create the new table. FK `staff_members(id)` = `users` (alias).
- **3.9–3.12 flag detection / block / decay / post-event prompt** — EXTEND classifier + `checkCadenceFloors` + a cron + worklist. All depend on 3.8.
- **3.13 V2-call floor-staff** — EXTEND `venue_events` (FIX migration → **0102**) + `<CallsSection />`. Note `floor_staff_call_completed_at` already exists on venue_events — reconcile the new `floor_staff_*` columns with it (don't duplicate).

### Phase 4 — Cancellation (greenfield, well-scaffolded by enums)
- **4.1 `lib/cancellation-flow.ts`** — NEW. `triggerVenueCancellation(args)`. Enum support exists (`cancelled_by_them` cadence_state, `cancelled` venue_event status, `cancellation_reason_phrase` merge field, T16 template). Transaction-wrapped.
- **4.2 auto-detect** — EXTEND classifier (depends 1.13).
- **4.3 stop downstream** — archives unsent `email_drafts` for venue×campaign.
- **4.4 T16 draft** — REUSE `cancellation_reason_phrase` (4 variants — currently blank in the builder; wire the variants).
- **4.5 multi-staff fan-out** — **verify `notifications` table exists** (it does — `db/schema/notifications.ts`); build on it. SMS deferred to Phase 5 ("log would-have-sent").
- **4.6 ack tracking** — EXTEND `notifications` (+`acknowledged_at/_by`). FIX migration → **0103** (spec leaves it unnumbered).
- **4.7 cancelled-venues view** — NEW page.
- **4.8 comeback** — EXTEND classifier + re-confirm via `scheduleLifecycle`.
- **4.9 misrouted positive reply** — EXTEND the inbound poller (`lib/gmail-poll-worker.ts`); uses `venue_campaign_touch_log` for last alias. **Autonomous stop point.**

### Phase 5 — SMS/Twilio + Smart Map/Eventbrite (greenfield + procurement)
- All greenfield; **Twilio not in package.json**. `messageKind` enum anticipates sms/viber/line but no send code. 5.1 is procurement. Detailed specs deferred to Phase 5 kickoff. **Hard stop (external procurement).**

---

## Part 4 — Recommended spec edits (for approval)

1. **Renumber all migrations** per C1 (start at 0097, +2 shift). 
2. **Global find/replace** `staff_outreach_emails` → `connected_accounts` in DDL (C2).
3. **Delete the OPENAI/pgvector pre-flight**; state Anthropic-only + FTS (C3).
4. **Pin real file paths** in each phase (C4): classifier=`lib/ai-classify.ts`, confirm=`events/_venue-event-actions.ts`, send=`compose-send-impl.ts`, cadence cron path.
5. **Phase 1.9–1.11: add an explicit cutover note** — the send pipeline + `inbox/_actions` must switch from writing `follow_up_stage` to `cadence_state` at cutover; until then run both or gate. This is the riskiest seam — sequence it as one coordinated change, not three independent phases.
6. **Phase 3.1: add an integration clause** with `confirmation-cascade.ts` — lifecycle-scheduler owns *emails*, the cascade keeps *tasks*; share `venue_events` timestamps; no double-fire.
7. **Phase 3.13: reconcile** new `floor_staff_*` columns with the existing `venue_events.floor_staff_call_completed_at`.
8. **Phase 2.9: reuse `aiQuickReplies`**, don't rebuild.
9. **Resolve named-person IDs (Bryle/Brandon)** via config before Phase 3 — needs operator input (C5).
10. **Decide Phase 6** scope or set 4.9 as the autonomous stop (C6).
11. **Add `{{venue_nights_summary}}`** (3.3) and the 4 `cancellation_reason_phrase` variants (4.4) to the 44-field merge builder when those phases land.

---

## Open questions for the operator
1. **Cadence cutover (1.9–1.11):** OK to run the new `cadence-engine` as a *new* cron alongside the OLD `follow-up-cadence` during backfill, then retire the old one — and to update the send pipeline + inbox actions to write `cadence_state` at cutover?
2. **Lifecycle vs. tasks (3.1):** confirm lifecycle-scheduler should own the post-confirm *emails* while `confirmation-cascade` keeps the *call/checkbox tasks* (no duplication)?
3. **Named people:** who are Bryle and Brandon (user IDs / roles), or should the default lifecycle owner be `city_campaign.lead_staff_id`?
4. **Phase 6:** flesh it out now, or stop autonomous work at 4.9?

# Reference-doc gaps -- rules not yet (fully) implemented

> Known gaps between the canonical reference doc
> (`lib/reference-docs/halloween-2026-intl-engine-reference.md`) and the
> shipped engine. The canonical doc states the intended business rule; this
> file tracks where the implementation does not yet match, plus open
> placeholders and "later refinement" items.
>
> For the parts that ARE implemented (section -> code), see
> `docs/IMPLEMENTATION_STATUS.md`. For roadmap items, see `ROADMAP.md`.
>
> Last updated: 2026-06.

---

## Lifecycle scheduling (canonical 7.1, 7.3, 7.4)

- **Per-night day-of (T15) split pending.** A venue confirmed for more than one
  night currently anchors its lifecycle to the earliest confirmed night. A
  per-night T15 ("we're live tonight") split is a later refinement; today the
  schedule does not fan out a distinct day-of touch per night.
- **Late-addition T9-near collapse (3.4) pending.** The collapse of touches for
  venues added very late is a later refinement, not yet wired.
- **T9-near / T11 bundling.** Inside the 3-week window the T9-near variant is
  meant to bundle the T11 info inline. Confirm the seeded T9-near copy actually
  carries the full T11 payload for late confirms before relying on it; the
  T9/T9-near/T11 copy was seeded to the live DB only on 2026-06-05 and
  `scripts/seed-halloween-2026-templates.ts` has not been updated to match.
- **T10 graphics readiness gate.** T10 is gated by graphics readiness rather
  than time. Confirm the "block T10 until the graphic is uploaded" gate (the
  graphics tracker's "ready to send" state, canonical 7.3) is enforced at send
  time, not just surfaced.
- **T11 info-sheet readiness gate.** Canonical 7.4 requires "block T11 send if
  sheets aren't ready" and auto-attach of the correct sheet(s) per slot type.
  Confirm this gate is enforced (the info-sheet generation tracker is a Phase 2
  build item -- see ROADMAP.md).

## Relationship gate at scheduled auto-send (canonical 3.3, 7.15.2)

- The **interactive composer** hard-blocks sends to a `bad` venue x
  outreach-brand pair. The **scheduled-send runner** re-checks the relationship
  only for the relationship-gated T17 (per 7.15.2). The other auto-sent
  lifecycle templates (T13-T17) do not yet re-check the relationship flag at
  dispatch time -- a follow-up. Until then, a venue flagged `bad` after a
  lifecycle draft was scheduled could still receive a non-T17 auto-send.

## Cancellation flow (canonical 7.16)

Implemented: cancel + stop-downstream + T16 draft + city-lead notify
(`lib/cancellation-flow.ts`). Not yet built:

- Acknowledgment tracking + auto-escalation if owners do not respond in window
  (7.16, item 4.6).
- Comeback / re-engagement flow for cancelled venues (4.8).
- Misrouted-positive-reply routing (4.9).
- Dedicated cancelled-venues view / "Cancelled By Venue" table (4.7).

## Ticketing integration (canonical 5.3, 7.1 week-out bundle)

- Eventbrite links and an exact live headcount in the week-out (T13W) bundle
  await the Eventbrite pull integration (Phase 5.9). Until then
  `events.ticket_sales_count` is 0 and the turnout figure is the Section 5.3
  range, not a live count. The effective-priority pivot (1.6) likewise stays
  inactive with no sales data, which is safe but means the pivot is untested
  against real sales until ticketing is live.

## SMS (canonical 7.14.2, host cadence)

- All SMS (host H1-H5 cadence, lineup-change, payment-confirmation, post-event
  distribution-count) is **inert** until Twilio + A2P 10DLC credentials are
  configured. Sends are logged with status `unconfigured` and nothing leaves
  the system. The Twilio infrastructure + A2P 10DLC registration is a Phase 2
  build item (see ROADMAP.md).

## Operator action required

- **Cron entries.** The relationship-decay endpoint
  (`POST /api/cron/relationship-decay`) and the cancellation-review cron require
  the operator to add the crontab entries; they do not self-register.
- **Seed-script drift.** Operator-approved T9/T9-near/T11 copy lives in the live
  DB only; `scripts/seed-halloween-2026-templates.ts` has not been updated. The
  seed script is not run on deploy, so the live rows persist, but a fresh
  environment seeded from the script would be missing this copy.

## Open placeholders in the canonical doc

- **3.1 per-domain alias mapping** is a placeholder pending finalization (the
  doc marks the example mapping as illustrative; actual mapping pending).
- **Future analytics / dashboard** (one of the four connected systems, canonical
  0.8) is not built.

## Compliance posture (canonical 0.5, 4.3)

The canonical doc states the operating reality: outreach is human-operated,
one-to-one, and reviewed before sending. It deliberately no longer asserts
specific regulatory conclusions (e.g. that this falls outside GDPR / CAN-SPAM /
CASL automated-marketing rules) as fact. That posture should be confirmed with
legal, especially before any move toward autonomous send-without-review,
particularly for UK / EU and Canadian venues. See `docs/COMPLIANCE_NOTES.md`
for the fuller discussion that was moved out of the canonical doc.

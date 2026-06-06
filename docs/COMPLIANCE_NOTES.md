# Compliance notes (non-legal)

> Moved out of the canonical reference doc (former sections 0.5 and 4.3) so the
> canonical doc states only the operating principle, not specific regulatory
> conclusions.
>
> This file is internal context, NOT legal advice. The compliance posture
> should be confirmed with legal. See `docs/REFERENCE_DOC_GAPS.md`.

---

## Operating reality

Halloween 2026 outreach is **human-operated, one-to-one, and reviewed before
sending**. The engine drafts; a human reviews and sends every message. There is
no bulk automated marketing send path, and outreach is venue-side only (we never
email ticket buyers from the engine -- see canonical 0.6).

Because of this posture, the team's working assumption has been that outreach
does not need country-specific opt-out blocks or other automated-marketing
boilerplate in the message body. That is an operating assumption, not a legal
determination.

## Why this is flagged, not asserted

Earlier drafts of the reference doc asserted as fact that one-to-one
human-operated email "falls outside" GDPR / CAN-SPAM / CASL automated-marketing
rules and that "no mandatory opt-out blocks are needed." Those are
regulation-specific conclusions that should come from legal, not from an
operations reference doc. The canonical doc now states only the operating
reality and points here.

## When the posture changes

If the engine ever shifts to **fully autonomous send-without-human-review**, the
compliance picture changes materially -- particularly for UK / EU and Canadian
venues. At that point:

- The one-to-one / human-reviewed justification no longer holds for the
  autonomous path.
- Opt-out / unsubscribe handling, consent records, and sender-identification
  requirements should be reviewed with legal before enabling any autonomous
  send.
- The most likely first autonomous candidate (cold cadence touches 2 and 3,
  fully templated, no custom content -- see canonical 10.4) is still a year-2+
  decision and should clear legal review first.

## Action

Confirm the outreach compliance posture with legal before scaling send volume
or enabling any autonomous send. Track the open item in
`docs/REFERENCE_DOC_GAPS.md`.

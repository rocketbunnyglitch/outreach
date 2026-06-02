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

## Notes for the tester

- "Local day" for the cap is the INBOX OWNER's timezone, default America/Toronto.
- "Confirmed" everywhere in the matrix/pills = status in
  (confirmed, scheduled, contract_signed).
- Pure parsing/label logic (email header parsing, day-part labels, country
  abbrev) is already covered by automated unit tests (`npm test`); this matrix
  is only for the live-integration paths those tests cannot reach.

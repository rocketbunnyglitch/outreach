# Halloween 2026 International Outreach — Engine Reference

> **Canonical reference doc.** This document is the source of truth the engine's AI consults when helping operators write outreach for PERSE's Halloween 2026 international campaign. Templates in the engine implement these rules; this doc explains the WHY and provides the canonical operational reasoning.
>
> Built through structured Q&A with the operator (rocketbunnyglitch). All 11 sections (0 through 10) and the Phase 2 build item list are locked unless explicitly marked otherwise. Section 3.1 (per-domain alias mapping) has a placeholder pending finalization next week.
>
> When the engine's AI is asked to help draft outreach, schedule sends, interpret venue replies, or surface operator alerts, it should consult this doc as ground truth.
>
> Owner: operator (rocketbunnyglitch).
> Status: ready for engine implementation reference.

---

## Table of contents

0. [Foundational principles](#0-foundational-principles)
   - 0.1 Low buy-in is non-negotiable
   - 0.2 Sales reality — 70-80% of tickets sell the day before
   - 0.3 The lineup is fluid until ~2 weeks out
   - 0.4 Human-in-the-loop
   - 0.5 No country-specific compliance language
   - 0.6 Scope is VENUE-side only
   - 0.7 The engine is the source of truth for venue lineups
   - 0.8 Adjacent systems are out of scope for this doc
1. [Priorities](#1-priorities-locked)
2. [Hosts](#2-hosts-locked)
3. [Per-domain config](#3-per-domain-config-in-progress)
4. [Countries and conventions](#4-countries-and-conventions-locked)
5. [Guest-count math](#5-guest-count-math-locked)
6. [Cadence and anti-spam](#6-cadence-and-anti-spam-locked)
7. [Booking workflow / post-confirm ops](#7-booking-workflow--post-confirm-ops-in-progress)
8. [Operator vs. engine boundary](#8-operator-vs-engine-boundary-locked)
9. [Edge cases](#9-edge-cases-locked)
10. [Future considerations](#10-future-considerations-locked)
11. [Phase 2 engine build items](#11-phase-2-engine-build-items)
12. [Glossary](#12-glossary)

---

## 0. Foundational principles

These principles are the lens for every other decision in the doc. Any AI consulting this doc should check proposals against these before recommending a workflow, template, or engine behavior.

### 0.1 Low buy-in is non-negotiable [LOCKED]

The whole premise of PERSE's outreach model is that the buy-in for a venue should be **extremely low**.

**What we ask of venues:**
- **Wristband venue:** accept the wristband role and host the check-in
- **Any other venue (middle / final / day-party-participating):** let crawlers in for free
- **At most (optional):** offer drink specials or a featured drink

**What we DO NOT ask of venues:**
- Sign contracts
- Send us their logo or marketing assets
- Coordinate their own marketing
- Pay anything
- Block off space / reserve sections
- Provide line-bypass for guests
- Grant exclusivity
- Deposits

Every additional thing we ask is one more reason for the venue to say no, hesitate, or stop replying. The model only works because we do the work and venues just need to say yes.

**If a proposed feature would require asking the venue for something new, the bar is very high — it has to be worth the dropped conversion rate.** Exception: the drink-special ask in T9 (we frame it as free promotion for the venue, so the value flows TO them, not from them — flipping the buy-in calculus).

### 0.2 Sales reality — 70-80% of tickets sell the day before [LOCKED]

This is the single most important fact about how PERSE's sales work and it should override every intuition you have from other event-marketing playbooks.

**Implications:**
- Low sales 4 weeks out are NOT predictive of weak turnout
- Don't cancel for low sales until **event week** (Tuesday-Thursday)
- Don't promise huge numbers based on early sales velocity
- Don't surface "we're at X tickets" updates to venues 4+ weeks out — too low to be reassuring, too far out to be predictive

Every cancellation rule, turnout-quote rule, and sales-update rule below derives from this fact.

### 0.3 The lineup is fluid until ~2 weeks out [LOCKED]

The full venue lineup for a given crawl × night isn't locked until shortly before the event. Templates and engine workflows that reference "the lineup" must either:
- Wait until lineup-lock (~2 weeks out), or
- Work without referencing it

This kills certain otherwise-appealing touchpoints (e.g. a "lineup reveal" email at 3 weeks out can't be reliable).

### 0.4 Human-in-the-loop [LOCKED]

The engine **drafts**. Humans **review and send**. No outreach email auto-fires without operator approval.

Exception: nothing currently. If autonomous sending is ever introduced, GDPR/CASL/CAN-SPAM compliance becomes relevant — see Section 4.

### 0.5 No country-specific compliance language needed [LOCKED]

Because emails are human-operated and one-to-one (not bulk automated marketing), they fall outside automated-marketing regulations in GDPR/CAN-SPAM/CASL. No mandatory opt-out blocks needed.

Flag for future: if the engine ever shifts to fully autonomous send-without-human-approval, this changes — particularly for UK/EU and Canadian venues.

### 0.6 Scope is VENUE-side only [LOCKED]

The engine handles **venue outreach + venue post-confirm operations**. It does NOT handle:

- Ticket sales (Eventbrite or other platforms)
- Ticket-holder communications
- Refunds (Eventbrite API doesn't support automated refunds anyway)
- Customer support for ticket buyers
- Day-of attendee logistics (check-in apps for guests, etc.)

If a proposed feature would have the engine email or transact with **ticket holders**, it's out of scope. Build it elsewhere.

A future "refund flag" tracker for operators to manage refund requests is acknowledged but explicitly NOT in scope for this doc or the Halloween 2026 engine work.

### 0.7 The engine is the source of truth for venue lineups [LOCKED]

The outreach engine is the canonical source of truth for **"who is confirmed for which crawl × night × slot."** Other systems (Smart Map, Eventbrite, host SMS, future analytics) consume this data — they don't have their own copy.

When the engine's lineup state changes (venue confirmed / swapped / cancelled), downstream systems update accordingly via:
- Stable read-API exposing current lineup state
- Pub/sub change events for real-time consumers
- Push-out integrations for systems that need data injected (Eventbrite event description, host briefings)

This principle is what enables real-time crawl-night updates. If a middle venue drops at 7 PM Halloween night and an operator swaps it in the engine, the Smart Map reflects the change immediately, opted-in attendees get an SMS via the Smart Map's broadcast system, and the working external host gets an SMS update via the engine's Twilio integration.

### 0.8 Adjacent systems are out of scope for this doc [LOCKED]

PERSE is building three interconnected systems. The outreach engine is one of them. The other two have their own design specs.

| System | Domain | In this doc? |
|---|---|---|
| **Outreach engine** | Venue acquisition, post-confirm ops, host management, host briefings, host SMS, venue SMS | **YES — this doc** |
| **Smart Map** | Attendee-facing crawl map, attendee opt-in SMS signup, scheduled attendee broadcasts during crawl | NO — separate spec |
| **Eventbrite integration** | Push lineup → Eventbrite event description; pull ticket sales counts back to engine | NO — separate spec |

The engine integrates with these via stable APIs / event feeds, but their internal design specs live separately because their concerns are different (consumer UX vs. venue ops vs. ticketing platform).

**Current state of adjacent systems (for context):**
- Smart Map exists in a version that reads from Google Sheets; will be revised to read from the engine
- Eventbrite push exists in a version that reads from a web form; will be revised to push from the engine
- Attendee SMS broadcast system is part of the Smart Map spec, not the engine

**The engine's responsibility is to publish lineup state reliably.** It doesn't dictate how Smart Map renders the data or how Eventbrite formats the event description.

### 0.7 The engine is the source of truth for venue lineups [LOCKED]

The outreach engine is the canonical source of truth for "who is confirmed for which crawl × night × slot." Other systems (Smart Map, Eventbrite, external host SMS, future analytics) **consume** this data — they don't maintain their own copy. When the engine's lineup state changes (venue confirmed / swapped / cancelled), downstream systems update accordingly.

This principle is what enables real-time crawl-night updates. If the middle venue drops at 7 PM Halloween night and an operator swaps it in the engine, the Smart Map reflects the change immediately, the Eventbrite event description updates, opted-in attendees get a text (via Smart Map's broadcast system), and the external host on the ground gets an SMS update.

The engine must expose lineup data as:
- A stable read API (for downstream systems to pull current state)
- Pub/sub change events (for downstream systems to subscribe and react in real-time)

Both shapes are needed because Eventbrite is push-on-change while Smart Map needs both pull-on-load AND real-time updates.

### 0.8 Adjacent systems are out of scope for this doc [LOCKED]

The outreach engine is one of four connected systems. The others have their own design specs:

| System | Domain | In this doc? | Current state |
|---|---|---|---|
| **Outreach engine** | Venue acquisition, post-confirm ops, host management | YES — this doc | Active build (Halloween 2026) |
| **Smart Map** | Attendee-facing crawl map, opt-in SMS signup, scheduled broadcasts during the crawl | NO — separate spec | Exists (reads from Google Sheets); needs revision to read from engine |
| **Eventbrite integration** | Push lineup → Eventbrite event description | NO — separate spec | Exists (reads from web form); needs revision to read from engine |
| **Future analytics / dashboard** | Reporting, conversion funnels, campaign performance | NO — future | Not built |

The engine integrates with these systems via stable APIs / event feeds, but their design specs live separately because their concerns are different (consumer UX vs. venue ops vs. ticketing platform vs. reporting).

**The engine's responsibilities at these boundaries:**

- Publish lineup state in a machine-readable format
- Emit events on lineup changes
- Provide a "push to Eventbrite" trigger (operator-fired or auto-fired) that calls Eventbrite's API
- Provide a "push to external host SMS" trigger (auto-fired on host briefing or lineup change) that calls Twilio

---

## 1. Priorities [LOCKED]

### 1.1 What sets a city's priority

Priority is set by **historical ticket sales**:

- **Primary signal:** same campaign from the prior year (Halloween 2025 → drives Halloween 2026 priority)
- **Secondary signal:** other recent campaigns in that city (NYE, St. Patrick's) — supporting context only, since some cities perform well for one campaign and poorly for another
- Like-for-like is the strongest signal

The full priority list lives in the engine — every city has a priority number assigned for Halloween 2026.

### 1.2 Priority is fixed but can be bumped up [LOCKED]

Priority is **fixed at the start** of the campaign but **can be bumped UP** mid-campaign if a city crosses **50 tickets sold**.

The bump matters because it unlocks:
- External host hiring (operationally expensive — only worth it for high-volume cities)
- Prio 1-3 ops flow (different host model, more touchpoints)

Below 50 tickets: stays at assigned priority.
Above 50 tickets: operator can reclassify upward.

### 1.3 Priority drives crawl count per night [LOCKED]

| Priority | Crawls per night |
|---|---|
| 1-4 | Multiple crawls per night |
| 5-6 | Single crawl per night (sales unproven, no point scheduling more) |

### 1.4 Priority does NOT change venues-per-crawl [LOCKED]

Every crawl has:
- **1 wristband venue**
- Some number of middle venues
- Some number of final venues

Higher-priority cities target **more final venues** specifically (because finals are where the full crowd congregates and turnout peaks). But the wristband count is always 1 per crawl.

### 1.5 The headline math by priority [LOCKED]

| Priority | Internal expectation | Crawls/night | Host model | Notes |
|---|---|---|---|---|
| **1** | ~300 guests | Multiple | External host | Highest-touch ops |
| **2** | 200-300 | Multiple | External host | |
| **3** | ~150 | Multiple | External host | |
| **4** | 50-100 | Multiple | Internal staff host (venue's own) | |
| **5-6** | ~50 | Single | Internal staff host (venue's own) | Sales unproven |

See Section 5 for the full guest-count math and Section 2 for host details.

### 1.6 Sales-driven scheduling pivot at 2-3 weeks out [LOCKED]

**The 2-3 week window flips the priority logic.** Static priority (Section 1.1) is the right scheduler EARLY in the campaign — when there's no sales data yet, you have to bet on history. But once tickets start moving (roughly 2-3 weeks out from event), the engine + operators should **prioritize cities based on actual sales velocity, not assigned priority.**

#### The rule

At any point inside the **2-3 week pre-event window**, if a city with a LOWER priority has tickets selling AND a city with a HIGHER priority has zero or near-zero sales, the engine should **schedule the lower-priority city ahead of the higher-priority city.**

#### Why this matters

The static priority is a *prior* — your best guess based on last year's data. Sales-in-hand is *evidence* — actual market signal for this campaign in this city right now. Evidence beats prior.

Concrete example:
- Toronto is Prio 1 (~300 expected) but has 0 tickets sold by 14 days out
- Detroit is Prio 4 (50-100 expected) but has 35 tickets sold by 14 days out

Without the pivot, operators would keep working Toronto (because it's "supposed to" be huge). With the pivot, the engine flags Detroit as the active priority for the remaining ops window — Detroit is converting, Toronto is hoping. Working Detroit harder is the right move; Toronto can run with whatever lineup it has.

#### Engine behavior

At 21 days before event date (configurable per campaign):
- Engine starts computing an **"effective priority"** per city that combines static priority with current ticket sales:
  - Base: static priority
  - Sales boost: cities with > 20 tickets sold get bumped up 1-2 tiers of effective priority
  - Sales drag: cities with 0 tickets sold + < 21 days to event get bumped down 1-2 tiers
- The operator's worklist + cold outreach views sort by **effective priority**, not static priority
- Static priority is still visible (so the operator understands the baseline), but the schedule + ops focus follow effective priority

#### When the pivot does NOT apply

- Earlier than 3 weeks out: not enough sales data yet to override priors; static priority drives
- Cities still in the cold-outreach phase with no confirmed venues: static priority drives (you can't ops a city that has no venues yet)
- Cities with so many confirmed venues that they're "done" operationally: not affected by the pivot

#### Operator-facing visibility

The effective priority should be visible in the engine UI as a small badge next to static priority:

```
Toronto · Prio 1 (effective: 3) — 0 tickets sold, 14 days out, deprioritized
Detroit · Prio 4 (effective: 2) — 35 tickets sold, converting well
```

This way operators understand WHY a city is being deprioritized + can override if they have context the engine doesn't.

**Phase 2 engine build item:** Effective-priority computation. New helper `lib/effective-priority.ts` that takes static priority + current ticket sales + days-to-event, returns an adjusted priority. Wire into worklist sorting + cold-outreach table sorting from day -21 of each event.

---

## 2. Hosts [LOCKED]

### 2.1 Host types

The engine tracks three modes per wristband venue. The wristband venue is explicitly set to one of these in the engine:

| Mode | Description | Default tier |
|---|---|---|
| **External host** | PERSE hires a host from job sites (Indeed etc.) and dispatches them to the wristband venue for the night | Prio 1-3 default |
| **Internal staff host** | Venue's own staff member hands out wristbands; PERSE pays the venue to cover that staff member's shift | Prio 4-6 default; Prio 1-3 fallback when external hire fails |
| **No host (table-only)** | Final fallback when neither external nor internal host works. Wristband venue sets up a self-serve table with the shipped wristbands + a poster with the crawl-map QR code. Guests grab a wristband off the table and scan the QR for instructions. | Last-resort fallback |

The shipped wristband package goes to all wristband venues regardless of host mode. The host poster (table-only fallback) is a **printable PDF the venue prints themselves** — not shipped.

### 2.2 What a host does on the night

External and internal hosts both:
- Scan tickets
- Hand out wristbands
- Greet guests
- Direct guests to scan the crawl-map QR code
- Explain the crawl map and answer questions

**New for 2026 (external hosts only):** Visit each participating venue in the lineup ~1 hour before crawl start to introduce themselves and confirm the venue knows the crawl is happening tonight. This is a hedge against the "venue staff didn't know about the crawl" problem (also addressed by the staff info sheet — see Section 7).

### 2.3 Host confirmation timing

| Timing | Status |
|---|---|
| 4 weeks out | Ideal — operator should already be working on host search |
| 3 weeks out | Target — both external hosts (primary + backup) ideally confirmed |
| 2 weeks out | Latest acceptable — operator actively re-checking in with hosts |
| 1 week out | Too late — high flake risk |
| 3-4 days out | Last-resort fallback only |

Hosts ARE flaky. Operator must keep re-confirming the booking between hiring and event night. See Section 7.13 for full host payment + re-confirmation flow.

### 2.4 Host roster

No fixed per-city host roster. Hosts are assigned ad-hoc close to the event. The engine maintains a host tracker that accumulates known hosts over time as the database grows organically.

---

## 3. Per-domain config [IN PROGRESS]

### 3.1 Domain → company/alias mapping

**Full mapping TBD — operator will finalize next week.**

The shape:
- Every outreach domain has 1-3 aliases
- Each alias is owned by a different staff member
- Same staff member NEVER signs as their real name on outreach — always the per-domain alias

Example structure (illustrative — actual mapping pending):

```
Staff: Bryle
  contacteventsperse.com → kevin@contacteventsperse.com     (alias: Kevin)
  crawlconnector.com     → brian@crawlconnector.com          (alias: Brian)
  frightcrawlco.com      → julian@frightcrawlco.com          (alias: Julian)

Staff: JC
  contacteventsperse.com → ian@contacteventsperse.com        (alias: Ian)
  ...

Staff: Yasu, Jella → similar structure
```

Multiple aliases share a single domain (e.g. `contacteventsperse.com` hosts Kevin, Ian, Jeff — three aliases, three staff members, one shared domain reputation).

### 3.2 Outreach domains

| Domain | Type | Notes |
|---|---|---|
| `events-perse.com` | Internal / non-sending | Correspondence only, no outreach sends |
| `contacteventsperse.com` | Warm | Outreach + replies handled here |
| `contactperse.com` | Warm | Outreach + replies handled here |
| `nighthopglobal.com` | Warm | Outreach + replies handled here |
| `crawlconnector.com` | Cold | Outreach + replies handled here |
| `frightcrawlco.com` | Cold | Outreach + replies handled here |

Rules:
- Replies go to each outreach domain's own inbox — no central reply-to
- Cold domains warm up 2-3 weeks before the push or they land in spam
- If unwarmed on a tight deadline, lean on warm domains

### 3.3 Per-venue × per-domain relationship history [LOCKED]

Each venue's detail page tracks **relationship status per outreach domain**. Example:

```
Venue: Bar Opium (Toronto)
Relationships:
  contacteventsperse.com  → good
  crawlconnector.com      → bad
  nighthopglobal.com      → no history
  frightcrawlco.com       → no history
```

**How status is set:**
- **Auto-detect** from inbound email signals — engine reads venue replies and flags negatives ("it was a mess last night," "don't email us again," "remove from your list") as bad
- **Manual operator flag** — staff who worked the event in person can flag venues they know are burned but didn't email about it

Engine should show flag source ("set by Bryle on Oct 15" vs "auto-detected from inbound on Oct 16") so future operators have context.

**Behavior on "bad" flag:** **HARD BLOCK.** Engine refuses to send from that domain to that venue.

**Decay:** Bad flag auto-clears after **1 year** from set date. After auto-clear, relationship goes to "no history" (not "good") so next outreach is fresh-start.

### 3.4 No country restrictions on domains [LOCKED]

Any outreach domain can email any country. No country restrictions on which domains target which markets.

### 3.5 Cross-domain follow-up is allowed [LOCKED]

If Bryle's pitch as "Kevin" on `contacteventsperse.com` is ignored, Bryle can follow up as "Brian" on `crawlconnector.com`. Different aliases are a fresh chance — the venue may have ignored the first one for domain/alias-specific reasons (filtered to spam, didn't like the name, bad past rep).

Subject to the 7-day cross-domain anti-spam rule (see Section 6).

---

## 4. Countries and conventions [LOCKED]

### 4.1 Markets for Halloween 2026

- Canada
- USA
- New Zealand
- Australia
- England (UK)
- Other countries (engine has full city list with country tags — refer to engine for canonical mapping)

### 4.2 Per-country email conventions

| Convention | Rule |
|---|---|
| **Spelling** | Match venue's country. US spelling ("labor", "color") for US venues. UK/Commonwealth spelling ("labour", "colour") for CA / UK / AU / NZ venues. |
| **Time format** | 12-hour with AM/PM everywhere. ("7:30 PM to 2:00 AM"). UK readers understand 12-hour fine. |
| **Date format** | Written-out month-day everywhere. ("Thursday, October 29th"). NEVER numeric dates ("10/29" is ambiguous between US and rest-of-world). |
| **Currency** | Match venue's local currency when surfaced. Currency rarely appears in outreach (venues keep 100% bar; we don't quote prices). |
| **Greeting/closing** | "Hey", "Cheers", "Thanks" as written in templates. Universal across all markets. |

### 4.3 Compliance

No country-specific legal/compliance language needed in outreach. Emails are human-operated 1-to-1, not bulk automated — fall outside GDPR/CAN-SPAM/CASL automated-marketing rules.

**Flag for future:** If the engine ever shifts to fully autonomous AI-sends-without-operator-approval, this changes — particularly for UK/EU and Canadian venues.

### 4.4 Halloween night scheduling [LOCKED]

Halloween is always pitched the same nights in every country:
- **Thursday Oct 29 (night)**
- **Friday Oct 30 (night)**
- **Saturday Oct 31 (night)**
- **Saturday Oct 31 (day party, afternoon)**

No country-specific night logic. Halloween night is Halloween night.

---

## 5. Guest-count math [LOCKED]

### 5.1 Universal framing rule

Every time the engine quotes a turnout number to a venue, it pairs the number with a **wave-size qualifier**:

> "**in waves or small groups of 5 to 10 people at a time, not all at once — coming through across your time slot through the night**"

Adapt the tail clause to the slot context:
- Wristband: "across your pickup window"
- Middle: "across your slot"
- Final: "through the night"
- Day party: "through the afternoon"

**Why this is non-negotiable:** A bar's #1 fear is being overwhelmed. The crawl's actual operation is wave-based (5-10 people per wave distributed across hours). The framing must match reality or bars say no to protect themselves.

### 5.2 Initial pitch numbers (by priority × slot)

| Priority | Internal | Tell wristband | Tell middle | Tell final |
|---|---|---|---|---|
| **1** | 300 | "200-300 through your pickup window" | "100-200 through your slot" | "100-200 — ask their capacity first; offer split with another final if limited" |
| **2** | 200-300 | "about 200" | "about 100" | "about 200" |
| **3** | ~150 | "about 100" | "50-100" | "about 100" |
| **4** | 50-100 | "50-80" or "50-100" | "25-50" | "50-80" |
| **5-6** | ~50 | "around 50" | "around 20 split across stops, steady flow — total ~50" | "30-50, depending" |

### 5.3 Sales-update math (during October, post-confirm)

What you tell venues when asked "how's it going?"

| Tickets sold | Tell middle / final venue | Tell wristband venue |
|---|---|---|
| **Under 20** | "10-20" + honest "sales are slow, we'll keep you updated" | Same |
| **20-50** | "10-20" | Same |
| **50-100** | "30-50" | Same |
| **100-150** | "around 80" | Same |
| **150+** | **70% of actual sold**, rounded to tidy number, prefixed with "around" or "-ish" | Same 70% rule |

**Why wristband uses the same 70% rule:** Wristband venue sees less than full crowd anyway. People no-show; people arrive late and bypass wristband. Of 100 tickets sold, maybe 70 make it out, and of those 70, only 30-50 hit the wristband early. The 70%-of-sold deflation matches reality.

### 5.4 Rounding rule

- **Always round DOWN** at boundaries (50 sold → still "10-20", not "30-50")
- **Always prefer a range** over a single number ("70-90" beats "80")
- **If giving a single number**, prefix with "around" or suffix with "-ish" — never a precise "138 people", always "around 140-ish"

### 5.5 Capacity edge case — Prio 1 finals

**Default behavior:** Don't ask capacity upfront. Standard pitch goes with "100-200" quote.

**Reactive flow:** If venue raises capacity concern in reply ("we only fit 80"):
- **Split path:** "No worries, we can still have you as a final venue. We'll split the crawl finals between you and another venue."
- **Backup path:** "No worries, we'll keep you as an alternate / backup final."

**Late-stage manual bump:** 1-3 days before event, if a Prio 1 final's capacity is explicitly larger than the standard quote AND sales are pacing well, operator can manually bump the quoted number upward for that venue. Default conservative; bump only when data backs it up.

**Principle:** Default conservative, manual bump only when data justifies it. Never promise the bigger number upfront — promise it only when sales are actually showing up.

### 5.6 Slot-type × priority drives the number

The number quoted to a venue is determined by **slot type × priority**, NOT by the venue's individual capacity. A 500-capacity Prio 1 venue offered the final slot still gets quoted "100-200" by default.

Exception: the late-stage manual bump in 5.5.

---

## 6. Cadence and anti-spam [LOCKED]

### 6.1 Cold-outreach cadence (same alias, same domain)

Initial cold sequence for a single venue × campaign × alias:

| Touch | Days after previous | Total elapsed | Body posture |
|---|---|---|---|
| 1 (cold opener) | — | Day 0 | T1/T2 (big-open ask) or T8 (one-shot specific) |
| 2 (follow-up nudge) | +5 days | Day 5 | "Hey, just bumping this up — we're getting closer to scheduling" |
| 3 (final follow-up) | +7 days | Day 12 | "Last note before we finalize — wanted to give you one more chance to grab a slot" |
| Sequence complete | — | Day 12+ | Mark venue "ready for cross-domain handoff" |

Each touch is a **subject-line variant + body tweak** — not a literal copy-paste of the previous. Engine generates touch 2 and 3 with slightly different framing.

### 6.2 Cross-domain handoff

After a cold sequence exhausts (3 touches, no reply, marked "ready for handoff"):

- **7-day minimum** between last touch from domain A and first touch from domain B
- New domain runs its own 3-touch sequence
- **Cross-domain rule applies even within same domain when different alias** — venue sees both as same brand

### 6.3 Hard cap per campaign

**5-6 total touches per venue per campaign, across all domains/aliases/staff combined.** Beyond that, engine refuses to send and flags venue as "exhausted for this campaign."

### 6.4 Warm-thread cadence (post-engagement)

Once a venue replies, switch from cold cadence to warm cadence:

| Touch | Days after previous | Total elapsed |
|---|---|---|
| Engaged reply received | — | Day 0 |
| Slot detail / response sent | — | Day 0 (same-day) |
| Nudge 1 (no further reply) | +4 days | Day 4 |
| Nudge 2 (still no reply) | +5 days | Day 9 |
| Nudge 3 (still no reply) | +7 days | Day 16 |
| Stop — mark **stalled-warm** | — | Day 16+ |

Up to 4 in-thread touches total. Spread across ~2.5 weeks.

**Active replies override floors.** If venue replies at any point, operator/engine responds same-day. Floors only apply to operator-initiated outbound where venue has been silent.

### 6.5 Reply classification

The engine reads inbound replies and assigns venue × campaign state:

| State | Detection signal | Engine action |
|---|---|---|
| **Engaged (warm)** | "Send me slots" / "What times?" / "Tell me more" | Drop cold cadence; switch to warm cadence |
| **Soft no** | "Not this year" / "We're booked" / "Maybe next time" | Mark `declined-this-campaign`. Stops cadence this campaign. Auto-clears next campaign — freely re-pitchable for NYE/St. Patrick's/next Halloween. |
| **Hard no** | "Remove us" / "Stop emailing" / "Unsubscribe" / "Don't contact us again" | Mark `opt-out-permanent`. Hard block across ALL campaigns. Only cleared by explicit manager action, never auto. |
| **Stalled-warm** | Engaged once, then ghosted through 3 nudges + any call attempts | Rest venue for remainder of campaign. Auto-clears next campaign. **Don't cross-domain pitch in same campaign** (they already saw you, already engaged, already ghosted). |

### 6.6 Phone calls operate in parallel

Phone calls are not on a fixed cadence. Calls are driven by operator triage:

1. Operator gets assigned a city for the day
2. They prioritize call effort by:
   - City priority (high-prio = more call effort)
   - Active sales velocity (cities currently selling tickets get more time)
3. Inside the chosen city, they work venues that have been emailed but not replied

**Target on a call:** General manager OR events manager. Not bartenders or whoever picks up. If wrong person answers, ask for GM/events contact, get callback time or direct email/cell.

**No "min days between calls" rule.** Reaching venue managers is hard. Multiple call attempts in one day are fine if the right person wasn't there.

### 6.7 Call → email coordination

Call outcomes feed back into email cadence:

| Call outcome | Email cadence effect |
|---|---|
| "Send me an email with the slots" | Engine fires slot-detail email same day, ignores any pending floor |
| "Callback Tuesday at 3 PM" | Email cadence pauses until after callback |
| "Not interested" | Mark soft-no, stop email + call cadence |
| "Remove us" / "stop emailing" | Hard-no, permanent opt-out, all channels stop |
| No answer / voicemail / wrong person | No change — keep email cadence as scheduled |

**Calls don't count against the 7-day cross-domain anti-spam rule.** Different channel; venue doesn't feel email-spammed by a call.

### 6.8 Known gap: call logging is inconsistent

The engine currently has some call-logging integration (likely OpenPhone or similar), but tracking is partial. **Phase 2 build item:** full call logging to venue detail page — every call, outcome, operator, notes, timestamp.

---

## 7. Booking workflow / post-confirm ops [IN PROGRESS]

After a venue replies "yes" to outreach, this section governs the full lifecycle through event day and after.

### 7.1 Post-confirm 6-touch sequence (overview)

| Touch | Weeks out | Sender | Content |
|---|---|---|---|
| **T9** | Confirm time | Operator who confirmed | Confirmation + info-gathering asks (T9-far or T9-near variant) |
| **T10** | 4-5 wks out | Bryle | Social media graphic delivery |
| **T11** | 3 wks out | Bryle | Staff info sheet + (for wristband only) participant info sheet |
| **T13** | 2 wks out | Bryle (others can step in) | Wristband image + host contact (if applicable) + final logistics |
| **T14** | 1 wk out | Bryle (others can step in) | Day-before check-in |
| **T15** | Day-of morning | Any operator | "We're live tonight" / "We're live today" for day parties |

Total: 6 touches across 4-6 weeks. All low-burden — none ask the venue for new things after T9. Each delivers information FOR them.

**Killed touches (with reasons):**
- **T11-sales-update at 4 weeks out:** Killed because 70-80%-of-sales-day-before reality means low sales at 4 weeks don't predict outcome. Would lie or underwhelm.
- **T12-lineup-reveal at 3 weeks:** Killed because lineup isn't locked yet that far out.

### 7.2 T9 — Confirmation + info-gathering [LOCKED]

Engine generates T9 draft when operator marks venue confirmed. Operator reviews/edits/sends.

**Two variants based on time-to-event:**

| Variant | Use when | Content posture |
|---|---|---|
| **T9-far** | More than ~3 weeks before event | Standard, sparse, drip-feed mode |
| **T9-near** | Less than ~3 weeks before event | Loaded — everything they'll need in one go |

**Cutoff threshold: ~3 weeks** between variants. Engine picks automatically based on event date vs. today.

**Info-gathering asks bundled into T9:**

| Field | Always ask? | Notes |
|---|---|---|
| Shipping address | Wristband venues only, ALWAYS | For the wristband package |
| Day-of contact / who's working that night | Only if event is weeks out, not months | Asking 2 months out is premature. Suppress in T9-far; include in T9-near. |
| Venue capacity | Always | Useful for sizing expectations + Prio 1 final split-edge case |
| Drink specials or featured drink | Always | Frame: "free promotion on our digital crawl map — even if no special, give us a drink we can list as your exclusive" |

**City variation:** Handled by `{{city}}` and `{{venue_name}}` field substitution. City-specific notes (parking, transit, etc.) handled by optional `{{city_specific_note}}` field pulled from per-city config when relevant.

### 7.3 T10 — Social media graphic delivery [LOCKED]

**When:** ~4-5 weeks out (or whenever designer has graphic ready).
**Sender:** Bryle.
**Format:** Email with JPEG attached.

**T10 wording:**
> "We're excited about this, we're making something for you — you don't have to use it, but it does help drive traffic on the night."

**Asset creation flow (manual, ops-side):**

1. Graphic designer creates a campaign-level template (poster-style image with placeholder slot for venue logo)
2. Per confirmed venue, designer:
   - Finds venue's logo online (Google, Instagram, their website)
   - Converts to white-on-transparent
   - Drops into template placeholder
   - Saves as JPEG
3. Hands finished JPEG to outreach staff (or uploads to engine for auto-attach to T10)

**No-logo fallback:** If venue has no findable logo online, designer creates a **plain-text variant** — the campaign poster with the venue's name typeset cleanly in place of where a logo would go. **Never ask the venue for their logo** — violates the low-buy-in principle.

**Universal rule:** Every confirmed venue gets a social graphic. No exceptions for priority — even Prio 5-6 venues get one.

**Phase 2 engine build item:** Graphics tracker. Auto-populates from confirmed venues. Three states per row:
- **Ready to be made** (venue confirmed, no graphic yet)
- **Made / ready to send** (designer uploaded JPEG)
- **Sent** (T10 email sent)

Designer's worklist on one side; operator's "ready to send T10" worklist on the other.

### 7.4 T11 — Info sheets [LOCKED]

**When:** 3 weeks out.
**Sender:** Bryle.

**Two info sheets, with different distribution:**

#### 7.4.1 Staff info sheet

**Audience:** ALL venue staff (bartenders, security, door staff, managers) — not just wristband-handlers.

**Purpose:** Solves the "my staff didn't know there was a crawl tonight" problem — one of the most common ways crawls go sideways. Door staff turns crawlers away because management never told them; participants think it's a scam.

**Contents:**
- "This is for you to give to your staff"
- Crawl name and brand
- Date(s) this venue is participating
- Expected turnout (priority × slot-type figure + wave qualifier)
- What slot type this venue is (wristband / participating / final / day party)
- Slot timing
- What a wristband looks like (image) — so door staff recognize it and let people in for free
- Brief description of how the crawl works
- Contact for night-of questions

**Format:** Branded PDF attachment.

**Goes to:** Every confirmed venue, regardless of slot type.

#### 7.4.2 Participant info sheet

**Audience:** Wristband venues only.

**Purpose:** Physical on-site signage that helps wristband venues welcome and orient crawlers as they arrive.

**Contents:**
- QR code linking to the crawl map page
- Crawl map content (drink specials at every venue, route, venue list, schedule)
- Crawl rules / instructions
- Branded so it looks like official event signage

**Format:** PDF attachment, designed for the venue to print and post on-site.

**Goes to:** Wristband venues only (night + day-party). Middle and final venues do not get this sheet.

#### 7.4.3 T11 variants

| Slot type | Staff info sheet | Participant info sheet |
|---|---|---|
| Wristband (night) | Yes | Yes |
| Middle (participating) | Yes | No |
| Final | Yes | No |
| Day-party wristband | Yes | Yes |
| Day-party participating | Yes | No |

So **T11 has two engine variants**:
- **T11-wristband:** wrapper email + both PDFs attached
- **T11-other:** wrapper email + staff info sheet PDF only

Body is mostly the same; attachment count and one explanatory sentence differ.

**Phase 2 engine build item:** Info sheet generation tracker (per-crawl, not per-venue, since sheets are the same for all venues in a given crawl × night). Same workflow shape as the graphics tracker. Block T11 send if sheets aren't ready. Auto-attach correct sheet(s) to each venue's T11 based on their slot type.

### 7.5 T13 — Pre-event details [LOCKED]

**When:** 2 weeks out.
**Sender:** Bryle by default; other staff can step in as escalation.

**Contents:**
- Wristband image (photo of the actual physical wristbands so all venues know what to look for)
- Host contact info (Prio 1-3 wristband venues with external host)
- Final logistics
- Anything not already sent

**Reinforce the staff briefing:**

Re-attach the staff info sheet at T14 (see 7.6) — the staff briefing problem persists even after T11 because a manager who briefed the 3 PM shift may not have reached the 8 PM staff. Free reinforcement.

### 7.6 T14 — Day-before check-in [LOCKED]

**When:** 1 week out (and/or day before).
**Sender:** Bryle by default; other staff can step in.

**Standard content:**
- "See you Saturday — host arrives at 7 PM"
- Confirm wristband package arrived (operator follow-up if it didn't)
- Re-attach staff info sheet
- Final reminder to brief night-of staff

### 7.7 T15 — Day-of morning [LOCKED]

**When:** Morning of the event.
**Sender:** Any operator working day-of.

**Content:**
- "We're live tonight" (night crawls)
- "We're live today" / "See you this afternoon" (day parties)
- Brief, positive, closes the loop

### 7.8 Day-party crawls — same 6-touch sequence

Day-party crawls (Saturday Oct 31 afternoon) use the **same 6-touch post-confirm sequence**, with copy variations only:
- `{{slot_time}}` field swaps (1:00 PM to 4:00 PM wristband; 3:00 PM to 8:00 PM participating)
- `{{slot_context}}` field swap ("across your pickup window" → "across the afternoon")
- T15 says "we're live today" instead of "tonight"

Reason for not creating separate day-party touchpoints: booking-to-event arc is the same length (weeks/months out); flake risk is the same; infrastructure (sheets, image, graphic) all apply identically. Day-party venues are often the same operators as night venues — inconsistent touch sequences would confuse coordination.

### 7.9 Cancellation review [LOCKED]

When sales or operational issues threaten a crawl, cancellation review happens in **event week** — NOT at the 2-week reminder.

#### 7.9.1 Wave 1 — Tuesday of event week

**Trigger condition:** Crawl has 0 sales OR can't be scheduled (incomplete lineup).

**Why Tuesday:** Last reasonable point to cancel "structural failure" cases — cities where we genuinely couldn't build the lineup or have zero engagement.

**Engine action:** Flag for operator review. **Engine never auto-cancels.** Operator decides.

**Cancellation reasons at this stage:**
- 0 tickets sold
- Couldn't book a wristband venue
- Couldn't book any final venue
- Other structural blockers

#### 7.9.2 Wave 2 — Wednesday / Thursday of event week

**Trigger condition:** Crawl has 5-10 tickets sold and is unlikely to pick up materially.

**Why Wed/Thu:** Last realistic point to give notice before the 48-hour window when venues commit staff and inventory.

**Engine action:** Flag for operator review. Operator decides.

**Threshold logic:**
- **Below 5 tickets:** Nearly always cancel — no plausible day-before pop will turn 4 tickets into a viable crawl
- **6-10 tickets:** Operator judgment, lean cancel
- **11+ tickets:** Let it run — 70-80%-of-sales-day-before rule means even 15 tickets on Wed could legitimately become 35-50 by Saturday night

#### 7.9.3 Cancellation behavior

The engine **never auto-cancels**. It surfaces candidate crawls to a "cancellation review queue" for the campaign manager. Manager looks at the data and makes the call.

Multi-crawl cities: can cancel one night and consolidate, keep other nights running.

| Situation | Action |
|---|---|
| Whole city at 0 sales by Tuesday | Cancel all crawls for that city |
| One night at 0, other nights pacing | Cancel that night only, consolidate venues if possible |
| All nights at 5-10 by Wed/Thu | Hard call — usually cancel weakest night, run strongest |
| One night at 5-10, other nights at 50+ | Cancel weak night, run strong nights |

### 7.10 T16 — Cancellation email to venues [LOCKED]

Engine generates draft when operator clicks "cancel crawl" on a crawl × city × date. Operator reviews/edits/sends each draft.

**Sender:** Operator who confirmed the venue (the one who owns the relationship). Falls back to Bryle if original confirmer unavailable.

**Tone:** Apologetic, brief. Blames OUR side (scheduling / low turnout / operational issues). Never blames the venue. Leaves door open for future events.

**Subject:** `{{city}} Halloween crawl on {{date}} — update`

**Template:**

```
Hey {{contact_first_name}},

Wanted to let you know that we won't be running the {{city}} Halloween crawl
on {{date}} after all. Unfortunately {{cancellation_reason_phrase}} so we're
having to call this one off.

Apologies for the back-and-forth on this one. Really appreciate {{venue_name}}
being willing to host us, and hoping we can work together on the next
holiday crawl in {{city}}.

Thanks,
{{your_name}}
{{company_name}}
```

**Engine picks `{{cancellation_reason_phrase}}` based on cause:**

| Internal cause | Venue sees |
|---|---|
| 0 / very low sales | "ticket sales didn't come in the way we needed them to" |
| Couldn't schedule lineup | "we ran into some scheduling issues that we couldn't resolve in time" |
| Operational issue (lost wristband, host fell through) | "we hit a few operational issues that we couldn't work around in time" |
| Other (default) | "scheduling issues" |

The framing always points at OUR side, never at the venue.

**Notable choices:**
- **No "first dibs" for next campaign** — venues don't get priority
- **No refund language** — venues never paid anything (no deposits, no contracts)
- **"Apologies for the back-and-forth"** acknowledges the multi-week buildup before cancellation
- **"Hoping we can work together on the next holiday crawl"** is the soft re-engagement line. Doesn't promise, doesn't ask, leaves door open

**Engine state after T16 sends:**
1. Marks venue × campaign as `cancelled-by-us`
2. Stops all downstream touches for that venue × campaign
3. Cancels any pending wristband shipment (or flags `shipping-but-cancelled` if already in transit)
4. Marks relationship history as **neutral** (not bad) — venue did nothing wrong
5. Venue freely available for next campaign

### 7.11 Refund flow — [LOCKED, OUT OF SCOPE]

**The engine does not handle refunds or any ticket-holder communications.**

- Eventbrite's API does not support automated refunds, so refund automation is impossible at this layer regardless
- Ticket-holder refunds are processed manually outside the engine
- Ticket-holder notification of a cancelled crawl is handled outside the engine (Eventbrite, manual, or however the ticketing flow works today)

**The engine's scope is venue outreach + post-confirm ops with venues only.** T16 goes to the venue. The ticket holder gets nothing from this engine.

**Future scope (out of band):** A "refund flag" surface could be built later — a place for ticket holders to request refunds and operators to track + process those requests. Explicitly NOT part of this doc or the Halloween 2026 outreach engine. If/when built, it lives in a separate workstream.

### 7.12 Stage F — Wristband shipping logistics [LOCKED]

#### 7.12.1 Carrier

**Amazon.** Orders placed through standard Amazon retail flow.

**Phase 2 engine build item:** Amazon tracking integration. Engine auto-imports tracking numbers + delivery status from Amazon order data and surfaces "package hasn't shipped yet" / "in transit" / "delivered" / "delivery failed" on the venue × crawl-night page.

#### 7.12.2 Shipping order timing

Engine triggers a wristband shipping order **as soon as the wristband shipping address is collected from the venue** — i.e. immediately after the venue replies to T9 with their address.

**Order-timing rules by priority:**

| Priority | Ship when |
|---|---|
| 1-4 | Order as soon as address is received |
| 5-6 | Order at least **3 weeks out** minimum; **2 weeks out** is acceptable but starting to get risky |
| Any priority | **Shipping within 1 week** of event is risky — flag and escalate |

The 5-6 delay exists because those crawls are most likely to be cancelled at the Wave 2 (Wed/Thu) cancellation review. Holding off on shipping until 2-3 weeks out reduces waste-shipping for crawls that don't end up running.

#### 7.12.3 Multi-night venues

If a venue is wristband-hosting on multiple nights, they get shipped wristbands for **each night they're wristband-hosting** (separate shipping orders per crawl-night).

If they're wristband on Thursday AND final on Friday, they only ship for Thursday — the final slot doesn't need wristbands.

Shipping volume scales with crawl size — Prio 1 wristband gets more wristbands than Prio 5 wristband.

#### 7.12.4 Delivery failure / contingency

If Amazon fails to deliver before the event:

1. **First retry:** Reship the package via Amazon expedited if there's time
2. **Last-resort:** Get a host to source local wristbands themselves (buy in person at a party-supply store, etc.) — expense reimbursed
3. **Cancellation:** If neither works and wristbands genuinely can't be on-site, **the crawl gets cancelled** for that wristband venue / crawl. Wristbands are non-optional for wristband venues — without them, the entire check-in flow breaks.

This is one of the reasons shipping within 1 week of the event is flagged risky — there's no time for retry-then-fallback if delivery fails.

#### 7.12.5 Engine state tracking

For every wristband venue × crawl-night, the engine should track:

| Field | Source |
|---|---|
| Shipping address | Collected from T9 reply |
| Contact name + phone | Collected from T9 reply |
| Amazon order ID | Operator enters after placing order |
| Tracking number | Auto-imported from Amazon |
| Shipment status | Auto-updated (pending / shipped / in transit / delivered / failed) |
| Last status update | Auto-timestamp |
| Operator notes | Manual (e.g. "venue confirmed receipt by phone Oct 25") |

The engine should surface "wristband shipping risk" on the campaign dashboard:
- Red flag: shipping date is within 1 week of event AND no tracking number yet
- Amber: 1-2 weeks out, ordered but not yet shipped
- Green: delivered or in-transit with sufficient lead time

### 7.13 Stage G — Host payment flow [LOCKED]

#### 7.13.1 Brandon's role

**Brandon is an admin staff member** whose specific responsibility is processing payments out to:
- Internal staff (PERSE team members)
- **Hosts (both external and internal)**

Brandon owns the payment workflow end-to-end: confirming rates, choosing payment method, executing the payment, and logging it.

#### 7.13.2 Host rates vary by city / region

There is **no standard rate** for hosts. Rates are determined by:
- **Local minimum wage** in the city/state/country
- **Local market rate** for similar event-staff work
- Different rates for **external hosts** vs **internal staff hosts** in the same city

The engine maintains (or will maintain) a **host tracker sheet** with the canonical rate by city × host-type. Brandon and operators reference this when staffing a host for any given event.

**Phase 2 engine build item:** Host tracker — a per-city × host-type rate sheet built into the engine, sourceable by operators when negotiating with hosts and by Brandon when processing payment.

#### 7.13.3 Always hire TWO external hosts (Prio 1-3)

For any city with an external host, the operator hires **two external hosts**, not one. Reason: hosts are flaky. Having a backup means if one no-shows, the other covers.

**Fallback chain:**

1. Primary external host arrives → that host runs the night
2. Primary no-shows → backup external host runs the night
3. **Both no-show** → wristband table fallback (the shipped wristbands + printed PDF poster carries the crawl)

The wristband package always ships regardless of host situation, so the table-only fallback always works if both hosts flake.

#### 7.13.4 Host confirmation timing (revised)

Earlier in the doc (Section 2.3) the host confirmation deadline was stated as "3-4 days before the event at the latest." That's the worst-case last-possible-moment deadline. The IDEAL targets are:

| Timing | Status |
|---|---|
| 4 weeks out | Ideal — should already be working on hosting |
| 3 weeks out | Target — both hosts ideally confirmed by this point |
| 2 weeks out | Latest acceptable — operator should be checking in repeatedly |
| 1 week out | Too late — high flake risk; should already be locked weeks ago |
| 3-4 days out | Last-resort fallback only |

**Operator behavior:** Keep checking in on hosts continuously between hiring and event night. Hosts ARE flaky and need touch-points to stay engaged with the booking. The engine should surface "host re-confirm overdue" reminders to the operator (e.g. "Host hired 2 weeks ago — confirm they're still on board for Saturday").

**Phase 2 engine build item:** Host re-confirmation reminders. Surface "needs touch-base" prompts to the operator for hosts that haven't had a check-in in N days before the event.

#### 7.13.5 Payment timing

**Payments are made AFTER the event, not before.** No upfront payment to hosts.

The "3 weeks out" reference in the original spec (Appendix E) was about **hiring** the host, not paying them. Payment happens post-event once the work has been done.

(Internal-staff-host payment via the venue is also post-event — venue invoices PERSE for the staff member's shift after the night.)

#### 7.13.6 Payment methods vary by host and country

PERSE pays hosts via whichever method works for the host + region:

- **Stripe** (most common for North America business-to-individual)
- **PayPal**
- **Cash** (for some local arrangements)
- **E-transfer** (Canada specifically — Interac e-Transfer)
- **Bank transfer** (international where needed)
- Other (per-host arrangement)

The engine should track per-host:
- Preferred payment method
- Payment destination details (Stripe payout email, PayPal email, e-transfer email/phone, bank info)

For data sensitivity reasons, the engine should be careful about how bank info is stored — at minimum, encrypted at rest. Or store only the routing email/phone for e-transfer/Stripe/PayPal (no full bank account numbers in engine DB if avoidable).

#### 7.13.7 Engine tracking

The engine logs payment events per host × event:

| Field | Source |
|---|---|
| Host name + contact | Operator entered at hiring |
| Host city + role (external / internal-staff) | Operator entered at hiring |
| Agreed rate | Operator entered, references host tracker |
| Event date + venue | Auto-linked to crawl record |
| Payment method | Operator entered |
| Payment destination | Operator entered (encrypted) |
| Payment date | Auto-stamped when Brandon marks paid |
| Payment confirmation reference | Brandon manually enters (Stripe payout ID, PayPal txn, etc.) |
| Payment status | pending → in-progress → paid → failed |
| Operator notes | Manual |

This data currently lives in the host tracker sheet. **Phase 2 engine build item:** Promote host payment tracking from sheet to first-class engine surface — Brandon's daily worklist shows "hosts awaiting payment" with one-click "mark paid + enter confirmation" flow.

#### 7.13.8 No-show clawback

If a host commits but no-shows on the night:

- They are **not paid** (no work performed, no payment due)
- The backup host (or wristband table) covered the night
- The no-show host gets flagged on their host record as `no-show` for that event
- Future hiring decisions weigh this against re-hiring the same host

The engine should surface a "no-show history" flag on each host's record so operators staffing future events can avoid known flakers.

**Phase 2 engine build item:** Host reliability tracking — surface no-show count, lateness reports, and host performance feedback per host record across multiple events.

#### 7.13.9 Host briefing (H0a + H0b)

External hosts get a two-stage briefing from the engine. The split exists because lineup details aren't locked until the week of the event, but hosts need to be locked in well before then so PERSE has time to find a backup if they flake.

Internal-staff hosts (venue employees) do NOT get H0a/H0b — their venue manager handles their information flow as part of T11/T13/T14.

##### H0a — Hiring confirmation (sent immediately at hire time)

**When:** Sent as soon as the host accepts the hire. Can be 2-4 weeks before the event.

**Channel:** Email.

**Contents:**
- Confirmation they're hired for [city] Halloween crawl on [date]
- Approximate shift time (e.g. 7:30 PM to 2:00 AM) — exact venue is TBD
- Pay rate
- Payment method + timing (post-event, **within 3 days**)
- Their host manager's name + cell phone (their primary contact for everything)
- Promise that they'll receive the wristband venue address, full lineup, and wristband image about a week before the event
- Request: if anything changes on their end before the event, give as much notice as possible so PERSE can find a backup

The purpose of H0a is to lock the host in and give them their escalation contact. No operational details yet — those aren't known.

##### H0b — Operational briefing (sent the week of the event)

**When:** Early in the week of the event (Monday or Tuesday). After lineup is essentially locked but before H3/H4/H5 SMS check-ins start firing.

**Channel:** Email (detailed info + attachments).

**Contents:**
- Wristband venue: full name, address, map link, arrival time
- Bar contact: venue manager name + phone (so host can say hi on arrival)
- The full lineup for the night, with times and addresses:
  - Wristband venue: [name, time, address]
  - Middle venue(s): [name, time, address]
  - Final venue: [name, time, address]
- Wristband image (attached)
- Brief on what they're doing (scan tickets, hand wristbands, greet, direct to crawl-map QR)
- New for 2026: visit each participating venue ~1 hour before crawl start to introduce themselves
- Host manager's name + cell as the escalation contact

##### Lineup-change update (between H0b and the event)

If the lineup changes after H0b is sent (a confirmed venue drops, a new one is added), the engine sends a brief SMS update to the host:

> "Tonight's [city] crawl — lineup updated. [Updated venue name] is now the [slot type] at [address]. Full updated lineup: [link]"

Concise. Just the diff. Host doesn't get re-read the whole brief — they get the change.

This is a Phase 2 build item — depends on the engine's pub/sub change events emitting on lineup updates and the Twilio integration being live.

### 7.14 Stage H — Day-of communication [LOCKED]

The engine doesn't replace human coordination on the night, but it DOES automate the pre-event reliability check-ins that catch flakes early.

Two layers:
1. **Day-of human coordination** (human work, not engine work)
2. **Pre-event automated host check-ins** (NEW — engine-driven, restaurant-reservation pattern)

#### 7.14.1 Day-of human coordination (out of engine scope)

PERSE has a **host manager** (Bryle or another operator depending on the city) who:
- Calls/texts external hosts to confirm they've arrived at the wristband venue
- Calls/texts to check they're okay during their shift
- Acts as the escalation contact if anything goes wrong

This is judgment-heavy, real-time coordination that needs a person. The engine doesn't try to replace it.

#### 7.14.2 Pre-event automated host check-ins (external hosts)

Modeled on the restaurant-reservation confirmation pattern (OpenTable, Resy). The engine sends the external host automated SMS check-ins at milestones before their shift. Host responds yes/no with one tap. Failure to respond escalates.

**Channel: SMS** for all H-cadence touches. External hosts are gig contractors; SMS open rates (~98% within 3 min) and response rates (~45%) crush email for this audience.

| Touch | When | Channel | Question |
|---|---|---|---|
| **H0a** | At hire time | Email | Hiring confirmation (see Section 7.13.9) |
| **H0b** | Week of event (Mon/Tue) | Email | Operational briefing (see Section 7.13.9) |
| **H1** | 1 week before event | SMS | "Confirming you're still on for Halloween crawl Sat [date] at [venue]. Reply YES." |
| **H2** | 2 days before event | SMS | "Halloween crawl Saturday at [venue], [time]. Still good? Reply YES." |
| **H3** | Day of event, ~5 hours before shift | SMS | "Tonight: hosting at [venue] starting [time]. Are you on track? Reply YES." |
| **H4** | 1 hour before shift | SMS | "Are you en route to [venue]? Reply when you arrive." |
| **H5** (arrival) | When host taps "arrived" OR 5 min after shift start | Auto-routed | "Host arrived at [venue]" routed to host manager OR "Host has NOT confirmed arrival — page host manager" |

Escalation rules:
- **Missed H1 or H2:** Flag to host manager; consider activating backup host
- **Missed H3 or H4:** Urgent flag; backup host should be dispatched
- **H5 fails (no arrival confirmation):** Page host manager immediately; backup host runs the night; flag primary as no-show

This applies to **external hosts only**. Internal-staff hosts are venue employees managed by the venue, not by PERSE directly.

**Requires:** Twilio SMS infrastructure + A2P 10DLC registration. See Section 11 build items.

#### 7.14.3 Venue confirmation touch (internal-host cities, Prio 4-6)

For internal-host cities, the engine sends ONE confirmation message to the venue (not to an external "host" we hired). Three touches is too many for internal venues — they're paying-job employees, not gig contractors, and the flake-risk is low.

| Touch | When | Channel | Question |
|---|---|---|---|
| **V1** | Monday or Tuesday of event week | Email | "Quick confirm — Halloween crawl at [venue] on [date]. Staff member ready for wristband duty? Reply yes." |

One email, week-of, that's it.

**Escalation:** If V1 doesn't get a reply by Wednesday night of event week, the host manager picks up the phone and calls the venue directly. Engine surfaces "V1 unresponded" venues to the host manager's worklist Wednesday morning.

#### 7.14.3a Floor-staff confirmation call (V2-call) [LOCKED]

In addition to V1 (email to bar manager), PERSE places a **direct phone call to the venue's frontline staff** within the 3-4 days before the event. This applies to **ALL confirmed venues regardless of priority or host mode** — not just internal-host cities.

**Why the second touch.** Bar managers often don't communicate event details down to floor staff (door staff, bartenders, hostesses). A manager who confirmed the crawl weeks ago might not have told their Saturday-night door person that a wristbanded crowd is showing up. Walking guests get turned away, the host gets confused, the venue manager is offsite and unreachable. The floor-staff call closes that loop.

**Call target:** the first frontline worker who answers the phone at the venue — door staff, bartender, host, whoever picks up. NOT the manager (already confirmed via V1 or earlier touches).

**Script (short, friendly):**

> "Hi, this is [name] from PERSE. I'm just calling to give your team a heads-up that we have a Halloween bar crawl happening on [date] at [time] — your venue is part of it. Wristbanded guests will be coming through. The wristband venue is [name]; you're the [slot type] for the [time range] window. Just wanted to make sure your floor staff knows in case it wasn't passed down. Anything I can answer for you?"

**When:** 2-4 days before the event (typically Wednesday-Thursday for a Saturday event).

**Channel:** Phone only. SMS doesn't reach floor staff (they don't have the venue's business line forwarding to their personal phone); email is even worse. Phone hits whoever's standing at the bar right now.

**Engine surface:**

- Engine generates a "V2-call" task per confirmed venue in the host manager's worklist (Calls to make today section), starting 4 days before each event
- Task shows: venue name, slot type, slot times, what to say (script preview), phone number with one-click OpenPhone dial
- After the call, operator marks the call outcome:
  - **Confirmed (talked to floor staff, they're aware)** — venue × event marked as `floor_staff_briefed`
  - **Talked to manager again (not floor staff)** — partial success, retry later in the week
  - **No answer / voicemail** — engine schedules a retry for tomorrow, escalates to "needs attention" if 3+ failed attempts
  - **Issue raised on call** — flag to operator / host manager for follow-up

**Engine state field:** `venue_events.floor_staff_briefed_at TIMESTAMPTZ NULL` — set when V2-call confirmation succeeds. Surfaces as a pill on the event-day readiness dashboard.

**Why not skip this for high-priority external-host venues:** Even when PERSE has hired an external host, the floor staff still needs to know the crawl is happening — the external host can't intercept guests at every entry point, the bar's own door staff needs to be friendly to wristbanded guests. So the V2-call applies regardless of host mode.

**Phase 2 engine build item:** V2-call task surfacing — engine adds a "V2-call" task to the host manager's daily worklist 4 days before each event for every confirmed venue. Tracks call attempts + outcomes per venue × event. Surfaces `floor_staff_briefed_at` on the event-day readiness view.

#### 7.14.4 Engine scope on the night itself

Once shifts start, the engine **does not** do live monitoring of ticket scans, wristband distribution counts, mid-night issues, or crowd movement. These are human-coordination problems.

If at some future point the engine adds a real-time ticket-scan dashboard or live wristband count, that's a separate workstream — out of scope for Halloween 2026.

#### 7.14.5 What the engine DOES on the night

Limited but useful:
- Sends **T15** in the morning (already in the sequence)
- Marks all crawls as "in progress" → "completed" on the campaign dashboard so operators can see status at a glance
- Logs any inbound communication from venues or hosts on the night to the venue/host record (post-event review easier)
- Receives any "issue logged" entries the host manager or operator manually creates during the night

### 7.15 Stage I — Post-event [LOCKED]

The post-event flow has one main touchpoint: T17, a thank-you that doubles as NYE re-engagement.

#### 7.15.1 T17 — Post-event thank-you + NYE re-engagement

Engine generates T17 draft 2 days post-event (Monday-Tuesday after a Saturday event). Operator reviews + sends.

**Sender:** Original confirmer (the operator who managed the venue through the Halloween lifecycle). Falls back to Bryle.

**Timing:** 2 days post-event. Soon enough to catch warm-mood momentum; far enough that the venue has had time to reset. Sunday is too fast; mid-week is too late.

**Subject:** `Thanks for the {{city}} Halloween crawl — and one quick question about NYE`

**Body:**

```
Hey {{contact_first_name}},

Thanks again for hosting us at {{venue_name}} for the {{city}} Halloween
crawl on {{event_date}}. Hope the night went well on your end!

While we're already thinking ahead — New Year's Eve is just around the
corner (Thursday, December 31st) and we're starting to lock in the
lineup for {{city}} now. Would {{venue_name}} be open to joining us
again? Same setup as Halloween, just adjusted timing for the NYE crowd:

Wristband Venue (7:00 PM to 10:00 PM): Check-in / wristband pickup.
Participating Venue (9:00 PM to 11:00 PM): Middle slot, shared with
2-3 other venues.
Final Venue (11:00 PM to 2:00 AM): Where everyone meets to ring in
the new year.

Same terms as Halloween — you keep 100% of bar sales, we handle
ticketing, marketing, and promotion. No exclusivity, no line bypass
required.

Let me know if you're interested in any slot and I'll get you locked in.

Thanks,
{{your_name}}
{{company_name}}
```

**Why include slot details in the thank-you (instead of "we'll send NYE details later"):**

1. **Friction reduction.** If venues have to reply twice (once "yes interested," then "I'll take the wristband"), every extra exchange is a drop-off point. Including slot details lets them say yes/no/which-slot in one reply.
2. **Decision while warm.** Right after a successful event, the venue's mental state is "PERSE delivered, that was good, we'd do it again." That's the buying mood. If you make them wait a week for NYE details, the warm feeling decays.

**Why include "Hope the night went well on your end":**

Opens an implicit channel for venues to flag issues without a formal survey. If they had problems, they'll share them in the reply. Don't burden venues with structured post-event surveys — violates the low-buy-in principle.

#### 7.15.2 T17 is gated by relationship flag

T17 is only sent to venues whose post-event relationship is **good or neutral**. The relationship flag from Section 3.3 gates the send:

| Post-event state | T17 behavior |
|---|---|
| Successful event, good relationship | Send T17 |
| Fine event, neutral relationship | Send T17 |
| Issues but recoverable | Send T17 — implicit "hope it went well" line invites them to flag concerns |
| Event was a disaster, relationship marked bad | NO T17 sent — cooldown, manual operator decision on future re-engagement |
| Venue dropped after confirming or no-showed | NO T17 sent — cooldown |

Bryle reviews all T17 drafts before send, providing a final human sanity check on which venues should get the re-engagement.

#### 7.15.3 Post-event relationship-flag prompt (Phase 2)

Right now, the relationship flag is set via auto-detected inbound signals + manual operator override. **Phase 2 build item:** after each event, engine prompts the operator(s) who managed the venue to flag the outcome:

> "Did the event at Bar Opium go well? [Good / Neutral / Bad]
> Optional notes: ..."

The operator's answer updates the per-domain × venue relationship flag. This becomes the auto-trigger for whether T17 fires, and feeds future re-engagement decisions.

#### 7.15.3a Mapping event outcome → relationship flag

The operator's flag answer translates to the per-domain × venue relationship state:

| Operator's answer | Per-domain relationship flag set to |
|---|---|
| **Good** (strong positive — "they loved it, want to do it again") | **Good** — bumps the venue × domain pair to good standing. Future outreach prefers this domain. |
| **Neutral** (event was fine, no notable feedback either way) | **Neutral** — default state. No change unless other signals override. |
| **Bad** (venue raised real issues — "they hate us, don't want to crawl again") | **Bad** — HARD BLOCK for that domain. Future outreach must come from a different domain (or be skipped entirely for the next campaign). |

**Default for no-response from operator:** Neutral. The engine should not auto-fill "good" without explicit operator action — a positive flag requires real positive signal (operator confirming "they loved it"), not just "nothing went wrong."

A "good" flag is a meaningful trust signal. Reserve it for actual enthusiasm.

#### 7.15.4 Post-event data collection — venue-facing principle

**The engine does NOT send a formal post-event survey to the venue.** Reason: asking "how did the night go / any issues?" surfaces negative memories the venue would otherwise have moved past. It's the availability heuristic working against you.

Hospitality nights are inherently chaotic. Every busy night has SOMETHING that went sideways — a slow bartender, a rowdy guest, a small wristband mixup. If the venue isn't asked, the night gets filed as "busy Saturday, did well." If the venue IS asked "any issues?", they're forced to mentally retrieve those negatives and the night gets re-coded as "kind of a problem." Even net-positive events become net-negative memories under survey pressure.

Bar managers grade partners on revenue and warmth, not on operational data. Surveys erode warmth; they don't build it. High-volume nightlife operators (party promoters, DJ booking agents, festival operators) almost universally don't do post-event venue surveys for exactly this reason.

The implicit "Hope the night went well on your end!" in T17 (Section 7.15.1) is the data-collection mechanism. It opens the door without forcing the venue through it. Issues they want to raise will surface; issues they've moved past stay moved past.

**T17's NYE re-engagement also serves as an implicit "would you do this again?" check.** If they say yes to NYE, they've answered with action. If they decline NYE specifically (timing, holiday vacation, etc.), it's still clean signal — they may still be open to St. Patrick's or next Halloween.

This principle is **specifically about not asking the venue** for post-event data. It does NOT mean no post-event data is collected — see Section 7.15.4a.

#### 7.15.4a Internal post-event data collection

PERSE captures post-event data from sources OTHER than the venue:

| Source | What's collected | How |
|---|---|---|
| **External hosts** | "How many wristbands did you distribute?" / "Any issues to flag?" | Brief SMS or form post-event. Hosts are paid contractors; asking is reasonable. |
| **Internal hosts (venue staff)** | None directly — venue manager handles their staff | (covered by their normal venue ops) |
| **PERSE operators (host manager + on-the-ground)** | Internal debrief notes — what went well, what didn't, anything to remember next year | Engine surfaces a brief "post-event notes" field per crawl × night for operators to fill in. Free-text, no required structure. |
| **Ticketing platform (Eventbrite)** | Ticket sales total, day-of sales velocity, no-show rate (sold tickets vs. wristbands distributed) | Auto-captured via Eventbrite API + cross-referenced with host's wristband distribution count |
| **Engine itself** | Touch logs, cadence outcomes, conversion rates per template/domain/alias, time-to-confirm metrics | Already tracked; aggregated in post-campaign analytics |

This data feeds:
- **Future capacity planning** — was the actual turnout close to what we promised the venue, or did we over/under-deliver?
- **Host reliability tracking** — Section 7.13.8
- **Template performance analysis** — which templates converted, which got ghosted
- **Operator-set relationship flag** — operators reference internal notes when flagging the venue × domain relationship post-event

**Phase 2 build item:** Post-event host SMS — short single-question SMS to external hosts the day after the event asking distribution count. Optional second message asking if anything to flag. Replies stored on the host × event record.

**Phase 2 build item:** Operator debrief notes field — per crawl × night, a free-text notes area operators can fill in within a week of the event. Engine surfaces this on the campaign retrospective view.

#### 7.15.5 Host payment confirmation (Phase 2)

When Brandon pays a host post-event, the engine sends an automatic SMS confirmation to the host:

> "Payment of $[X] sent via [Stripe / PayPal / e-transfer] on [date]. Reference: [confirmation number]. Thanks again for working the [city] crawl!"

Reasons:
- Builds trust (hosts know exactly when payment lands)
- Reduces "did you pay me?" support load on Brandon
- Documents payment-sent timestamp for the host record

This depends on:
- The Twilio SMS integration being live
- Brandon's "mark host as paid" flow being a first-class engine action

Both are already in the Phase 2 build list.

#### 7.15.6 Cross-campaign re-pitch eligibility

After Halloween 2026 ends:

- **Venues with T17 sent and replied positively for NYE:** moved into the NYE 2026 campaign with confirmed status (or warm pipeline depending on their reply)
- **Venues with T17 sent and replied "not for NYE":** marked `declined-nye-2026`, still eligible for St. Patrick's 2027 pitches in February
- **Venues with T17 sent and no reply by 2 weeks post-Halloween:** added to the NYE cold-outreach list, get T1/T2 fresh outreach for NYE (subject to 7-day cross-campaign cadence floor)
- **Venues NOT sent T17 (bad relationship or no-show):** cooldown of 1 year on auto-relationship-clear (Section 3.3). Manual operator override can re-engage earlier if reasons change.

#### 7.15.7 NYE 2026 specifics (for engine context)

For ops planning, NYE is operationally similar to Halloween but with key differences:

| Aspect | Halloween 2026 | NYE 2026 |
|---|---|---|
| Date | Thu Oct 29 / Fri Oct 30 / Sat Oct 31 (night + day party) | **Thursday December 31st** only |
| Crawls per city | Multiple (Prio 1-4) or single (Prio 5-6) | **Single crawl per city** |
| Wristband slot | 7:30 PM to 10:30 PM | **7:00 PM to 10:00 PM** |
| Middle slot | 8:30 PM to 11:30 PM | **9:00 PM to 11:00 PM** |
| Final slot | 11:30 PM to 2:00 AM | **11:00 PM to 2:00 AM** |
| Lead time | ~6-10 weeks | **~2 months** (tight!) |

The tight NYE lead time (only 2 months from Halloween end to NYE event) is why T17 includes slot details inline — there's no time for a multi-touch warm-up sequence.

Full NYE 2026 outreach will get its own reference doc derived from this Halloween one once Halloween 2026 ships.

### 7.16 Stage J — Venue cancels on us last-minute [LOCKED]

When a confirmed venue backs out before the event, the engine's response depends on how close to event day the cancellation hits.

#### 7.16.1 Cancellation timing tiers

| When venue cancels | Severity | Engine + operator response |
|---|---|---|
| **4+ weeks out** | Routine | Mark venue as cancelled-by-them, open slot as `needs-replacement`. Operator runs normal T1/T2 cold outreach to replacement candidates. Plenty of time. |
| **2-3 weeks out** | Concerning | Mark venue as cancelled-by-them, open slot as `needs-replacement-urgent`. Operator runs T8 (one-shot specific ask) to a curated list of nearby venues. Phone calls reinforce the email. |
| **Week of event** | Critical | Operator runs **mass replacement push** — mass email + phone calls to many nearby venues asking them to fill the one specific slot. Speed > volume of touches; one good replacement is better than three maybes. |
| **Day-of** | Emergency | Try last-minute replacement via phone (email too slow). If no replacement found in time, **the crawl may have to be cancelled** for that slot or entirely depending on which slot dropped. Wristband slot dropping day-of is usually fatal; middle slot dropping day-of can be absorbed by reducing the route. |

#### 7.16.2 Slot-type matters for the replacement urgency

Not all slot cancellations are equal:

| Slot type cancelled | Replacement urgency | Why |
|---|---|---|
| **Wristband** | Highest | Wristband venue is the check-in anchor for the entire crawl. Hard to operate without one. Day-of cancellation here usually forces full crawl cancellation unless a backup wristband venue can be sourced immediately. |
| **Final** | High | Final venue is where the crowd builds. Losing it day-of can be patched by extending a middle venue's hours, but it degrades the experience. |
| **Middle** | Lower | One middle venue dropping can be absorbed — the crawl just has one fewer stop. Engine should still try to replace but isn't a crawl-killer. |

#### 7.16.3 Mass replacement push (week-of cancellations)

When a slot opens up in event week, operators run a coordinated push:

1. **Engine surfaces** the slot details (city, night, slot type, expected turnout) and pulls a list of candidate venues:
   - Nearby venues that have been pitched in this campaign but didn't reply
   - Nearby venues that had soft-no replies for this campaign (sometimes a one-night-only ask gets a yes when a multi-night menu didn't)
   - Past partners from previous campaigns in this city
2. **Engine generates** T8 (one-shot specific ask) drafts targeting each candidate
3. **Operator runs the push** — email + phone in parallel. Engine should fire emails immediately on operator approval (bypassing the 7-day cross-domain floor — this is an emergency, the standard cadence rules don't apply)
4. **Engine flags incoming replies** as urgent and pushes them to the top of the operator's worklist
5. **First "yes" wins** — operator confirms the replacement, fires T9-near immediately (3-week window has already passed, all info goes in one email)

The cross-domain anti-spam rule (Section 6.2, 7-day floor) is **suspended for mass replacement pushes**. The operational reality is: when a slot opens up 5 days before event, you cannot wait 7 days to hit a venue that was pitched 4 days ago. Engine surfaces this as an emergency override that the operator must explicitly trigger (one-click "emergency replacement mode for this slot — suspend cadence floors").

**Phase 2 engine build item:** Emergency replacement mode. Surface a "slot needs replacement" alert with curated candidate list, T8 batch-draft, cadence floor override, and incoming-reply prioritization.

#### 7.16.4 Relationship flag for the cancelling venue

**PERSE policy: don't punish venues for cancelling.** Cancellations are rare, and if a venue cancels and later wants to come back — even last-minute — PERSE is happy to have them. More venues is better than fewer venues. The cost of being forgiving (small) is far less than the cost of permanently burning a relationship over a one-time scheduling conflict (large).

Default behavior:

| Cancellation timing | Per-domain relationship flag |
|---|---|
| Any cancellation, any timing | **Neutral** by default. No automatic penalty. |
| No-show with zero communication | **Neutral** still — operator can manually override to Bad if there are signs of bad faith, but defaults soft. |
| Repeated cancellations across multiple campaigns | Operator may manually flag Bad after pattern is clear. Engine should not auto-flag this. |

**Operator override is always available** for cases where the cancellation was disrespectful, repeated, or otherwise warranted a real flag. But the engine defaults to forgiveness.

This applies to the relationship flag (Section 3.3). It does NOT change the operational urgency of the cancellation alert flow (Section 7.16.8) — staff still need to be notified immediately so replacement outreach can start. The flag is about future re-engagement; the alert flow is about right-now operations.

#### 7.16.5 Engine state for the cancelled venue × campaign

When a venue cancels post-confirm:

1. Mark venue × campaign as `cancelled-by-them`
2. Stop all downstream touches for that venue × campaign (no T11, T13, T14, T15)
3. Cancel any pending wristband shipment if not yet shipped
4. **If wristbands already shipped:** flag the shipping order as `delivered-but-event-cancelled`. Don't try to recover the wristbands (cost/effort isn't worth it). Mark for write-off.
5. **If a social graphic was made for them:** archive on the venue record but don't delete. The graphic is reusable next year if relationship is salvageable.
6. **If a host was hired for this venue × night:** if the crawl still runs at a replacement wristband venue, the host can be redirected (the host is paid for working the night, not for working a specific venue). If the entire crawl is cancelled, host gets paid a partial cancellation fee — see Section 7.13 for payment policy.

#### 7.16.6 If the venue tries to come back

Occasionally a venue cancels then reverses: "Sorry, our wedding fell through, we can do Saturday after all."

**PERSE default policy: take them back.** More venues is better than fewer venues, and a venue that's enthusiastic enough to call back deserves the second chance.

Engine flow:

- **If the slot has been refilled by a replacement venue:** operator declines the comeback politely. Slot is taken. Engine sends a polite "Thanks for the update, we already filled that slot but would love to work together on the next campaign" reply. Relationship stays neutral.
- **If the slot is still open:** operator re-confirms the venue. No probation, no trust penalty. Even last-minute comebacks are fine.
- **If the slot is filled BUT a different slot opened up since:** operator can offer the alternative slot ("we filled the wristband, but the middle is still open — interested?").

The principle: don't make a venue earn back trust they didn't lose. A scheduling conflict is a scheduling conflict, not a character flaw.

#### 7.16.7 The host's role in a venue cancellation

If the cancelled venue is the **wristband venue** and a replacement is found:
- Host's wristband venue address changes
- Engine fires the lineup-change SMS (Section 7.13.9) to the host with the new address
- Host shows up at the new address

If no replacement is found and the crawl is cancelled:
- Host is informed via SMS that the crawl is cancelled
- Per the host payment policy (Section 7.13.5), if cancellation happens late enough that the host has already turned down other work for the night, a partial payment may be due — operator + Brandon decide case-by-case. Engine surfaces "host owed partial pay for cancelled event" for Brandon's review.

#### 7.16.8 Staff notification and escalation when a venue cancels

A confirmed venue backing out is a fire-drill, not a quiet state change. Multiple staff need to act in parallel: original confirmer needs to call the venue, Bryle needs to stop post-confirm touches, host manager needs to reassign hosts, Brandon needs to handle wristband shipping write-offs, replacement outreach needs to start. The engine coordinates all of this.

##### Detection

Two paths to detection:

1. **Auto-detect from inbound reply** — engine reads inbound replies from confirmed venues and flags phrases like "we can't do," "we have to cancel," "we won't be able to," "something came up." High-confidence matches trigger the cancellation alert flow.
2. **Manual operator flag** — operator on a phone call or in-person conversation marks the venue as cancelling via a one-click action.

Both routes trigger the same alert flow.

##### Immediate engine actions (within seconds of detection)

1. Change venue × campaign state to `cancelled-by-them`
2. **Visual escalation** in the engine UI:
   - Red border + "CANCELLED" badge on the venue's row
   - Venue moves to the top of the campaign's venue list
   - Highlighted in tracking dashboard
3. Add venue to the **Cancelled By Venue** table for this campaign (separate from warm-leads table — see 7.16.10 below)
4. Stop all queued downstream touches for this venue × campaign immediately (T11, T13, T14, T15 cancelled)
5. Open the slot as `needs-replacement` and trigger replacement-search alert
6. Fire downstream staff notifications

##### Staff notification fan-out

When the cancellation is detected/flagged, the engine notifies multiple staff in parallel:

| Recipient | Channel | Why |
|---|---|---|
| **Original confirmer** (whoever owns this venue relationship) | Email + in-app alert + SMS if urgent | They need to acknowledge and likely call the venue to confirm reason + maintain relationship |
| **Bryle** (post-confirm coordinator) | In-app alert + email | He has T11/T13/T14 in his queue; needs to stop them and reassign attention |
| **Host manager** (if host already assigned) | In-app alert + email | Host may need to be reassigned to new wristband venue OR informed of crawl cancellation |
| **Brandon** (if wristband shipping placed or host payment scheduled) | In-app alert | He handles shipping redirect/write-off and any partial payments |
| **Graphics designer** (if T10 graphic in progress, not yet sent) | In-app alert | Stop making the graphic, archive in-progress work |
| **Campaign manager** | In-app alert + email | Owns campaign-level health view; needs to see the slot is now open and replacement search has begun |

##### Urgency tiers — escalation scales with timing

| Cancellation timing | Notification channel(s) | Acknowledgment requirement |
|---|---|---|
| 4+ weeks out | In-app alert only | None — handle in next worklist session |
| 2-3 weeks out | In-app alert + email | Original confirmer must acknowledge within 24h |
| Week of event | In-app alert + email + **SMS** to original confirmer + Bryle + campaign manager | Acknowledge within 2 hours |
| Day-of event | All channels + **phone call** to campaign manager | Acknowledge immediately; replacement push starts within 30 min |

The engine escalates up the chain if the assigned owner doesn't acknowledge within the required window. Week-of cancellation with no acknowledgment from original confirmer within 2 hours → engine escalates to campaign manager + Bryle. Day-of cancellation with no acknowledgment within 15 min → engine pages everyone.

##### Why visual + multi-channel matters

Quiet state changes get lost. A venue silently flipped to `cancelled-by-them` in the database while no human reads the alert leads to:
- T11/T13/T14 still firing to the cancelled venue (embarrassing)
- Wristband package shipping to a venue that won't accept it
- Host showing up to a closed venue
- Crawl-night chaos with no replacement

The escalation flow ensures every cancellation gets human eyes within the relevant urgency window.

#### 7.16.9 Active replacement state

While replacement outreach is in flight, the slot stays in the engine as `needs-replacement` with status indicators:

- Number of replacement candidates emailed
- Number of replies received (any kind)
- Number of phone calls attempted
- Any "interested" replies pending operator response

When a replacement venue confirms, slot transitions to `replacement-confirmed` and the new venue enters the normal post-confirm flow (T9-near because of tight timing, then T11/T13/T14 if there's still time, etc.).

If the slot times out (event arrives without a replacement), the engine flags the slot/crawl for cancellation review per Section 7.9 — or the operator manually decides to run the crawl with the slot unfilled (rare but possible for middle-slot cancellations).

#### 7.16.10 The Cancelled By Venue table

A new dedicated section per campaign — separate from the warm-leads / cold-pipeline tables. Reasons:

- Cancelled-by-them venues have specific operational tails (shipping write-off, host reassignment, T17 gating, relationship flag updates) that warm leads don't have
- Operators reviewing the warm-leads table are looking for "who to contact next" — a cancelled venue is "who to stop contacting"
- Mixing them dilutes both lists

Columns:

| Column | Source |
|---|---|
| Venue name | venue record |
| Date cancelled | timestamp of state change |
| Days before event | computed |
| Slot they had (wristband / middle / final) | venue × campaign record |
| Original confirmer | venue × campaign record |
| Replacement venue (when found) | linked record after replacement confirmed |
| Wristband shipping status | linked from shipping record (if applicable) |
| Host reassignment status | linked from host record (if applicable) |
| Relationship flag set | operator action |
| Acknowledgment status | tracked per staff member who received notification |

Once the replacement is locked AND all downstream cleanup is done (shipping resolved, host resolved, relationship flag set), the venue can be archived out of the active alert view but stays searchable in the venue × campaign history.

**Phase 2 build item:** Cancelled By Venue dedicated table — separate from warm-leads, with the columns above. Includes acknowledgment tracking so the engine knows when humans have actually seen the alert.

---

## 8. Operator vs. engine boundary [LOCKED]

The engine drafts, classifies, schedules, surfaces. **Humans review and send.** No outreach email auto-fires.

### 8.1 The core boundary principle

The engine is automation that makes operators faster, NOT automation that replaces them. Two reasons this matters:

1. **The engine is being tested + iteratively perfected.** Treating it as "ready for autonomous sending" before extensive real-world validation risks brand damage at scale. A bad auto-send to 50 venues at once is way worse than 50 individual operator-reviewed mistakes.
2. **Human touch matters in this business.** Some outbound messages need a human judgment call — operator notices a venue's reply mentioned a specific event at their bar, weaves that into the response. Engine drafts the structure; human adds the warmth.

What the engine DOES do autonomously:
- Drafts every template
- Auto-classifies inbound replies (engaged / soft-no / hard-no / stalled-warm) with confidence scores
- Schedules cadence floors and surfaces "ready to send" items
- Tracks state (venue × campaign, host × event, shipping, payments)
- Fires automated check-ins where the recipient is a paid contractor (host SMS H1-H5)
- Fires automated SMS for clearly-scoped notifications (lineup-change SMS to working hosts, payment confirmation SMS)
- Manages all integration push-outs to adjacent systems (Smart Map, Eventbrite)

What the engine DOES NOT do autonomously:
- Send any outreach email to a venue
- Send any reply email to a venue
- Mark a venue's relationship flag as Good (Bad on hard-no detection is allowed; Good requires explicit operator action)
- Cancel a crawl
- Confirm a venue (operator marks confirmed, which triggers T9 draft generation)
- Hire a host (operator does the hiring outside the engine, then enters the host into the engine)

### 8.2 What the operator sees on login (daily worklist)

The operator's primary surface is a **daily worklist** organized for easy visibility across multiple cities, venues, and tasks. The worklist should make it impossible to lose track of anything, especially under campaign-peak load when an operator is following up on 10+ cities and dozens of venues with different cadence timelines.

The four core sections every operator sees:

| Section | Contains |
|---|---|
| **Drafts to review and send** | Engine-generated email drafts queued for this operator's review. Sorted by priority (urgency + cadence floor proximity). |
| **Pending replies** | Inbound venue messages that have come in and need a response. Sorted by classification + freshness. |
| **Follow-ups in queue (next few days)** | Outbound cadence floors that have elapsed (or will elapse imminently) where a touch is due. Surfaces "what you need to send today, tomorrow, day after." Spans multiple cities × multiple venues × multiple cadence states simultaneously. |
| **Calls to make today** | Venues this operator should call today (based on city assignment + sales velocity + email-stalled status — see Section 6.6). Particularly important for priority cities that haven't been scheduled yet. |

**Host check-ins are NOT in the regular operator worklist.** Only the **host manager** (a dedicated role) handles host check-ins. Regular operators don't see the H1-H5 status flow.

The worklist is designed for the high-load reality: one operator might be juggling 5+ priority-1 cities, each with 10+ venues at different cadence states (cold opener due, follow-up 2 due, slot detail to draft, reply pending, call to make). Without a single unified surface, things get dropped. The worklist's job is to make sure nothing falls through.

### 8.3 Auto-classification of inbound replies

The engine reads every inbound reply and applies a classification:

| Classification | Examples | Engine action |
|---|---|---|
| **Engaged** | "Send me slots" / "What times?" / "Tell me more" | Auto-classify, surface to operator's pending-replies queue, draft next-step template (T3/T4/T5/T6/T8) |
| **Soft no** | "Not this year" / "We're booked" / "Maybe next time" | Auto-classify, mark venue × campaign as `declined-this-campaign`, surface for operator confirmation |
| **Hard no** | "Remove us" / "Stop emailing" / "Unsubscribe" / "Don't contact us" | Auto-classify, mark venue as `opt-out-permanent` ACROSS ALL CAMPAIGNS, surface for operator review |
| **Stalled-warm** | (Engaged once, then went silent through 3 nudges) | Auto-classify, mark venue × campaign as `stalled-warm`, surface for operator to optionally pick up phone |
| **Cancelled-by-them** | "We can't do this anymore" / "We have to cancel" | Auto-classify, trigger Section 7.16.8 cancellation alert flow |
| **Question / clarification needed** | "What time slot is the wristband?" / "Do I need to provide drinks?" | Auto-classify, surface to operator's pending-replies queue WITH a suggested response, operator reviews + edits + sends |
| **Unclassifiable / free-text** | Anything the engine isn't confident classifying | Surface to operator's pending-replies queue **flagged as needs-attention**, with no classification |

### 8.4 Auto-classification confidence threshold

The engine assigns each classification a confidence score (0-100%). The threshold for auto-acting on any classification is **90% confidence or higher**.

Below 90%: surface to the operator's pending-replies queue flagged as "needs-attention" with no automated state change. The operator triages manually.

Same threshold across all classification types. Simplicity beats fine-tuning per-category thresholds — easier to reason about, easier to debug misclassifications.

For any auto-classified action, the operator can manually override in the venue's record. Engine logs both the original classification + confidence score AND the override + timestamp so misclassifications can be reviewed and the classifier improved over time.

### 8.5 Suggested responses for free-text replies

When a venue replies with a clarifying question, the engine should generate a **suggested response draft** based on:

- The original outreach template context (what slot was offered, what city, what date)
- The venue's record (capacity if known, any prior history)
- The reference doc rules (turnout numbers, wave qualifier, low-buy-in principle)
- Common question patterns the engine has seen before

The suggested response sits in the operator's pending-replies queue alongside the venue's question. Operator reads, edits, sends. No suggested response auto-fires.

If the engine can't generate a confident suggested response, it surfaces the reply with **no suggestion** and flags it as needs-attention for human triage.

### 8.6 Voice — use what the operator writes

When an operator hand-writes a reply outside templates, the engine does NOT try to match or adjust style based on the alias or staff member. Operators write in their own voice (often with AI assistance for drafting), and the engine sends whatever they've written.

Reasons:
- Operators frequently use AI tools to draft custom replies anyway — the AI assist happens upstream of the engine, not inside it
- Attempting to "match" an alias voice on top of operator's own writing creates friction without value
- The template pack already encodes the PERSE house voice for templated sends; hand-written replies for one-off questions don't need to be policed
- Each operator has their own writing rhythm; forcing voice alignment slows them down for no real benefit

The aliases are about deliverability and reputation isolation across domains, not about character acting in reply emails.

### 8.7 Template selection — engine picks, operator can override

When an operator marks a venue as needing a next-step send (e.g. they had a phone call and need to follow up via email), the engine picks the right template automatically based on context:

| Context | Engine picks |
|---|---|
| Cold opener, big-open ask, night crawl | T1 |
| Cold opener, big-open ask, day party | T2 |
| Warm re-engagement, past partner | T3 |
| Slot detail, night crawl, multiple crawls in city | T4 |
| Slot detail, night crawl, single crawl in city | T5 |
| Slot detail, day party | T6 |
| One-shot specific ask, 1-2 known slots | T8 |
| Confirmation (operator marked confirmed) | T9-far or T9-near (engine picks by date) |
| Social graphic delivery | T10 |
| Info sheets at 3wk | T11 |
| 2wk pre-event | T13 |
| 1wk pre-event / day-before | T14 |
| Day-of "we're live" | T15 |
| Cancellation | T16 |
| Post-event thank-you + NYE re-engagement | T17 |

Operator can override the engine's pick. E.g. engine queues T4 (multiple-crawl city), operator decides T5 fits better for this specific venue and swaps. Engine should make swapping easy (one-click change between compatible templates).

### 8.8 Engine never auto-sends — confirming the boundary

Reiterating the line in plain terms:

**The engine drafts. Humans send.** The day the engine sends without human approval is a future-state decision (Section 10), not the Halloween 2026 reality. Every outreach touch passes through an operator's review queue.

The exceptions to this rule — the few things that DO auto-fire without operator review:

- **Host SMS H1-H5** — short check-ins to paid contractors with one-tap replies. Low risk; high value. (Section 7.14.2)
- **Lineup-change SMS to working hosts** — diff-only updates when the lineup changes between H0b and event. (Section 7.13.9)
- **Host payment confirmation SMS** — sent when Brandon marks a host as paid. Mechanical confirmation, no judgment needed. (Section 7.15.5)
- **Smart Map and Eventbrite push** — system-to-system data sync, not a message to a human recipient.

Everything else — every email to a venue, every reply, every classification's downstream action — goes through an operator's review.

---

## 9. Edge cases [LOCKED]

### 9.1 Cross-domain conflicts within the same domain [LOCKED]

**Scenario:** Kevin@contacteventsperse pitched Bar Opium. No reply. Seven days later, Ian@contacteventsperse (same domain, different staff member, different alias) wants to pitch Bar Opium.

**Rule:** **Allowed.** The 7-day cross-alias floor applies even within the same domain — once 7 days have elapsed since the last touch, any alias on any domain can re-pitch (as long as no other anti-spam rule is being violated, like the 5-6 total touches cap).

This is the same logic as cross-DOMAIN handoff (Section 6.2). The venue's perspective is what matters — they got an email 7 days ago from "Events Per Se," and a new email from a different person at "Events Per Se" today reads as natural campaign cadence, not spam.

### 9.2 Multi-night venue commitments [LOCKED]

**Scenario:** Bar Opium confirms wristband on Thursday Oct 29 AND middle on Friday Oct 30. How does the post-confirm sequence handle the dual commitment?

**Rule: bundle by what's natural to send together; split only when content genuinely diverges.**

The engine sends **one combined email per touchpoint** that covers both nights, not two separate emails per touch. The exception is when the content differs enough between nights that splitting is clearer than bundling.

Per-touchpoint behavior for multi-night commitments:

| Touch | Behavior |
|---|---|
| **T9** | One combined email. "Confirming you for the Toronto Halloween crawl on two nights: Thursday Oct 29 as the wristband venue (7:30-10:30 PM) and Friday Oct 30 as the middle venue (8:30-11:30 PM). Here's what we need from you..." Info-gathering asks bundled: shipping address only needed once (for the wristband night), capacity asked once, drink specials/featured drinks asked once. |
| **T10** | Two graphics (one per night). The graphic designer creates a separate social graphic for each crawl-night, because the graphic text references the specific date and slot. One T10 email can deliver both attached, or two T10 emails — whichever is more natural for the moment the graphics are ready (e.g. if both graphics are ready at the same time, one email; if they're ready a week apart, two). |
| **T11** | One combined email. Staff info sheet for both nights (could be one sheet covering both, or two sheets attached to one email — graphic designer's call). Participant info sheet only for the wristband-hosting night(s) — Bar Opium in this example gets a participant sheet for Thursday only. |
| **T13** | One combined email. Wristband image (one image — it's the same physical wristband product for all nights). Host contact info if applicable (per night — different hosts likely). Final logistics summarized for both nights. |
| **T14** | One combined email. Day-before check-in covering both nights' staff briefings. |
| **T15** | Sent separately, one per night. "We're live tonight" / "See you tonight" is night-specific. |
| **T16** (cancellation) | If only ONE night is cancelled, separate email about just that night. If both are cancelled, one combined cancellation. |
| **T17** | One email post-Halloween. The thank-you references both nights naturally. NYE re-engagement is one ask (NYE is a single night anyway). |

**Wristband shipping:** Two separate shipping orders (one per wristband-hosting night). If Bar Opium is wristband on Thursday AND wristband on Friday, two packages ship. If they're wristband Thursday and middle Friday (as in the example), one wristband package ships (Thursday's only) — middle slots don't need wristbands.

**Host coordination:** Each wristband-hosting night gets its own host assignment. Hosts for Thursday and Friday are separate hires.

**Implementation principle:** the engine doesn't enforce a strict "always bundle" or "always split" rule. It checks per-touch whether the content can be naturally combined (same recipient, similar logistics, single coherent message) and bundles if so. If splitting reads more naturally (different graphics ready at different times, day-of message for different nights), the engine splits.

### 9.3 Late additions to a crawl [LOCKED]

**Scenario:** A new venue confirms 4 days before the event. Touchpoints T11 (3 weeks out) and T13 (2 weeks out) have already passed.

**Rule: send everything at once. Don't try to retroactively pace the missed touchpoints.**

When confirmation happens inside 2 weeks of the event:

- Engine fires the **T9-near** variant (already designed for late confirmations — bundles all the info in one email; see Section 7.2)
- Engine includes everything that would have come in T11, T13, T14 if there had been time: wristband image, staff info sheet, host contact (if applicable), final logistics, "we'll do a confirm the week of"
- For the wristband-hosting case: T9-near includes the participant info sheet too, plus the shipping-address ask (so the wristband package can ship immediately)
- A simple T14-style day-before check-in still happens the day before the event
- T15 (day-of "we're live") still happens morning of

**No retroactive sending of T11 or T13 as separate touches.** The engine doesn't try to replay missed touchpoints — that would feel weird ("here's an info sheet I should have sent you 3 weeks ago"). Everything gets bundled into the T9-near and the touchpoint sequence rejoins the standard flow at T14/T15.

### 9.4 Venue replies with a slot-change request [LOCKED]

**Scenario:** Venue replied to T9 with "actually we can't do Thursday but we can do Friday."

**Rule: cancel the Thursday slot, re-confirm them for the Friday slot the venue's offering.**

Engine flow:

1. Operator (reading the reply in their pending-replies queue) marks the original Thursday slot as cancelled-by-them via the standard cancellation flow (Section 7.16). Trigger: this opens the Thursday slot for replacement and starts the replacement-search workflow if necessary.
2. Operator confirms the venue for the new Friday slot via the normal confirmation flow. Engine generates a new T9 for the Friday slot.
3. Original Thursday relationship-flag default stays neutral — this is exactly the kind of "venue had a scheduling conflict" cancellation that the no-punishment policy in Section 7.16.4 is designed for.

The engine doesn't try to "edit" the existing booking record across slots. The clean state-machine pattern is **cancel + re-confirm** — same data flow as any other cancellation + new confirmation.

If the venue's Thursday slot has already been wristband-shipped or had a host hired, the cancellation flow handles the cleanup (write-off, host reassignment) — same logic as any other cancelled-by-them venue per Section 7.16.

### 9.5 Misrouted positive reply [LOCKED]

**Scenario:** Bar Opium was pitched by Kevin@contacteventsperse but replies to brian@crawlconnector.com (someone they know there from a prior campaign). The reply is positive — they're interested. But it's landed on a different alias's thread than the one they were pitched on.

**Rule: route the reply to the original pitcher's queue (Kevin). Brian can also pick it up if Kevin's unavailable. What matters is the venue gets confirmed, not who replies.**

Engine flow:

1. Engine recognizes the inbound from Bar Opium across both aliases — venue × campaign state already shows pitched by Kevin
2. Engine routes the reply to **Kevin's pending-replies queue** by default (he owns the conversation)
3. Brian also sees it in his queue as a secondary surfaced item (he might want to pick it up if he has the relationship and Kevin's tied up)
4. Either Kevin or Brian can handle it — whichever moves faster
5. The reply gets linked to Kevin's original outreach thread for clean conversation history, even if Brian sends the response

The principle: **the goal is to get the venue confirmed.** The engine doesn't get rigid about which alias handles the reply when a venue's already engaged.

### 9.6 Non-standard venue request [LOCKED]

**Scenario:** Venue asks for something outside the standard flow. Examples:
- "Can we get exclusivity?"
- "Can we charge for entry?"
- "Can we get a deposit?"
- "Can we get exclusivity on a specific genre of music?"
- "Will you guarantee a minimum attendance?"
- "Can we change the terms — we want 20% of ticket sales"
- Anything else that doesn't fit T1-T17 templates

**Rule: engine flags as "needs-attention" with no suggested response. Operator handles manually.**

The engine is not smart enough to answer non-standard requests, and trying to auto-generate responses to these would either:
- Give a wrong answer (engine doesn't know PERSE's actual position on edge cases)
- Give a vague answer that doesn't address what the venue asked
- Box PERSE into a position before an operator could review

Engine behavior:

1. Auto-classification surfaces the reply as **"question / clarification needed"** but with **NO suggested response** (Section 8.5 already covers this case — engine flags as needs-attention when it can't generate confident suggestions)
2. The reply lands in the operator's pending-replies queue with a "needs human triage" flag
3. Operator reads it, decides how to handle, drafts a response in their own voice (often with AI assist outside the engine), sends manually
4. If the request is rejected (which most non-standard requests will be per the low-buy-in principle in Section 0.1), the engine doesn't track a state change beyond logging the reply
5. If the request reveals the venue is a bad-fit going forward (e.g. "we only do events with exclusivity" — they're not a fit for PERSE's model), operator can manually mark the relationship flag or flag for soft-no

This is the natural escape valve for the small percentage of edge requests that don't fit the standard flow. PERSE handles maybe 95% of inbound replies via templates; the remaining 5% get human triage.

---

## 10. Future considerations [LOCKED]

### 10.1 Other event types — one big campaign at a time [LOCKED]

PERSE only runs **one big campaign at a time, never overlapping.** The cadence is:

| Campaign | Approximate window |
|---|---|
| Halloween (Oct 29-31) | Outreach Aug-Oct |
| New Year's Eve (Dec 31) | Outreach Nov-Dec |
| St. Patrick's Day (March 17) | Outreach Jan-Mar |

After Halloween wraps, outreach shifts entirely to NYE. After NYE wraps, outreach shifts to St. Patrick's. **No cross-campaign outreach simultaneously.**

**What this means for the engine:**

- The engine maintains the concept of an "active campaign" — there's exactly one at any time
- All outreach cadences, template selection, and worklist views are scoped to the active campaign
- When a campaign ends, the engine transitions to the next campaign — T17 (post-event thank-you + NYE re-engagement) is the bridge from one campaign to the next
- Venue records persist across campaigns; venue × campaign state is per-campaign
- Cross-campaign rules (Section 9.5 in earlier drafts — removed because campaigns never overlap operationally) don't need engine logic

**Implication for the engine's data model:** the engine should make "active campaign" a first-class concept that filters most operator views by default. Historical campaigns are accessible but the daily worklist is always "this campaign."

### 10.2 Non-English markets — not in scope [LOCKED]

PERSE does NOT pursue non-English markets (French Canada, Latin America, etc.) because the operational complexity of scheduling crawls in non-English markets is too high to justify.

This is a permanent scope decision, not a "later" decision. No translation pipeline, no multi-language templates, no per-locale variants of the cold opener.

If this changes someday, it would be a major engine project with implications beyond just translation (operator hiring, host coordination across language barriers, venue communication norms in non-English markets). Not on the roadmap.

### 10.3 A/B testing — defer to year 2, possibly [LOCKED with SME note]

Currently only one set of templates (T1-T17). A/B testing requires building parallel template variants and tracking conversion rate by variant.

**Operator's lean:** too complex for the first Halloween 2026 campaign; revisit next year unless SME advice says otherwise.

**SME perspective (push-back you asked for):**

Honestly, **the operator's lean is correct** for Halloween 2026. Here's the case for waiting:

1. **You don't yet know what your baseline conversion rate is.** A/B testing without a baseline gives you relative numbers but no anchor — you'd know variant B is 8% better than variant A, but not whether either is good in absolute terms.
2. **Sample sizes for statistical significance.** A/B testing email outreach requires hundreds of touches per variant to get a confident signal. For Halloween 2026 your cold outreach volume per city is probably 20-80 venues. Not enough for variant-level statistical confidence.
3. **The single biggest conversion lever is the LOW-BUY-IN PRINCIPLE** (Section 0.1) — not template wording. Once the principle is dialed in (which it is), template wording variations give marginal returns.
4. **Operator time and engine complexity are scarce.** Spending Halloween 2026 building the A/B framework competes with spending it building the SMS infrastructure, the cancelled-venues table, the worklist surface, etc. Higher-leverage features.

**What I'd do INSTEAD of A/B testing for Halloween 2026:**

- Track per-template conversion rates passively (engine already does this via the cadence + reply classification system)
- After Halloween, review which templates ghosted most often, look at qualitative reasons, manually iterate the template for the next campaign
- Build proper A/B testing infrastructure for **Halloween 2027** when you have year-1 baseline data, year-1 manual iteration, and proper sample sizes from multi-city scale

**Phase 2/3 build item:** A/B testing infrastructure — multiple template variants per touchpoint, random assignment per send, conversion tracking per variant, statistical significance reporting. Build when there's data baseline + capacity.

### 10.4 Autonomous AI sending — eventually, with conditions [LOCKED]

For Halloween 2026: **every outreach send goes through operator review.** No exceptions for outreach emails to venues. The few auto-fires (host SMS H1-H5, lineup-change SMS, payment confirmation SMS) are not "outreach" — they're transactional notifications to paid contractors.

**Future state:** if the engine is proven over multiple campaigns AND deliverability is not impacted, autonomous AI sending of outreach emails could be considered.

**Conditions before considering autonomous outreach:**

1. **Proven track record** — multiple campaigns where engine-drafted templates have been sent (with operator review) and shown not to cause venue complaints, brand damage, or unusual reply patterns
2. **Deliverability stability** — autonomous sending often increases spam-scoring risk because it removes the human-paced sending rhythm Gmail/Outlook reward. If autonomous sending degrades deliverability (more spam folder placement, more bounces), it's not worth the operator-time savings.
3. **Compliance review** — if engine starts auto-sending without human approval, GDPR/CASL/CAN-SPAM rules about "automated marketing" become applicable in ways they aren't today (Section 0.5)
4. **Clear scope** — even when autonomous sending is enabled, it would be scoped to specific low-risk touchpoints (e.g. cadence-driven follow-up nudges with no custom content), not the full template pack

**Most likely first candidate for autonomous send:** cadence follow-up nudges in the cold sequence (touches 2 and 3) where the content is fully templated, no venue-specific customization needed, and the operator's review adds little value. Even this is a year-2+ decision.

### 10.5 Multi-language operator UI — never [LOCKED]

PERSE only hires English-speaking operators because PERSE staff are English-speaking. The operator UI stays English-only.

This is a permanent scope decision. If PERSE ever hires non-English-speaking staff, the engine UI's language is the smaller of the two problems — operational comms, training docs, and team coordination would all need to shift first.

### 10.6 Mobile operator app — future, not now [LOCKED]

Operators currently work from desktop. A mobile operator app would be useful day-of (when operators are physically at crawls, not at desks) but isn't a Halloween 2026 priority.

**Future-state value:**
- Day-of crawl monitoring without needing to be at a desk
- Real-time call logging from the field (currently desktop-bound)
- Host-manager use case — host manager is moving between venues on the night; mobile would let them log host arrivals, flag issues without going back to a desk

**Phase 2/3 build item:** Mobile operator app — read-only first (view worklist, log calls, mark hosts as arrived), eventually send-capable. Build after the desktop engine is stable and the SMS infrastructure is live.

For Halloween 2026, operators work from desktop. The engine's responsive design should be acceptable on mobile browsers as a stopgap (operators can use phones in a pinch), but no dedicated mobile app.

---

## 11. Phase 2 engine build items

Items captured from this doc that should land on the engine roadmap, not the reference doc itself:

1. **Graphics tracker** — designer worklist + per-venue × campaign state (ready to be made / made / sent). Section 7.3.
2. **Info sheet generation tracker** — per-crawl × night, same workflow as graphics tracker. Section 7.4.
3. **Full call logging on venue detail page** — currently partial via OpenPhone integration; needs every call logged with outcome + operator + notes + timestamp. Section 6.8.
4. **Operator daily worklist surface** — "my drafts to review," "my pending replies," "my follow-ups due." Section 7.1.
5. **Per-venue × per-domain relationship flag** — auto-set from inbound signals + manual operator override; 1-year auto-decay. Section 3.3.
6. **Call → email auto-fire** — when call outcome is "send me the email," engine fires next template immediately, bypassing cadence floor. Section 6.7.
7. **Outstanding calls alongside outstanding emails on daily worklist** — operators currently only see email queue. Section 6.8.
8. **Call attempt counter on venue page** — visible signal showing "called N times, last attempt X days ago, last outcome was Y." Section 6.8.
9. **Cancellation review queue** — Tuesday + Wed/Thu auto-surfacing of candidate crawls during event week. Section 7.9.
10. **Auto-deflated turnout phrase generation** — engine pulls priority + slot type + current ticket count, returns the right phrase with wave qualifier appended. Section 5.
11. **Amazon tracking integration** — auto-import tracking numbers and delivery status into the engine; surface shipping risk on campaign dashboard. Section 7.12.
12. **Subject rotation for cold sequences** — engine generates touch 1 / touch 2 / touch 3 subject variants automatically to avoid Gmail's repeat-subject spam scoring. Section 10 (in main doc structure; covered by ops in this section).
13. **Host tracker** — per-city × host-type rate sheet inside the engine. Operators reference when hiring; Brandon references when paying. Section 7.13.2.
14. **Host re-confirmation reminders** — engine surfaces "host hired N days ago, hasn't been touched, event in M days" prompts to operators. Section 7.13.4.
15. **Host payment workflow as first-class engine surface** — Brandon's worklist of "hosts awaiting payment," one-click mark-paid flow, payment-method tracking with encrypted destination details. Section 7.13.7.
16. **Host reliability tracking** — per-host no-show count, lateness, performance feedback across multiple events. Section 7.13.8.
17. **Automated external host check-in cadence (H1-H5)** — 5-touch SMS sequence from 1 week out through arrival confirmation. Section 7.14.2.
18. **Single venue confirmation touch (V1)** week-of for internal-host cities. Section 7.14.3.
19. **Host arrival escalation flow** — when a check-in milestone fails, engine pages the host manager. Section 7.14.2.
20. **Host briefing flow (H0a + H0b)** — two-stage email briefing for external hosts; H0a at hire time, H0b week-of with operational details. Section 7.13.9.
21. **Twilio SMS infrastructure + A2P 10DLC registration** — foundation for host SMS and any future engine-side SMS use cases. Local long-code number(s) per region, inbound webhook for replies, STOP handling, consent log.
22. **Engine lineup state read-API** — stable feed exposing current confirmed lineup per crawl × night. Consumed by Smart Map (re-pointing from Google Sheets source) and Eventbrite push (re-pointing from web-form source). Section 0.7.
23. **Engine lineup change events (pub/sub)** — emits on confirm/swap/cancel. Subscribed to by Smart Map for real-time map updates and by the host SMS service for H-cadence lineup-change updates. Section 0.7.
24. **Eventbrite push integration** — operator-triggered (or auto-triggered) push of lineup info into Eventbrite event description via Eventbrite API. Revises the existing web-form-source version. Section 0.7.
25. **Lineup-change SMS to working hosts** — when lineup changes between H0b and event, engine fires brief diff SMS to the host(s) working that crawl. Section 7.13.9.
26. **Post-event relationship-flag prompt** — engine asks operators to flag each venue's event outcome (Good / Neutral / Bad) after each event. Drives T17 gating and future re-engagement decisions. Section 7.15.3.
27. **Host payment confirmation SMS** — when Brandon marks a host as paid, engine auto-sends confirmation SMS with payment details and reference number. Section 7.15.5.
28. **Cross-campaign venue state transitions** — engine moves venues between campaign states based on T17 replies (confirmed-for-nye / declined-nye-2026 / cold-outreach-nye / cooldown). Section 7.15.6.
29. **Post-event host SMS** — short single-question SMS to external hosts day-after asking distribution count; optional second message asking if anything to flag. Section 7.15.4a.
30. **Operator debrief notes field** — per crawl × night free-text notes operators fill in within a week of the event. Surfaces on campaign retrospective view. Section 7.15.4a.
31. **Emergency replacement mode** — operator-triggered emergency mode that surfaces curated candidate venues, batch-drafts T8s, suspends cross-domain cadence floors for the affected slot, prioritizes incoming replies. Section 7.16.3.
32. **Cancellation alert fan-out** — when a venue is detected as cancelled-by-them (auto from inbound reply or manual flag), engine sends parallel notifications to original confirmer, Bryle, host manager, Brandon, graphics designer, campaign manager. Multi-channel (in-app + email + SMS + phone call) with urgency tiers scaling with cancellation timing. Acknowledgment tracking with auto-escalation if owners don't respond in window. Section 7.16.8.
33. **Cancelled By Venue dedicated table** — separate per-campaign table from warm-leads, tracking acknowledgments + operational tails (shipping write-off, host reassignment, relationship flag, replacement venue). Section 7.16.10.
34. **Effective priority computation** — `lib/effective-priority.ts` combining static priority + current ticket sales + days-to-event into an adjusted priority. Wires into worklist + cold-outreach table sorting starting at day -21 of each event. Cities with sales get bumped up; cities with 0 sales near the event get bumped down. Section 1.6.
35. **V2-call task (floor-staff confirmation)** — engine adds a "V2-call" task to the host manager's daily worklist 4 days before each event for every confirmed venue. Phone call to frontline staff (not manager). Tracks call attempts + outcomes. Surfaces `floor_staff_briefed_at` on the event-day readiness view. Section 7.14.3a.
36. **Operator daily worklist surface** — the primary operator surface organized into "drafts to review," "pending replies," "follow-ups due," "calls to make," "host check-ins," "venues needing attention." Section 8.2.
37. **Auto-classification of inbound replies with confidence scoring** — engine reads inbound replies, applies one of 7 classifications with a 0-100% confidence score. Thresholds determine auto-action vs. operator-flag. Logs original classification + override for misclassification review. Section 8.3 / 8.4.
38. **Suggested response drafts** for free-text questions — engine reads venue's question, generates suggested response based on template context + venue record + reference doc rules. Operator reviews + sends. Section 8.5.
39. **Template auto-pick with one-click override** — engine picks the right template based on context (cold/warm, slot detail, big/specific ask, confirmation/lifecycle stage, post-event), operator can swap to a compatible template in one click. Section 8.7.
40. **Misclassification review surface** — admin view showing classification overrides operators have made; lets PERSE iterate on the classifier over time. Section 8.4.
41. **A/B testing infrastructure** — multiple template variants per touchpoint, random assignment per send, conversion tracking per variant, statistical significance reporting. Defer to year 2 once year-1 baseline data exists and PERSE has multi-city scale for proper sample sizes. Section 10.3.
42. **Mobile operator app** — read-only first (view worklist, log calls, mark hosts as arrived), eventually send-capable. Important for host manager use cases (moving between venues on event night). Phase 3 priority. Section 10.6.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Wristband venue** | The check-in venue for a crawl. Hosts the wristband distribution (manual via host/staff, or self-serve table). Always 1 per crawl. |
| **Middle venue** (also "participating venue") | A stop on the crawl during the middle slot. Shares its time window with 2-3 other middle venues in larger crawls. |
| **Final venue** | The closing venue where the crowd congregates late in the night. Higher turnout than middle venues. |
| **Day party** | Saturday Oct 31 afternoon variant. 1-8 PM, smaller slot structure (wristband + participating only, no final). |
| **External host** | Person PERSE hires from job sites to staff a wristband venue. Default for Prio 1-3 cities. |
| **Internal staff host** | The venue's own staff member, paid by PERSE via the venue, to hand out wristbands. Default for Prio 4-6 cities; Prio 1-3 fallback. |
| **No-host / table-only** | Final fallback when neither host model works. Self-serve wristband table at the venue with a printed PDF poster. |
| **Cold cadence** | The 3-touch sequence before any venue reply: opener + nudge (+5d) + closer (+7d). |
| **Warm cadence** | The post-engagement sequence after a venue replies: up to 3 in-thread nudges at +4/+5/+7 days. |
| **Stalled-warm** | Venue engaged once then ghosted through warm-cadence nudges. Rests for the campaign; auto-clears next campaign. |
| **Cross-domain handoff** | After a 3-touch cold sequence exhausts, a different alias/domain can pick up after 7-day cooldown. |
| **Soft no** | "Not this year" / "we're booked" — opt-out THIS campaign only, freely re-pitched next campaign. |
| **Hard no** | "Remove us" / "stop emailing" — permanent opt-out across ALL campaigns. Manual clear only. |
| **Cancelled-by-us** | State after T16 sends. Venue is neutral (not bad), freely available for next campaign. |
| **The lineup** | The full set of venues confirmed for a given crawl × night. Considered fluid until ~2 weeks out. |
| **The 70-80% rule** | 70-80% of ticket sales happen the day before the event. Drives cancellation timing, turnout-quote rules, sales-update logic. |
| **Wave qualifier** | The mandatory clause "in waves or small groups of 5 to 10 at a time, not all at once" appended to every turnout quote. Section 5.1. |
| **T1-T8** | Cold outreach templates (in the existing Halloween template pack). |
| **T9-T16** | Post-confirm and lifecycle templates (defined in this doc). |
| **T17** | Post-event thank-you + NYE re-engagement template. Sent 2 days post-event. Includes NYE slot details inline to capitalize on the warm-mood window. Section 7.15.1. |
| **Bryle** | Staff member who coordinates the post-confirm lifecycle (T10, T11, primary on T13/T14). |
| **Brandon** | Admin staff member responsible for processing payments to internal staff and to hosts (both external and internal). Owns the post-event payment workflow. |
| **Host manager** | The PERSE operator (often Bryle or another assigned operator per city) who coordinates with hosts on the night — confirms arrival, handles live issues, acts as the escalation contact. Human role, not engine-replaceable. |
| **H0a** | The hiring confirmation email sent to an external host immediately at hire. Locks them in. Light on details (lineup not known yet). |
| **H0b** | The operational briefing email sent to an external host early in the week of the event. Contains wristband venue address, lineup, image, host manager contact. |
| **H1-H5** | The 5-touch automated external host SMS check-in cadence: 1 week out, 2 days out, 5 hours before shift, 1 hour before shift, arrival confirmation. Failures escalate to host manager. |
| **V1** | The single venue confirmation email to internal-host cities (Prio 4-6) sent Monday/Tuesday of event week. |
| **Smart Map** | The attendee-facing crawl map page. Reads from the outreach engine. Hosts the opt-in SMS signup. Drives real-time attendee broadcasts. Separate design spec. |
| **Eventbrite push** | Engine integration that updates Eventbrite event descriptions with current lineup data. Separate design spec. |
| **Source of truth** | The outreach engine is the canonical source for "who is confirmed for which crawl × night × slot." All other systems consume this data; no system maintains a parallel copy. |
| **Primary + backup host** | For external-host cities, PERSE always hires TWO external hosts so a no-show by one is covered by the other. Both get paid (post-event) only if they actually showed; the table fallback covers if both flake. |

---

*End of working draft. Continue interview to fill remaining sections.*

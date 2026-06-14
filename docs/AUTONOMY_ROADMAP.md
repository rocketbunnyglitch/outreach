# Autonomy Roadmap — toward one overseer

> Operator goal (2026-06-14): evolve the engine so it self-automates and
> continuously improves through staff interaction, until a single person
> oversees an operation that is mostly running itself — including, where the
> data proves it safe, the calls.

## The end state, stated honestly

The realistic target is **one overseer**, not zero humans. That person:
ratifies what the system proposes, handles genuine exceptions, and tends the
high-value relationships. Everything routine — drafting, sending, following up,
triaging, learning, self-correcting — runs on its own and gets better every
week from how the team interacts with it. "Perfect" is asymptotic; the goal is
"a human only does what genuinely needs a human."

## Governing principle: autonomy is *earned*, per task, and *fenced*

The system never promotes itself. Each capability climbs an **autonomy ladder**,
and each rung is unlocked only by **measured evidence**, never a guess. Three
walls hold at every rung and are never optimized away:

1. **The values guardrail** (shipped) — honesty/turnout deflation, brand
   isolation, no hallucinated fields. Learning operates inside these walls.
2. **The anti-silence monitor** (shipped) — nothing may silently do nothing;
   every automated component proves it's alive.
3. **Human-confirm on irreversible** — a venue flipping to `confirmed`, money,
   anything you can't take back, stays a human click (never-do #5). The system
   tees the decision up; it doesn't take it.

### The ladder (every task class climbs these five rungs)

| Rung | Meaning |
|---|---|
| 1. Manual | A human does it. |
| 2. Assisted | The engine drafts/suggests; a human does it. |
| 3. Supervised-auto | The engine does it; a human reviews **every** one before it takes effect. |
| 4. Exception-auto | The engine does and commits; a human reviews only **flagged / low-confidence** ones. |
| 5. Audited-auto | The engine does it; a human **audits samples** and handles true exceptions. ← the "one overseer" state. |

### Where each capability sits today

- **Cold/warm email sending** — rung 3 (engine drafts every touch; humans send).
- **Template library** — rung 2→3 (engine proposes new + improved templates; humans promote). *Shipped this session.*
- **Reply classification / triage** — rung 3–4 (auto-classifies; humans correct; corrections feed learning).
- **Cadence timing** — rung 3 (engine schedules the draft; humans send).
- **Lifecycle T9–T17** — rung 3 (engine drafts the whole chain; humans send).
- **Calls (V2 / floor-staff)** — rung 1–2 (humans call; engine schedules + logs).
- **Self-correction** — rung 4 (anti-silence flags; humans fix). *Shipped this session.*

The job below is to walk each of these up the ladder, safely.

---

## Phases

### Phase A — Trust instrumentation *(mostly shipped; finish it)*
You cannot grant autonomy you can't measure. Make every autonomous decision
scored and comparable.
- ✅ Anti-silence meta-monitor; ✅ values guardrail; ✅ template-proposal engine
  with weekly cron + notifications.
- **Build:** a per-decision **confidence score** on every engine draft (template
  fit, recipient validity, cadence certainty, classification confidence). And a
  **shadow ledger** — record, for each touch, what the engine *would* do vs what
  the human actually did, so agreement can be measured before any autonomy is
  granted. This ledger is the evidence base for Phase D.

### Phase B — Outcome spine *(partial; completes as the season produces data)*
Upgrade learning from the email proxy ("did they reply") to the business
outcome ("did this make a good crawl").
- ✅ The proposal engine already learns from **confirmations**, not just replies;
  `/admin/learning` already computes confirm-by-template, priority-band
  conversion, and venues-to-reuse/avoid (the rebooking signal).
- **Build:** complete the chain — send → reply → confirm → **actual turnout** →
  **rebook next campaign** — as one attributed record per decision. Turnout
  feeds back only once events run (October); the rest is wireable now.

### Phase C — Doc-as-hypothesis + human-ratified tuning *(season-gated)*
Treat the reference doc's constants as hypotheses the data tests.
- **Build:** a "doc vs reality" panel — does P1 actually confirm/turn out higher
  than P4 as §5.2 assumes? Are 7-day follow-ups out-pulling 5-day? Where reality
  diverges, the system **proposes** a parameter change (pitch number, cadence
  offset, cap) with the evidence; the overseer ratifies. Same engine-proposes /
  human-decides pattern as templates. Fenced by the guardrail.

### Phase D — Graduated autonomous sending *(the biggest lever)*
Walk email sending from rung 3 to rung 4. Each step is unlocked by the shadow
ledger (Phase A) showing high agreement, zero guardrail breaches, and healthy
deliverability.
- **D1 — Shadow mode:** the engine selects + would-send, logs the choice, sends
  nothing. Run for weeks; measure how often the human would have sent the same
  thing.
- **D2 — Tier-1 auto-send:** auto-send only the safest class first — e.g. a cold
  T1 to a ZeroBounce-valid address, confidence above threshold, inside the send
  window, under the daily cap, no relationship/brand flag — where D1 agreement
  was high. Everything else still reviewed.
- **D3 — Expand tiers:** graduate more touch types as each proves out (warm
  replies and anything sensitive stay human longest; lifecycle touches graduate
  by type).
- **D4 — Exception-only:** most sends auto-commit; the human reviews only
  low-confidence or flagged ones. This is rung 4 for sending.
- This is the `AUTONOMY_DISPATCH_ENABLED` flag, earned in stages instead of
  flipped blind. Deliverability and brand reputation are hard ceilings the whole
  way — autonomy never sends past them.

### Phase E — The calls
- **E1 — Call assist:** AI-drafted call scripts per venue + stage, one-tap dial,
  auto-logged outcomes, smart "best time to call" scheduling. (Quo wiring
  exists; activate + enrich.)
- **E2 — Channel substitution:** measure whether an async touch (SMS/email)
  converts as well as the V2 call for each segment. Where the data says yes,
  convert it — shrinking the call load without losing confirmations.
- **E3 — AI voice (frontier, honestly):** for the most scripted calls
  (confirmations, day-before reminders), an AI voice agent is now technically
  feasible — but it's a real leap with real risk. Pilot tiny, human-audited,
  and only if E2 shows calls still matter where async didn't. Promised as a
  *possibility to earn*, not a given.

### Phase F — Confidence routing + the overseer console
- **Build:** route by confidence — everything the system is sure about flows
  automatically; only genuine exceptions (ambiguous replies, escalations,
  anomalies, low-confidence drafts) surface to a human.
- **Build the overseer console:** the single screen the one staffer lives in —
  *what the system did today, what's waiting on a human, what's drifting, what
  it's unsure about.* `/admin/command` is the seed of this.

### Phase G — Self-healing operations
Graduate the anti-silence monitor from **flag** to **fix** for safe, known
failures: prompt a re-auth when an inbox dies, refresh a stale cache, re-run a
failed job, defer a capped send. The human is left with only novel failures.

### Phase H — Steady-state self-improvement
The loop runs unattended: interact → learn → propose → ratify → measure → tune.
The system runs a **completeness critic** on itself ("what am I still getting
wrong — which segment underperforms, which template is stale, which assumption
broke?") and turns the answer into the next round of proposals. The overseer's
week becomes: ratify proposals, handle exceptions, tend relationships.

---

## What stays human, permanently

- **Confirming a venue** (the irreversible flip) — teed up, never taken.
- **The high-value relationship moments** — a key venue, a delicate
  negotiation, a complaint. The system hands these to the human with full
  context.
- **Ratifying changes to the values/strategy** — the guardrails and the doc's
  non-negotiables change only by human decision.

## How we know it's working (the gates between phases)

Advance a capability a rung only when, over a real window: shadow agreement is
high, the values guardrail logged zero breaches, deliverability/reputation held,
and the outcome metric (confirmations, good crawls) did not drop. If any gate
fails, hold — autonomy is reversible and earned, never assumed.

---

## Status at authoring (2026-06-14)
- Phase A: ~70% (monitor + guardrail + proposal engine shipped; confidence
  score + shadow ledger to build).
- Phase B: ~50% (confirm/reuse learning live; turnout attribution season-gated).
- Phases C–H: designed, not built; D and E are the highest-leverage next work
  but several steps are gated on the shadow ledger (A) and season data (B).

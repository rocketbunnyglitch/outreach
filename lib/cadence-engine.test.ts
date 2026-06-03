import {
  CROSS_DOMAIN_FLOOR_DAYS,
  addDays,
  checkFloors,
  planFromState,
  terminalStateFor,
} from "@/lib/cadence-engine-core";
import { describe, expect, it } from "vitest";

// Fixed base instant so the timing assertions are deterministic.
const T0 = new Date("2026-10-01T12:00:00Z");

describe("planFromState cold sequence [ReferenceDoc 6.1]", () => {
  it("cold touch 1 sent -> next is touch 2 at +5 days", () => {
    const plan = planFromState("cold_sent_touch_1", T0);
    expect(plan?.touchKind).toBe("cold_touch_2");
    expect(plan?.stateAfterSend).toBe("cold_sent_touch_2");
    expect(plan?.earliestAllowedSendAt.getTime()).toBe(addDays(T0, 5).getTime());
  });

  it("cold touch 2 sent -> next is touch 3 at +7 days", () => {
    const plan = planFromState("cold_sent_touch_2", T0);
    expect(plan?.touchKind).toBe("cold_touch_3");
    expect(plan?.stateAfterSend).toBe("cold_sent_touch_3");
    expect(plan?.earliestAllowedSendAt.getTime()).toBe(addDays(T0, 7).getTime());
  });

  it("cold touch 3 sent -> no further touch (exhausted)", () => {
    expect(planFromState("cold_sent_touch_3", T0)).toBeNull();
    expect(terminalStateFor("cold_sent_touch_3")).toBe("cold_exhausted_ready_for_handoff");
  });

  it("first touch carries the opener stage hint", () => {
    expect(planFromState("cold_pending_touch_1", T0)?.stageHint).toBe("first_touch");
  });
});

describe("planFromState warm nudges [ReferenceDoc 6.4]", () => {
  it("nudge 1 sent -> nudge 2 at +5 days", () => {
    const plan = planFromState("warm_nudge_1_sent", T0);
    expect(plan?.touchKind).toBe("warm_nudge_2");
    expect(plan?.earliestAllowedSendAt.getTime()).toBe(addDays(T0, 5).getTime());
  });

  it("nudge 3 sent -> stalled-warm (exhausted)", () => {
    expect(planFromState("warm_nudge_3_sent", T0)).toBeNull();
    expect(terminalStateFor("warm_nudge_3_sent")).toBe("stalled_warm");
  });
});

describe("checkFloors [ReferenceDoc 6.2 + 6.3]", () => {
  it("cross-domain floor: brand A 4 days ago -> brand B blocked, allowed at +3 days", () => {
    const now = T0;
    const r = checkFloors({
      totalTouchCount: 1,
      hardCap: 6,
      mostRecentCrossDomainTouchAt: addDays(now, -4),
      now,
    });
    expect(r.allowed).toBe(false);
    expect(r.crossDomainFloorMet).toBe(false);
    expect(r.hardCapReached).toBe(false);
    // earliest = (now - 4d) + 7d = now + 3d
    expect(r.earliestAllowedAt?.getTime()).toBe(addDays(now, 3).getTime());
  });

  it("cross-domain floor met once 7 days have passed", () => {
    const now = T0;
    const r = checkFloors({
      totalTouchCount: 2,
      hardCap: 6,
      mostRecentCrossDomainTouchAt: addDays(now, -CROSS_DOMAIN_FLOOR_DAYS),
      now,
    });
    expect(r.crossDomainFloorMet).toBe(true);
    expect(r.allowed).toBe(true);
  });

  it("hard cap: 6 touches already logged -> blocked even cross-domain", () => {
    const r = checkFloors({
      totalTouchCount: 6,
      hardCap: 6,
      mostRecentCrossDomainTouchAt: null,
      now: T0,
    });
    expect(r.hardCapReached).toBe(true);
    expect(r.allowed).toBe(false);
  });

  it("no prior cross-domain touch -> floor met", () => {
    const r = checkFloors({
      totalTouchCount: 0,
      hardCap: 6,
      mostRecentCrossDomainTouchAt: null,
      now: T0,
    });
    expect(r.crossDomainFloorMet).toBe(true);
    expect(r.allowed).toBe(true);
  });
});

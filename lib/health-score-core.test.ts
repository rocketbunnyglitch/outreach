import {
  type CrawlHealthInput,
  campaignHealthFromInputs,
  cityHealthFromInputs,
  crawlHealthFromInputs,
  staffWorkloadHealthFromInputs,
  venueHealthFromInputs,
} from "@/lib/health-score-core";
import { describe, expect, it } from "vitest";

/** A fully-staffed, healthy standard crawl, well before the event. Tests
 *  override only the fields they care about. */
function baseCrawl(over: Partial<CrawlHealthInput> = {}): CrawlHealthInput {
  return {
    eventStatus: "confirmed",
    crawlFormat: "standard",
    ticketsSold: 0,
    daysToEvent: 30,
    wristbandRequired: 1,
    wristbandFilled: 1,
    middleRequired: 2,
    middleFilled: 2,
    finalRequired: 1,
    finalFilled: 1,
    ...over,
  };
}

describe("crawlHealthFromInputs -- Phase 2 acceptance criteria", () => {
  // 1. High-sales crawl missing final becomes red/yellow risk.
  it("high sales + missing final is a risk (red), viability sales_strong_lineup_weak", () => {
    const h = crawlHealthFromInputs(
      baseCrawl({ ticketsSold: 40, finalFilled: 0, daysToEvent: 14 }),
    );
    expect(h.viability).toBe("sales_strong_lineup_weak");
    expect(["red", "yellow"]).toContain(h.color);
    expect(h.color).toBe("red");
    expect(h.nextAction).toBe("Prioritize final venue calls today");
  });

  // 2. Low-sales 4 weeks out does NOT falsely mark cancellation.
  it("low sales 4 weeks out is not a cancellation candidate", () => {
    const h = crawlHealthFromInputs(baseCrawl({ ticketsSold: 2, daysToEvent: 28 }));
    expect(h.viability).not.toBe("cancellation_review");
    expect(h.viability).not.toBe("likely_cancellation");
    expect(h.color).not.toBe("red");
  });

  // 3. Tuesday of event week with 0 sales triggers cancellation review.
  it("zero sales ~4 days out triggers cancellation review (red)", () => {
    const h = crawlHealthFromInputs(baseCrawl({ ticketsSold: 0, daysToEvent: 4 }));
    expect(h.viability).toBe("cancellation_review");
    expect(h.color).toBe("red");
    expect(h.nextAction).toBe("Run cancellation review");
    expect(h.blockers.join(" ")).toMatch(/cancellation/i);
  });

  // 4. 11+ tickets Wed/Thu leans run, not auto-cancel.
  it("11+ tickets ~2-3 days out leans run, never cancellation", () => {
    const wed = crawlHealthFromInputs(baseCrawl({ ticketsSold: 12, daysToEvent: 3 }));
    expect(wed.viability).toBe("likely_to_run");
    expect(wed.viability).not.toBe("cancellation_review");

    const thu = crawlHealthFromInputs(baseCrawl({ ticketsSold: 11, daysToEvent: 2 }));
    expect(thu.viability).toBe("likely_to_run");
    expect(thu.color).toBe("green");
  });

  // 5. Missing wristband event week is red.
  it("missing wristband inside the event week is red + blocker", () => {
    const h = crawlHealthFromInputs(
      baseCrawl({ wristbandFilled: 0, ticketsSold: 25, daysToEvent: 5 }),
    );
    expect(h.color).toBe("red");
    expect(h.blockers.some((b) => /wristband/i.test(b))).toBe(true);
    expect(h.nextAction).toBe("Confirm a wristband venue");
  });

  // 6. Completed crawl with all readiness checks is green.
  it("completed crawl is green / viability completed", () => {
    const h = crawlHealthFromInputs(baseCrawl({ eventStatus: "completed", daysToEvent: -1 }));
    expect(h.viability).toBe("completed");
    expect(h.color).toBe("green");
    expect(h.statusLabel).toBe("Completed");
  });
});

describe("crawlHealthFromInputs -- supporting behavior", () => {
  it("a far-out crawl with an unbooked lineup is too early to judge (green, not noise)", () => {
    // 142 days out, nothing booked, no sales -- the real state right after a
    // campaign is scheduled. An empty lineup this early is EXPECTED, so it must
    // stay green and NOT flood the command center as "needs attention".
    const h = crawlHealthFromInputs(
      baseCrawl({ daysToEvent: 142, wristbandFilled: 0, middleFilled: 0, finalFilled: 0 }),
    );
    expect(h.viability).toBe("too_early_to_judge");
    expect(h.color).toBe("green");
    expect(h.blockers).toHaveLength(0);
    expect(h.reasons).toHaveLength(0);
  });

  it("a strong seller with a lineup gap is flagged even when far out", () => {
    // The exception to the far-out rule: real demand + an empty slot = urgent.
    const h = crawlHealthFromInputs(
      baseCrawl({ daysToEvent: 60, ticketsSold: 40, finalFilled: 0 }),
    );
    expect(h.viability).toBe("sales_strong_lineup_weak");
    expect(h.color).toBe("red");
    expect(h.nextAction).toBe("Prioritize final venue calls today");
  });

  it("an unbooked crawl inside the booking window needs attention", () => {
    // 21 days out with an empty lineup -- now it's time to act.
    const h = crawlHealthFromInputs(
      baseCrawl({ daysToEvent: 21, wristbandFilled: 0, middleFilled: 0, finalFilled: 0 }),
    );
    expect(h.viability).toBe("needs_attention");
    expect(h.color).toBe("yellow");
  });

  it("day_party format never flags a missing final", () => {
    const h = crawlHealthFromInputs(
      baseCrawl({
        crawlFormat: "day_party",
        finalRequired: 0,
        finalFilled: 0,
        ticketsSold: 40,
        daysToEvent: 5,
      }),
    );
    expect(h.blockers.some((b) => /final/i.test(b))).toBe(false);
    expect(h.reasons.some((r) => /final/i.test(r))).toBe(false);
  });

  it("a confirmed crawl with a readiness blocker surfaces it and the call CTA", () => {
    const h = crawlHealthFromInputs(
      baseCrawl({
        ticketsSold: 25,
        daysToEvent: 3,
        readinessBlocker: true,
        readinessBlockerReason: "Floor-staff briefing call still pending -- event 3d out.",
      }),
    );
    expect(h.blockers).toContain("Floor-staff briefing call still pending -- event 3d out.");
    expect(h.color).toBe("red");
    expect(h.nextAction).toBe("Complete the floor-staff briefing call");
  });

  it("cancelled crawl is red with a replacement CTA", () => {
    const h = crawlHealthFromInputs(baseCrawl({ eventStatus: "cancelled" }));
    expect(h.viability).toBe("cancelled");
    expect(h.color).toBe("red");
    expect(h.statusLabel).toBe("Cancelled");
  });
});

describe("cityHealthFromInputs", () => {
  it("a city with a red crawl + stale leads is yellow/red and inherits the worst action", () => {
    const redCrawl = crawlHealthFromInputs(
      baseCrawl({ ticketsSold: 62, finalFilled: 0, daysToEvent: 5 }),
    );
    const okCrawl = crawlHealthFromInputs(baseCrawl({ ticketsSold: 30, daysToEvent: 5 }));
    const city = cityHealthFromInputs({
      crawls: [redCrawl, okCrawl],
      totalTicketsSold: 92,
      staleWarmLeads: 2,
    });
    expect(["yellow", "red"]).toContain(city.color);
    expect(city.reasons.some((r) => /stale/i.test(r))).toBe(true);
    expect(city.reasons.some((r) => /92 tickets/.test(r))).toBe(true);
    expect(city.nextAction).toBe("Prioritize final venue calls today");
  });

  it("a city of all-green crawls is green", () => {
    const good = crawlHealthFromInputs(baseCrawl({ eventStatus: "completed", daysToEvent: -1 }));
    const city = cityHealthFromInputs({ crawls: [good, good], totalTicketsSold: 200 });
    expect(city.color).toBe("green");
  });
});

describe("venueHealthFromInputs", () => {
  it("a do-not-contact venue is red and gives no next action", () => {
    const h = venueHealthFromInputs({ relationshipFlag: "do_not_contact" });
    expect(h.color).toBe("red");
    expect(h.statusLabel).toBe("Do not contact");
    expect(h.nextAction).toBeNull();
  });

  it("a confirmed venue missing night-of contact is blocked", () => {
    const h = venueHealthFromInputs({ confirmationStage: "confirmed", missingContact: true });
    expect(h.blockers.some((b) => /night-of contact/i.test(b))).toBe(true);
    expect(h.nextAction).toBe("Add a night-of contact");
    expect(h.color).toBe("red");
  });

  it("a clean confirmed venue is green", () => {
    const h = venueHealthFromInputs({ confirmationStage: "confirmed" });
    expect(h.color).toBe("green");
  });

  it("a stale venue is flagged for follow-up", () => {
    const h = venueHealthFromInputs({ isStale: true });
    expect(h.nextAction).toBe("Follow up -- this venue is going stale");
    expect(h.color).not.toBe("green");
  });
});

describe("campaignHealthFromInputs", () => {
  it("rolls up city colors and surfaces the worst city action", () => {
    const cancelCrawl = crawlHealthFromInputs(baseCrawl({ ticketsSold: 0, daysToEvent: 4 }));
    const redCity = cityHealthFromInputs({
      crawls: [cancelCrawl, cancelCrawl, cancelCrawl],
      totalTicketsSold: 0,
    });
    const greenCity = cityHealthFromInputs({
      crawls: [crawlHealthFromInputs(baseCrawl({ eventStatus: "completed", daysToEvent: -1 }))],
      totalTicketsSold: 100,
    });
    const camp = campaignHealthFromInputs({ cities: [redCity, greenCity] });
    expect(camp.reasons.some((r) => /at risk/i.test(r))).toBe(true);
    expect(camp.nextAction).toBe("Run cancellation review");
  });
});

describe("staffWorkloadHealthFromInputs", () => {
  it("overdue tasks are a red blocker with a clear CTA", () => {
    const h = staffWorkloadHealthFromInputs({ openTasks: 8, overdueTasks: 3 });
    expect(h.color).toBe("red");
    expect(h.blockers.some((b) => /overdue/i.test(b))).toBe(true);
    expect(h.nextAction).toBe("Clear overdue tasks");
  });

  it("a heavy-but-current load is yellow", () => {
    const h = staffWorkloadHealthFromInputs({ openTasks: 20, overdueTasks: 0 });
    expect(h.color).toBe("yellow");
    expect(h.nextAction).toBe("Rebalance or delegate workload");
  });

  it("a light, current load is green", () => {
    const h = staffWorkloadHealthFromInputs({ openTasks: 4, overdueTasks: 0 });
    expect(h.color).toBe("green");
    expect(h.nextAction).toBeNull();
  });
});

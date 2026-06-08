import { describe, expect, it } from "vitest";
import { compareByEngagementDesc, scoreEngagement } from "./engagement-score";

const NOW = new Date("2026-06-08T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("scoreEngagement", () => {
  it("a silent venue scores 0 / cold", () => {
    const r = scoreEngagement({ replyCount: 0, now: NOW });
    expect(r.score).toBe(0);
    expect(r.band).toBe("cold");
  });

  it("an 'interested' venue that replied 2 days ago outranks a silent one (acceptance)", () => {
    const engaged = scoreEngagement({
      replyCount: 1,
      lastReplyAt: daysAgo(2),
      classification: "interested",
      now: NOW,
    });
    const silent = scoreEngagement({ replyCount: 0, now: NOW });
    expect(engaged.score).toBeGreaterThan(silent.score);
    expect(engaged.band === "engaged" || engaged.band === "hot").toBe(true);
  });

  it("decline/unsubscribe/DNC zero the score even with prior replies", () => {
    for (const label of ["decline", "unsubscribe", "do_not_contact", "cancelled_by_them"]) {
      const r = scoreEngagement({
        replyCount: 5,
        lastReplyAt: daysAgo(1),
        classification: label,
        now: NOW,
      });
      expect(r.score).toBe(0);
      expect(r.band).toBe("dead");
    }
  });

  it("confirmed outranks interested at equal recency/replies", () => {
    const confirmed = scoreEngagement({
      replyCount: 2,
      lastReplyAt: daysAgo(3),
      classification: "confirmed",
      now: NOW,
    });
    const interested = scoreEngagement({
      replyCount: 2,
      lastReplyAt: daysAgo(3),
      classification: "interested",
      now: NOW,
    });
    expect(confirmed.score).toBeGreaterThan(interested.score);
  });

  it("recency matters: a recent reply outranks an old one", () => {
    const recent = scoreEngagement({ replyCount: 1, lastReplyAt: daysAgo(1), now: NOW });
    const old = scoreEngagement({ replyCount: 1, lastReplyAt: daysAgo(60), now: NOW });
    expect(recent.score).toBeGreaterThan(old.score);
  });

  it("warm opens are a small, capped lift -- never dominant", () => {
    const noOpens = scoreEngagement({ replyCount: 1, lastReplyAt: daysAgo(5), now: NOW });
    const manyOpens = scoreEngagement({
      replyCount: 1,
      lastReplyAt: daysAgo(5),
      warmOpenCount: 50,
      now: NOW,
    });
    expect(manyOpens.score - noOpens.score).toBeLessThanOrEqual(8);
    // opens alone never push a no-reply venue above 'warming'
    const opensOnly = scoreEngagement({ replyCount: 0, warmOpenCount: 50, now: NOW });
    expect(opensOnly.band === "cold").toBe(true);
  });

  it("stalled_warm drags slightly but does not zero", () => {
    const stalled = scoreEngagement({
      replyCount: 1,
      lastReplyAt: daysAgo(20),
      classification: "stalled_warm",
      now: NOW,
    });
    expect(stalled.score).toBeGreaterThan(0);
    expect(stalled.band).not.toBe("dead");
  });

  it("clamps to 0-100", () => {
    const max = scoreEngagement({
      replyCount: 10,
      lastReplyAt: daysAgo(0),
      warmOpenCount: 100,
      classification: "confirmed",
      now: NOW,
    });
    expect(max.score).toBeLessThanOrEqual(100);
    expect(max.score).toBeGreaterThanOrEqual(0);
  });

  it("accepts ISO string timestamps", () => {
    const r = scoreEngagement({
      replyCount: 1,
      lastReplyAt: daysAgo(1).toISOString(),
      now: NOW,
    });
    expect(r.score).toBeGreaterThan(0);
  });
});

describe("compareByEngagementDesc", () => {
  it("sorts most-engaged first", () => {
    const rows = [
      scoreEngagement({ replyCount: 0, now: NOW }),
      scoreEngagement({
        replyCount: 2,
        lastReplyAt: daysAgo(1),
        classification: "confirmed",
        now: NOW,
      }),
      scoreEngagement({ replyCount: 1, lastReplyAt: daysAgo(10), now: NOW }),
    ].sort(compareByEngagementDesc);
    const top = rows[0];
    const bottom = rows[rows.length - 1];
    expect(top?.band === "hot" || top?.band === "engaged").toBe(true);
    expect(bottom?.score).toBe(0);
  });
});

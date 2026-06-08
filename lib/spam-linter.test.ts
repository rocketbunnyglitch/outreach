import { lintEmail } from "@/lib/spam-linter";
import { describe, expect, it } from "vitest";

describe("lintEmail — spam/deliverability linter", () => {
  it("a clean, human cold email scores low", () => {
    const r = lintEmail({
      subject: "Quick question about Friday nights at Northside",
      bodyText:
        "Hi Sam, I run bar crawls in Akron and Northside keeps coming up as a spot people love. Would you be open to hosting a stop this October? Happy to share the details.",
      bodyHtml: null,
    });
    expect(r.level).toBe("clean");
    expect(r.score).toBeLessThan(25);
  });

  it("flags spam-trigger words", () => {
    const r = lintEmail({
      subject: "ACT NOW — limited time offer",
      bodyText: "Congratulations! This is a once-in-a-lifetime risk-free guarantee. Buy now!",
    });
    expect(r.level).not.toBe("clean");
    expect(r.issues.some((i) => i.id === "spam_words")).toBe(true);
  });

  it("penalizes ALL-CAPS subject", () => {
    const r = lintEmail({ subject: "FREE CRAWL TICKETS", bodyText: "hello there friend" });
    expect(r.issues.some((i) => i.id === "caps_subject")).toBe(true);
  });

  it("penalizes heavy link load", () => {
    const html =
      '<a href="http://a.com">1</a><a href="http://b.com">2</a><a href="http://c.com">3</a><a href="http://d.com">4</a>';
    const r = lintEmail({ subject: "hi", bodyText: "see links", bodyHtml: html });
    expect(r.issues.some((i) => i.id === "too_many_links")).toBe(true);
    expect(r.level).not.toBe("clean");
  });

  it("flags image-heavy / text-light bodies", () => {
    const r = lintEmail({
      subject: "look",
      bodyText: "",
      bodyHtml: '<img src="http://x/banner.png">',
    });
    expect(r.issues.some((i) => i.id === "image_heavy")).toBe(true);
  });

  it("flags a fake Re: subject on cold, but not on warm", () => {
    const cold = lintEmail({ subject: "Re: your event", bodyText: "hey there", context: "cold" });
    const warm = lintEmail({ subject: "Re: your event", bodyText: "hey there", context: "warm" });
    expect(cold.issues.some((i) => i.id === "fake_reply_subject")).toBe(true);
    expect(warm.issues.some((i) => i.id === "fake_reply_subject")).toBe(false);
  });

  it("is more lenient about 2 links on a warm thread than a cold one", () => {
    const html = '<a href="http://a.com">1</a><a href="http://b.com">2</a>';
    const cold = lintEmail({ subject: "hi", bodyText: "x", bodyHtml: html, context: "cold" });
    const warm = lintEmail({ subject: "hi", bodyText: "x", bodyHtml: html, context: "warm" });
    expect(cold.score).toBeGreaterThan(warm.score);
  });

  it("clamps score to 0-100 and returns sorted issues", () => {
    const r = lintEmail({
      subject: "FREE!!! ACT NOW $$$ GUARANTEED WINNER",
      bodyText: "CLICK HERE to BUY NOW risk-free money-back urgent cheap order now",
      bodyHtml: '<a href="1">a</a><a href="2">b</a><a href="3">c</a><a href="4">d</a>',
    });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.level).toBe("risky");
    // High-severity issues come first.
    const [first, second] = r.issues;
    if (first && second) {
      const rank = { high: 0, medium: 1, low: 2 };
      expect(rank[first.severity]).toBeLessThanOrEqual(rank[second.severity]);
    }
  });
});

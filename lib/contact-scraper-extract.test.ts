import { describe, expect, it } from "vitest";
import {
  type ScrapedContact,
  apexDomain,
  classifyRole,
  deobfuscate,
  extractEmails,
  extractFacebook,
  extractInstagram,
  isInfraEmail,
  rankEmails,
  robotsDisallowsRoot,
  scoreConfidence,
} from "./contact-scraper-extract";

describe("deobfuscate", () => {
  it("decodes [at] / (at) / &#64; to @", () => {
    expect(deobfuscate("events [at] bar.com")).toBe("events@bar.com");
    expect(deobfuscate("events (at) bar.com")).toBe("events@bar.com");
    expect(deobfuscate("events&#64;bar.com")).toBe("events@bar.com");
  });
  it("decodes [dot] / (dot) to .", () => {
    expect(deobfuscate("events [at] bar [dot] com")).toBe("events@bar.com");
  });
});

describe("apexDomain", () => {
  it("strips www and port, keeps last two labels", () => {
    expect(apexDomain("www.somebar.com")).toBe("somebar.com");
    expect(apexDomain("shop.somebar.com:443")).toBe("somebar.com");
    expect(apexDomain("somebar.com")).toBe("somebar.com");
  });
});

describe("classifyRole", () => {
  it("maps local-parts to roles", () => {
    expect(classifyRole("events@b.com")).toBe("events");
    expect(classifyRole("privateevents@b.com")).toBe("events");
    expect(classifyRole("private@b.com")).toBe("private");
    expect(classifyRole("gm@b.com")).toBe("manager");
    expect(classifyRole("owner@b.com")).toBe("manager");
    expect(classifyRole("info@b.com")).toBe("info");
    expect(classifyRole("hello@b.com")).toBe("general");
    expect(classifyRole("contact@b.com")).toBe("general");
    expect(classifyRole("reservations@b.com")).toBe("unknown");
  });
});

describe("scoreConfidence", () => {
  it("scores own-domain 90, free providers 60, other 70", () => {
    expect(scoreConfidence("events@somebar.com", "somebar.com")).toBe(90);
    expect(scoreConfidence("events@mail.somebar.com", "somebar.com")).toBe(90);
    expect(scoreConfidence("somebar@gmail.com", "somebar.com")).toBe(60);
    expect(scoreConfidence("hi@othervendor.com", "somebar.com")).toBe(70);
  });
});

describe("isInfraEmail", () => {
  it("drops infra / placeholder / image emails", () => {
    expect(isInfraEmail("noreply@sentry.io")).toBe(true);
    expect(isInfraEmail("hi@example.com")).toBe(true);
    expect(isInfraEmail("youremail@gmail.com")).toBe(true);
    expect(isInfraEmail("logo@2x.png")).toBe(true);
    expect(isInfraEmail("events@somebar.com")).toBe(false);
  });
});

describe("extractEmails", () => {
  it("extracts a plain email with role + confidence", () => {
    const out = extractEmails(
      "Reach us at events@somebar.com",
      "https://somebar.com/",
      "somebar.com",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      email: "events@somebar.com",
      role_hint: "events",
      source_page: "https://somebar.com/",
    });
    expect(out[0]?.confidence).toBeGreaterThanOrEqual(90);
  });

  it("extracts mailto hrefs and strips ?subject", () => {
    const html = `<a href="mailto:hello@somebar.com?subject=Hi">Email</a>`;
    const out = extractEmails(html, "https://somebar.com/contact", "somebar.com");
    expect(out.map((e) => e.email)).toContain("hello@somebar.com");
  });

  it("decodes obfuscated emails before matching", () => {
    const out = extractEmails("events [at] somebar.com", "https://somebar.com/", "somebar.com");
    expect(out.map((e) => e.email)).toContain("events@somebar.com");
  });

  it("dedupes within a page and drops infra", () => {
    const html = "events@somebar.com events@somebar.com noreply@sentry.io";
    const out = extractEmails(html, "https://somebar.com/", "somebar.com");
    expect(out).toHaveLength(1);
    expect(out[0]?.email).toBe("events@somebar.com");
  });
});

describe("rankEmails", () => {
  it("sorts by confidence DESC then role priority", () => {
    const input: ScrapedContact[] = [
      { email: "info@somebar.com", role_hint: "info", source_page: "p", confidence: 90 },
      { email: "events@somebar.com", role_hint: "events", source_page: "p", confidence: 90 },
      { email: "owner@gmail.com", role_hint: "manager", source_page: "p", confidence: 60 },
    ];
    const out = rankEmails(input);
    expect(out.map((e) => e.email)).toEqual([
      "events@somebar.com",
      "info@somebar.com",
      "owner@gmail.com",
    ]);
  });

  it("dedupes across pages keeping the higher confidence", () => {
    const input: ScrapedContact[] = [
      { email: "x@somebar.com", role_hint: "unknown", source_page: "a", confidence: 70 },
      { email: "x@somebar.com", role_hint: "unknown", source_page: "b", confidence: 90 },
    ];
    const out = rankEmails(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(90);
  });
});

describe("extractInstagram", () => {
  it("returns the first real handle as a URL", () => {
    expect(extractInstagram('<a href="https://www.instagram.com/somebar/">IG</a>')).toBe(
      "https://instagram.com/somebar",
    );
  });
  it("skips reserved paths", () => {
    expect(extractInstagram("https://instagram.com/p/Cabc123 https://instagram.com/realbar")).toBe(
      "https://instagram.com/realbar",
    );
  });
  it("returns null when none present", () => {
    expect(extractInstagram("no socials here")).toBeNull();
  });
});

describe("extractFacebook", () => {
  it("returns the first real slug as a URL", () => {
    expect(extractFacebook('<a href="https://facebook.com/SomeBarPage">FB</a>')).toBe(
      "https://facebook.com/SomeBarPage",
    );
  });
  it("skips sharer/dialog/plugin links", () => {
    expect(
      extractFacebook("https://facebook.com/sharer.php?u=x https://facebook.com/realbar"),
    ).toBe("https://facebook.com/realbar");
  });
});

describe("robotsDisallowsRoot", () => {
  it("blocks when * disallows /", () => {
    expect(robotsDisallowsRoot("User-agent: *\nDisallow: /")).toBe(true);
  });
  it("blocks when PerseBot disallows /", () => {
    expect(robotsDisallowsRoot("User-agent: PerseBot\nDisallow: /")).toBe(true);
  });
  it("allows when only a subpath is disallowed", () => {
    expect(robotsDisallowsRoot("User-agent: *\nDisallow: /admin")).toBe(false);
  });
  it("ignores disallow for a different agent", () => {
    expect(robotsDisallowsRoot("User-agent: Googlebot\nDisallow: /")).toBe(false);
  });
});

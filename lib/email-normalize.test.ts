import { describe, expect, it } from "vitest";
import { SINGLE_EMAIL_RE, extractEmails, normalizeVenueEmail } from "./email-normalize";

describe("extractEmails", () => {
  it("passes a clean single address through", () => {
    expect(extractEmails("Events@Venue.com")).toEqual({
      emails: ["events@venue.com"],
      residue: null,
    });
  });

  it("splits semicolon blobs", () => {
    expect(extractEmails("drew@jamopresents.com;kelly@jamopresents.com").emails).toEqual([
      "drew@jamopresents.com",
      "kelly@jamopresents.com",
    ]);
  });

  it("splits slash and newline blobs", () => {
    expect(extractEmails("hayley@steamworks.com / fiona.hardy@steamworks.com").emails).toEqual([
      "hayley@steamworks.com",
      "fiona.hardy@steamworks.com",
    ]);
    expect(extractEmails("daniel@lanepark.games\nlily.frank@lanepark.games").emails).toEqual([
      "daniel@lanepark.games",
      "lily.frank@lanepark.games",
    ]);
  });

  it("repairs the space-after-@ typo", () => {
    expect(extractEmails("marketing@ fat-tuesday.com").emails).toEqual([
      "marketing@fat-tuesday.com",
    ]);
  });

  it("keeps operator notes as residue", () => {
    const r = extractEmails("events@montanaaleworks.com - gm liz");
    expect(r.emails).toEqual(["events@montanaaleworks.com"]);
    expect(r.residue).toBe("gm liz");
  });

  it("returns pure status text as residue with no emails", () => {
    const r = extractEmails("left vm");
    expect(r.emails).toEqual([]);
    expect(r.residue).toBe("left vm");
  });

  it("handles null/empty", () => {
    expect(extractEmails(null)).toEqual({ emails: [], residue: null });
    expect(extractEmails("")).toEqual({ emails: [], residue: null });
  });

  it("dedupes repeated addresses", () => {
    expect(extractEmails("a@b.com, A@B.com").emails).toEqual(["a@b.com"]);
  });
});

describe("normalizeVenueEmail", () => {
  it("takes the first address from a blob", () => {
    expect(normalizeVenueEmail("cheri@bdb.com;victoria@bdb.com")).toBe("cheri@bdb.com");
  });
  it("rejects pure status text", () => {
    expect(normalizeVenueEmail("email sent bounced")).toBeNull();
    expect(normalizeVenueEmail("dm ig")).toBeNull();
  });
});

describe("SINGLE_EMAIL_RE", () => {
  it("accepts a clean address and rejects blobs", () => {
    expect(SINGLE_EMAIL_RE.test("events@venue.com")).toBe(true);
    expect(SINGLE_EMAIL_RE.test("a@b.com;c@d.com")).toBe(false);
    expect(SINGLE_EMAIL_RE.test("email sent")).toBe(false);
    expect(SINGLE_EMAIL_RE.test("marketing@ fat-tuesday.com")).toBe(false);
  });
});

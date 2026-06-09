import { describe, expect, it } from "vitest";
import {
  type FetchLike,
  type HttpResponseLike,
  type ScrapeDeps,
  scrapeContactsCore,
} from "./contact-scraper-extract";

// NOTE: we exercise scrapeContactsCore from the dependency-free module rather
// than scrapeContactTier1 from contact-scraper-tier1.ts, because the latter
// does `import "server-only"` which throws under vitest. The wrapper is a thin
// `scrapeContactsCore(url, realDeps)` so this fully covers the crawl logic.

interface Route {
  status?: number;
  body?: string;
  location?: string;
}

function resp(status: number, body = "", location?: string): HttpResponseLike {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "location" ? (location ?? null) : null),
    },
    text: async () => body,
  };
}

function mockFetch(routes: Record<string, Route>): FetchLike {
  return async (url: string) => {
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) return resp(404);
    return resp(r.status ?? 200, r.body ?? "", r.location);
  };
}

function deps(fetchImpl: FetchLike): ScrapeDeps {
  return { fetchImpl, sleep: async () => {}, now: () => 0 };
}

describe("scrapeContactsCore", () => {
  it("returns a venue-domain email with role + high confidence", async () => {
    const result = await scrapeContactsCore(
      "https://somebar.com",
      deps(mockFetch({ "/": { body: "Book us: events@somebar.com" } })),
    );
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0]?.email).toBe("events@somebar.com");
    expect(result.emails[0]?.role_hint).toBe("events");
    expect(result.emails[0]?.confidence).toBeGreaterThanOrEqual(90);
    expect(result.pages_fetched).toContain("https://somebar.com/");
    // email but no social -> partial
    expect(result.status).toBe("partial");
  });

  it("extracts mailto-linked emails", async () => {
    const result = await scrapeContactsCore(
      "https://somebar.com",
      deps(
        mockFetch({
          "/": { body: "no contact here" },
          "/contact": { body: `<a href="mailto:hello@somebar.com">Email us</a>` },
        }),
      ),
    );
    expect(result.emails.map((e) => e.email)).toContain("hello@somebar.com");
  });

  it("decodes obfuscated emails", async () => {
    const result = await scrapeContactsCore(
      "https://somebar.com",
      deps(mockFetch({ "/": { body: "Reach events [at] somebar.com anytime" } })),
    );
    expect(result.emails.map((e) => e.email)).toContain("events@somebar.com");
  });

  it("reports failed_no_emails when pages load but nothing is found", async () => {
    const result = await scrapeContactsCore(
      "https://somebar.com",
      deps(mockFetch({ "/": { body: "<h1>Welcome</h1> just a homepage" } })),
    );
    expect(result.emails).toHaveLength(0);
    expect(result.instagram).toBeNull();
    expect(result.status).toBe("failed_no_emails");
    expect(result.pages_fetched).toContain("https://somebar.com/");
  });

  it("reports unreachable when every path 404s", async () => {
    const result = await scrapeContactsCore("https://deadsite.com", deps(mockFetch({})));
    expect(result.pages_fetched).toHaveLength(0);
    expect(result.pages_failed.length).toBeGreaterThan(0);
    expect(result.status).toBe("unreachable");
  });

  it("extracts both Instagram and Facebook when present", async () => {
    const result = await scrapeContactsCore(
      "https://somebar.com",
      deps(
        mockFetch({
          "/": {
            body: `events@somebar.com
              <a href="https://instagram.com/somebar">IG</a>
              <a href="https://facebook.com/SomeBarPage">FB</a>`,
          },
        }),
      ),
    );
    expect(result.instagram).toBe("https://instagram.com/somebar");
    expect(result.facebook).toBe("https://facebook.com/SomeBarPage");
    expect(result.status).toBe("success");
  });

  it("honors robots.txt disallow", async () => {
    const result = await scrapeContactsCore(
      "https://somebar.com",
      deps(
        mockFetch({
          "/robots.txt": { body: "User-agent: *\nDisallow: /" },
          "/": { body: "events@somebar.com" },
        }),
      ),
    );
    expect(result.status).toBe("unreachable");
    expect(result.emails).toHaveLength(0);
  });

  it("follows redirects up to the cap", async () => {
    const fetchImpl: FetchLike = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/") return resp(301, "", "https://somebar.com/home");
      if (path === "/home") return resp(200, "events@somebar.com");
      return resp(404);
    };
    const result = await scrapeContactsCore("https://somebar.com", deps(fetchImpl));
    expect(result.emails.map((e) => e.email)).toContain("events@somebar.com");
  });
});

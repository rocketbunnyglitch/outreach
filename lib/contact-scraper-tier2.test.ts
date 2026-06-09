import { describe, expect, it, vi } from "vitest";
import type { FetchLike, HttpResponseLike, Tier1Result } from "./contact-scraper-extract";
import {
  type AiCompleteArgs,
  type AiCompleteResult,
  type Tier2Deps,
  estimateCostUsd,
  guardEmails,
  parseTier2Json,
  scrapeContactTier2Core,
  stripHtml,
} from "./contact-scraper-tier2-core";

// NOTE: tests target the dependency-free core, not the server-only wrapper
// (which `import "server-only"` and would throw under vitest). The wrapper is
// a thin `scrapeContactTier2Core(url, t1, realDeps)` binding.

function resp(status: number, body = ""): HttpResponseLike {
  return { status, headers: { get: () => null }, text: async () => body };
}

function fetchReturning(html: string, only404?: boolean): FetchLike {
  return async (url: string) => {
    if (only404 && new URL(url).pathname !== "/") return resp(404);
    return resp(200, html);
  };
}

function aiQueue(responses: AiCompleteResult[]): {
  fn: (a: AiCompleteArgs) => Promise<AiCompleteResult>;
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  return {
    fn: async () => {
      calls++;
      return responses[i++] ?? { ok: false, message: "exhausted" };
    },
    calls: () => calls,
  };
}

function deps(
  fetchImpl: FetchLike,
  ai: (a: AiCompleteArgs) => Promise<AiCompleteResult>,
): Tier2Deps {
  return { fetchImpl, aiComplete: ai, now: () => 0 };
}

const T1: Tier1Result = {
  emails: [],
  instagram: null,
  facebook: null,
  pages_fetched: ["https://somebar.com/"],
  pages_failed: [],
  duration_ms: 10,
  status: "failed_no_emails",
};

describe("stripHtml", () => {
  it("removes scripts, tags, and decodes entities", () => {
    const out = stripHtml("<style>x{}</style><p>Hi&amp;Bye</p><script>1</script>");
    expect(out).toBe("Hi&Bye");
  });
});

describe("parseTier2Json", () => {
  it("parses a fenced JSON object", () => {
    const parsed = parseTier2Json('```json\n{"emails":[],"instagram_url":null}\n```');
    expect(parsed).not.toBeNull();
    expect(parsed?.emails).toEqual([]);
  });
  it("returns null on garbage", () => {
    expect(parseTier2Json("not json")).toBeNull();
  });
});

describe("guardEmails", () => {
  it("keeps emails present verbatim and drops the rest", () => {
    const out = guardEmails(
      [
        { email: "events@somebar.com", role_hint: "events", confidence: 90 },
        { email: "ghost@nope.com", role_hint: "general", confidence: 90 },
      ],
      "contact us at events@somebar.com",
      "https://somebar.com/",
      "somebar.com",
    );
    expect(out.map((e) => e.email)).toEqual(["events@somebar.com"]);
  });
});

describe("estimateCostUsd", () => {
  it("prices input at $1/M and output at $5/M (chars/4)", () => {
    // 4000 input chars = 1000 tok = $0.001; 4000 output = 1000 tok = $0.005
    expect(estimateCostUsd(4000, 4000)).toBeCloseTo(0.006, 6);
  });
});

describe("scrapeContactTier2Core", () => {
  it("returns emails from valid model JSON", async () => {
    const ai = aiQueue([
      {
        ok: true,
        text: '{"emails":[{"email":"events@somebar.com","role_hint":"events","confidence":90}],"instagram_url":"https://instagram.com/somebar","facebook_url":null,"notes":"on contact page"}',
      },
    ]);
    const result = await scrapeContactTier2Core(
      "https://somebar.com",
      T1,
      deps(fetchReturning("Reach events@somebar.com on Instagram @somebar"), ai.fn),
    );
    expect(result.status).toBe("success");
    expect(result.emails.map((e) => e.email)).toEqual(["events@somebar.com"]);
    expect(result.instagram).toBe("https://instagram.com/somebar");
    expect(result.cost_estimate_usd).toBeGreaterThan(0);
  });

  it("retries once on bad JSON then accepts the second response", async () => {
    const ai = aiQueue([
      { ok: true, text: "sorry, here is the info: nope" },
      {
        ok: true,
        text: '{"emails":[{"email":"events@somebar.com","confidence":80}],"instagram_url":null,"facebook_url":null,"notes":null}',
      },
    ]);
    const result = await scrapeContactTier2Core(
      "https://somebar.com",
      T1,
      deps(fetchReturning("events@somebar.com"), ai.fn),
    );
    expect(ai.calls()).toBe(2);
    expect(result.status).toBe("success");
    expect(result.emails).toHaveLength(1);
  });

  it("rejects a hallucinated email not present in the source", async () => {
    const ai = aiQueue([
      {
        ok: true,
        text: '{"emails":[{"email":"ghost@nope.com","role_hint":"general","confidence":95}],"instagram_url":null,"facebook_url":null,"notes":"guessed"}',
      },
    ]);
    const result = await scrapeContactTier2Core(
      "https://somebar.com",
      T1,
      deps(fetchReturning("We have no contact email listed here."), ai.fn),
    );
    expect(result.emails).toHaveLength(0);
    expect(result.status).toBe("failed");
  });

  it("fails gracefully when the AI client is not configured", async () => {
    const ai = aiQueue([{ ok: false, reason: "not_configured", message: "no key" }]);
    const result = await scrapeContactTier2Core(
      "https://somebar.com",
      T1,
      deps(fetchReturning("events@somebar.com"), ai.fn),
    );
    expect(result.status).toBe("failed");
    expect(result.notes).toBe("no key");
  });

  it("fails when no page can be re-fetched", async () => {
    const allFail: FetchLike = vi.fn(async () => resp(500));
    const ai = aiQueue([]);
    const result = await scrapeContactTier2Core("https://somebar.com", T1, deps(allFail, ai.fn));
    expect(result.status).toBe("failed");
    expect(ai.calls()).toBe(0);
  });
});

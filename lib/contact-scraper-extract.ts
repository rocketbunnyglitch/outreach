/**
 * Pure, dependency-free helpers for Tier-1 contact scraping.
 *
 * This module deliberately has NO `import "server-only"`, no `db`, and no
 * direct `fetch` — every side-effecting dependency (HTTP, sleep, clock) is
 * injected via `ScrapeDeps`. That keeps the whole extraction + crawl loop
 * unit-testable under vitest (which cannot import `server-only` modules).
 *
 * The server-only wrapper that binds real `fetch`/`setTimeout` lives in
 * lib/contact-scraper-tier1.ts and re-exports the public types from here.
 *
 * See PHASE E2 of the venue contact-enrichment build.
 */

export interface ScrapedContact {
  email: string;
  role_hint: "events" | "private" | "manager" | "general" | "info" | "unknown";
  source_page: string;
  /** 0-100. */
  confidence: number;
}

export interface Tier1Result {
  emails: ScrapedContact[];
  instagram: string | null;
  facebook: string | null;
  pages_fetched: string[];
  pages_failed: string[];
  duration_ms: number;
  status: "success" | "partial" | "failed_no_emails" | "unreachable";
}

/** Minimal structural subset of the WHATWG `fetch` we rely on, so the
 *  global `fetch` can be passed directly and a stub can be passed in tests. */
export interface HttpResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    signal?: AbortSignal;
    redirect?: "follow" | "manual";
    headers?: Record<string, string>;
  },
) => Promise<HttpResponseLike>;

export interface ScrapeDeps {
  fetchImpl: FetchLike;
  /** Resolves after `ms`. Injected so tests run instantly. */
  sleep: (ms: number) => Promise<void>;
  /** Monotonic-ish clock for duration. Defaults to Date.now in the wrapper. */
  now: () => number;
}

/** Crawl order. We stop fetching MORE pages once one yields >=1 valid email,
 *  but socials gathered up to that point are kept. */
export const CANDIDATE_PATHS = [
  "/",
  "/contact",
  "/contact-us",
  "/contactus",
  "/about",
  "/about-us",
  "/private-events",
  "/events",
  "/book",
  "/booking",
  "/info",
] as const;

export const PERSE_USER_AGENT =
  "Mozilla/5.0 (compatible; PerseBot/1.0; +https://barcrawlconnect.com/bot)";

const PAGE_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const POLITE_DELAY_MS = 500;

/** Raw email regex from the spec. Global so we can iterate all matches. */
export const EMAIL_REGEX = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Free-mail providers — a real email, but not the venue's own domain, so
 *  capped at moderate confidence. */
const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
]);

/** Infra / vendor / placeholder domains we never want to treat as a contact. */
const INFRA_DOMAINS = new Set([
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "example.com",
  "example.org",
  "example.net",
  "yourdomain.com",
  "domain.com",
  "email.com",
  "test.com",
  "sentry.wixpress.com",
  "stripe.com",
  "squarespace.com",
  "godaddy.com",
  "cloudflare.com",
  "wix.com",
]);

/** Placeholder local-parts (the bit before @) that are clearly templated. */
const PLACEHOLDER_LOCALPARTS = new Set([
  "youremail",
  "your-email",
  "your.email",
  "email",
  "example",
  "name",
  "firstname",
  "lastname",
  "user",
  "username",
  "sentry",
]);

const ROLE_PRIORITY: Record<ScrapedContact["role_hint"], number> = {
  events: 0,
  private: 1,
  manager: 2,
  general: 3,
  info: 4,
  unknown: 5,
};

/**
 * Decode the common obfuscations venues use to dodge naive scrapers before
 * running the email regex. Handles `[at]`/`(at)`/`&#64;` -> `@` and
 * `[dot]`/`(dot)` -> `.`, collapsing surrounding whitespace.
 */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*(?:\[at\]|\(at\)|&#64;)\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, ".");
}

/** Lower-cased registrable-ish apex of a hostname (last two labels). Good
 *  enough for confidence scoring; multi-part TLDs (co.uk) are approximate. */
export function apexDomain(host: string): string {
  const clean = host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/:\d+$/, "");
  const labels = clean.split(".").filter(Boolean);
  if (labels.length <= 2) return clean;
  return labels.slice(-2).join(".");
}

/** True if `email` is infra/vendor/placeholder noise we should drop. */
export function isInfraEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const atIdx = lower.lastIndexOf("@");
  if (atIdx < 0) return true;
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  if (INFRA_DOMAINS.has(domain)) return true;
  if (PLACEHOLDER_LOCALPARTS.has(local)) return true;
  // Anything that still smells like a templated placeholder.
  if (/(^|[._-])(your|example|placeholder)([._-]|$)/.test(local)) return true;
  // Stray image filenames that survived the regex (e.g. logo@2x ... .png).
  if (/\.(png|jpe?g|gif|svg|webp)$/.test(domain)) return true;
  return false;
}

/** Map an email's local-part to a coarse role. Order matters — more specific
 *  buckets win over the generic catch-alls. */
export function classifyRole(email: string): ScrapedContact["role_hint"] {
  const local = email.toLowerCase().split("@")[0] ?? "";
  if (local.includes("event")) return "events";
  if (local.includes("private") || local.includes("priv")) return "private";
  if (local.includes("manager") || local.includes("gm") || local.includes("owner"))
    return "manager";
  if (local.includes("info")) return "info";
  if (
    local.includes("general") ||
    local.includes("contact") ||
    local.includes("hello") ||
    local.includes("hi")
  )
    return "general";
  return "unknown";
}

/** Confidence 0-100 given the venue's website apex. Own-domain wins; free
 *  providers are mid; any other custom domain is in between. */
export function scoreConfidence(email: string, websiteApex: string): number {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (websiteApex && (domain === websiteApex || domain.endsWith(`.${websiteApex}`))) return 90;
  if (FREE_PROVIDERS.has(domain)) return 60;
  return 70;
}

/**
 * Pull every email out of a chunk of HTML/text for one page: mailto hrefs
 * first (highest intent), then the de-obfuscated body. Returns UN-deduped,
 * UN-sorted contacts already tagged with role + confidence + source page.
 */
export function extractEmails(
  html: string,
  sourcePage: string,
  websiteApex: string,
): ScrapedContact[] {
  const found: string[] = [];

  // mailto: hrefs — strip any ?subject=... query.
  const mailtoRe = /href\s*=\s*["']\s*mailto:([^"'?\s]+)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = mailtoRe.exec(html)) !== null) {
    if (m[1]) found.push(decodeURIComponent(m[1]));
  }

  // Plain text (after de-obfuscation).
  const text = deobfuscate(html);
  const bodyMatches = text.match(EMAIL_REGEX) ?? [];
  found.push(...bodyMatches);

  const out: ScrapedContact[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const email = raw
      .trim()
      .toLowerCase()
      .replace(/[.,;:]+$/, "");
    if (!email.includes("@")) continue;
    if (seen.has(email)) continue;
    if (isInfraEmail(email)) continue;
    seen.add(email);
    out.push({
      email,
      role_hint: classifyRole(email),
      source_page: sourcePage,
      confidence: scoreConfidence(email, websiteApex),
    });
  }
  return out;
}

/** Dedupe by lowercased email, then sort by confidence DESC, role priority. */
export function rankEmails(contacts: ScrapedContact[]): ScrapedContact[] {
  const byEmail = new Map<string, ScrapedContact>();
  for (const c of contacts) {
    const key = c.email.toLowerCase();
    const existing = byEmail.get(key);
    // Keep the higher-confidence sighting if the same email appears twice.
    if (!existing || c.confidence > existing.confidence) byEmail.set(key, c);
  }
  return [...byEmail.values()].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return ROLE_PRIORITY[a.role_hint] - ROLE_PRIORITY[b.role_hint];
  });
}

const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "explore",
  "accounts",
  "about",
  "developer",
  "legal",
  "directory",
  "privacy",
]);

/** First real Instagram handle found, returned as a normalized profile URL. */
export function extractInstagram(html: string): string | null {
  const re = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = re.exec(html)) !== null) {
    const handle = (m[1] ?? "").replace(/\.$/, "");
    if (!handle) continue;
    if (IG_RESERVED.has(handle.toLowerCase())) continue;
    return `https://instagram.com/${handle}`;
  }
  return null;
}

const FB_RESERVED = new Set([
  "sharer",
  "sharer.php",
  "dialog",
  "plugins",
  "tr",
  "login",
  "login.php",
  "help",
  "policies",
  "privacy",
  "events",
]);

/** First real Facebook page slug, returned as a normalized page URL. */
export function extractFacebook(html: string): string | null {
  const re = /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([a-zA-Z0-9.\-]+)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = re.exec(html)) !== null) {
    const slug = (m[1] ?? "").replace(/\.$/, "");
    if (!slug) continue;
    if (FB_RESERVED.has(slug.toLowerCase())) continue;
    return `https://facebook.com/${slug}`;
  }
  return null;
}

/** Minimal robots.txt check: does it Disallow `/` for PerseBot or `*`? */
export function robotsDisallowsRoot(robotsTxt: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let applies = false;
  for (const line of lines) {
    const uaMatch = /^user-agent:\s*(.+)$/i.exec(line);
    if (uaMatch) {
      const agent = (uaMatch[1] ?? "").trim().toLowerCase();
      applies = agent === "*" || agent === "persebot";
      continue;
    }
    if (!applies) continue;
    const disMatch = /^disallow:\s*(.*)$/i.exec(line);
    if (disMatch) {
      const path = (disMatch[1] ?? "").trim();
      if (path === "/") return true;
    }
  }
  return false;
}

function statusFor(
  hadReachablePage: boolean,
  robotsBlocked: boolean,
  emailCount: number,
  hasSocial: boolean,
): Tier1Result["status"] {
  if (robotsBlocked || !hadReachablePage) return "unreachable";
  const hasEmail = emailCount > 0;
  if (hasEmail && hasSocial) return "success";
  if (hasEmail || hasSocial) return "partial";
  return "failed_no_emails";
}

/** Normalize a possibly-bare website string into an absolute origin URL. */
function toUrl(websiteUrl: string): URL | null {
  const trimmed = websiteUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Fetch one URL, manually following up to MAX_REDIRECTS hops, each with its
 *  own 8s timeout. Returns the final response, or null if every hop failed. */
async function fetchPage(url: string, deps: ScrapeDeps): Promise<HttpResponseLike | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": PERSE_USER_AGENT },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return res;
        try {
          current = new URL(loc, current).toString();
        } catch {
          return res;
        }
        continue;
      }
      return res;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Core Tier-1 scrape. Pure w.r.t. injected deps so it is fully unit-testable.
 * The server-only wrapper supplies real fetch/sleep/clock.
 */
export async function scrapeContactsCore(
  websiteUrl: string,
  deps: ScrapeDeps,
): Promise<Tier1Result> {
  const start = deps.now();
  const empty = (status: Tier1Result["status"]): Tier1Result => ({
    emails: [],
    instagram: null,
    facebook: null,
    pages_fetched: [],
    pages_failed: [],
    duration_ms: deps.now() - start,
    status,
  });

  const base = toUrl(websiteUrl);
  if (!base) return empty("unreachable");
  const origin = base.origin;
  const websiteApex = apexDomain(base.host);

  // robots.txt first. A fetch failure here is treated as "allowed".
  try {
    const robots = await fetchPage(`${origin}/robots.txt`, deps);
    if (robots && robots.status >= 200 && robots.status < 300) {
      const body = await robots.text();
      if (robotsDisallowsRoot(body)) return empty("unreachable");
    }
  } catch {
    // ignore — proceed as if no robots.txt
  }

  const pagesFetched: string[] = [];
  const pagesFailed: string[] = [];
  const collected: ScrapedContact[] = [];
  let instagram: string | null = null;
  let facebook: string | null = null;

  let fetchIndex = 0;
  for (const path of CANDIDATE_PATHS) {
    if (fetchIndex > 0) await deps.sleep(POLITE_DELAY_MS);
    fetchIndex++;

    const pageUrl = `${origin}${path}`;
    const res = await fetchPage(pageUrl, deps);
    if (!res || res.status < 200 || res.status >= 300) {
      pagesFailed.push(pageUrl);
      continue;
    }
    pagesFetched.push(pageUrl);

    let html: string;
    try {
      html = await res.text();
    } catch {
      pagesFailed.push(pageUrl);
      continue;
    }

    if (!instagram) instagram = extractInstagram(html);
    if (!facebook) facebook = extractFacebook(html);

    const pageEmails = extractEmails(html, pageUrl, websiteApex);
    if (pageEmails.length > 0) {
      collected.push(...pageEmails);
      // Found contact emails — stop crawling further pages.
      break;
    }
  }

  const emails = rankEmails(collected);
  const hadReachablePage = pagesFetched.length > 0;
  const hasSocial = Boolean(instagram || facebook);
  const status = statusFor(hadReachablePage, false, emails.length, hasSocial);

  return {
    emails,
    instagram,
    facebook,
    pages_fetched: pagesFetched,
    pages_failed: pagesFailed,
    duration_ms: deps.now() - start,
    status,
  };
}

/**
 * Pure, dependency-free core for the Tier-2 (Haiku) contact-scraper fallback.
 *
 * No `import "server-only"`, no direct `fetch`, no Anthropic SDK — the HTTP
 * fetch, the AI completion call, and the clock are all injected via
 * `Tier2Deps`, so vitest can exercise the HTML-stripping, prompt building,
 * JSON parsing, hallucination guard, and cost math with everything mocked.
 *
 * The server-only wrapper (lib/contact-scraper-tier2.ts) binds real `fetch`
 * and `generateCompletion` from lib/ai.ts.
 *
 * See PHASE E3 of the venue contact-enrichment build.
 */

import {
  type FetchLike,
  type ScrapedContact,
  type Tier1Result,
  apexDomain,
  classifyRole,
  deobfuscate,
  extractFacebook,
  extractInstagram,
} from "./contact-scraper-extract";

export interface Tier2Result {
  emails: ScrapedContact[];
  instagram: string | null;
  facebook: string | null;
  cost_estimate_usd: number;
  duration_ms: number;
  status: "success" | "failed";
  notes: string | null;
}

/** Shape returned by the injected AI client (mirrors lib/ai.ts AiResult). */
export type AiCompleteResult =
  | { ok: true; text: string }
  | { ok: false; reason?: string; message?: string };

export interface AiCompleteArgs {
  system: string;
  prompt: string;
  model: string;
  maxTokens: number;
  tag: string;
}

export interface Tier2Deps {
  fetchImpl: FetchLike;
  aiComplete: (args: AiCompleteArgs) => Promise<AiCompleteResult>;
  now: () => number;
}

export const TIER2_MODEL = "claude-haiku-4-5-20251001";
const MAX_SOURCE_CHARS = 10_000;
const PAGE_TIMEOUT_MS = 8000;

// Haiku 4.5 pricing (USD per million tokens).
const INPUT_USD_PER_M = 1;
const OUTPUT_USD_PER_M = 5;

/** Strip <script>/<style> blocks and all tags, decode a few common entities,
 *  collapse whitespace. Good enough to feed the model readable text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Rough token estimate (chars/4) — used only for the cost ESTIMATE shown to
 *  operators, since the centralized lib/ai.ts client doesn't surface usage. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function estimateCostUsd(inputChars: number, outputChars: number): number {
  const inUsd = (estimateTokens(inputChars) / 1_000_000) * INPUT_USD_PER_M;
  const outUsd = (estimateTokens(outputChars) / 1_000_000) * OUTPUT_USD_PER_M;
  return Number((inUsd + outUsd).toFixed(6));
}

export const TIER2_SYSTEM =
  "You extract contact information from venue websites. Return only valid JSON. Never invent data.";

export function buildTier2Prompt(url: string, text: string): string {
  return `Extract contact information from this bar/restaurant/venue website.
Return ONLY a JSON object:
{ "emails": [{ "email": "events@example.com", "role_hint": "events", "confidence": 90 }],
  "instagram_url": "https://instagram.com/handle" or null,
  "facebook_url": "https://facebook.com/page" or null,
  "notes": "context about extraction" }
role_hint: events | private | manager | general | info | unknown
confidence: 0-100; venue's own domain >=85; free providers 60
Only return emails you can see in the text. Do NOT invent.
Exclude unrelated emails (Sentry, Stripe, web hosts, etc).
WEBSITE: ${url}
TEXT:
${text}`;
}

interface ParsedTier2 {
  emails: Array<{ email?: unknown; role_hint?: unknown; confidence?: unknown }>;
  instagram_url: string | null;
  facebook_url: string | null;
  notes: string | null;
}

/** Tolerantly parse the model's JSON object (handles code fences + preamble).
 *  Returns null on failure so the caller can retry. */
export function parseTier2Json(raw: string): ParsedTier2 | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const emails = Array.isArray(obj.emails) ? (obj.emails as ParsedTier2["emails"]) : [];
    return {
      emails,
      instagram_url: typeof obj.instagram_url === "string" ? obj.instagram_url : null,
      facebook_url: typeof obj.facebook_url === "string" ? obj.facebook_url : null,
      notes: typeof obj.notes === "string" ? obj.notes : null,
    };
  } catch {
    return null;
  }
}

const VALID_ROLES = new Set<ScrapedContact["role_hint"]>([
  "events",
  "private",
  "manager",
  "general",
  "info",
  "unknown",
]);

/**
 * Validate the model's emails against the SOURCE TEXT (anti-hallucination):
 * every accepted email must appear verbatim (case-insensitive) in what we
 * actually sent the model. Also drops malformed entries, clamps confidence,
 * and normalizes role_hint.
 */
export function guardEmails(
  parsedEmails: ParsedTier2["emails"],
  sourceText: string,
  sourcePage: string,
  websiteApex: string,
): ScrapedContact[] {
  const haystack = sourceText.toLowerCase();
  const seen = new Set<string>();
  const out: ScrapedContact[] = [];
  for (const item of parsedEmails) {
    if (!item || typeof item.email !== "string") continue;
    const email = item.email.trim().toLowerCase();
    if (!email.includes("@")) continue;
    if (seen.has(email)) continue;
    // Anti-hallucination: must be present verbatim in the source.
    if (!haystack.includes(email)) continue;
    seen.add(email);
    const role =
      typeof item.role_hint === "string" &&
      VALID_ROLES.has(item.role_hint as ScrapedContact["role_hint"])
        ? (item.role_hint as ScrapedContact["role_hint"])
        : classifyRole(email);
    const rawConf = Number(item.confidence);
    const confidence = Number.isFinite(rawConf)
      ? Math.max(0, Math.min(100, Math.round(rawConf)))
      : websiteApex && email.endsWith(`@${websiteApex}`)
        ? 85
        : 60;
    out.push({ email, role_hint: role, source_page: sourcePage, confidence });
  }
  return out;
}

function toOrigin(websiteUrl: string): { origin: string; apex: string } | null {
  const trimmed = websiteUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return { origin: u.origin, apex: apexDomain(u.host) };
  } catch {
    return null;
  }
}

async function fetchText(url: string, deps: Tier2Deps): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await deps.fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PerseBot/1.0)" },
    });
    if (res.status < 200 || res.status >= 300) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Core Tier-2 scrape. Re-fetches the homepage + a contact page, strips to
 * text, asks Haiku to extract contacts, guards against hallucination, and
 * estimates cost. Pure w.r.t. injected deps for testability.
 */
export async function scrapeContactTier2Core(
  websiteUrl: string,
  tier1Result: Tier1Result,
  deps: Tier2Deps,
): Promise<Tier2Result> {
  const start = deps.now();
  const fail = (notes: string, cost = 0): Tier2Result => ({
    emails: [],
    instagram: null,
    facebook: null,
    cost_estimate_usd: cost,
    duration_ms: deps.now() - start,
    status: "failed",
    notes,
  });

  const loc = toOrigin(websiteUrl);
  if (!loc) return fail("invalid website url");

  // Prefer pages Tier 1 already reached (homepage + a contact-ish page);
  // fall back to /, /contact.
  const fetched = tier1Result.pages_fetched ?? [];
  const home =
    fetched.find((p) => {
      try {
        return new URL(p).pathname === "/";
      } catch {
        return false;
      }
    }) ?? `${loc.origin}/`;
  const contact = fetched.find((p) => /contact/i.test(p)) ?? `${loc.origin}/contact`;
  const targets = [...new Set([home, contact])];

  const htmls: string[] = [];
  for (const t of targets) {
    const html = await fetchText(t, deps);
    if (html) htmls.push(html);
  }
  if (htmls.length === 0) return fail("could not re-fetch any page for Tier 2");

  // Strip + de-obfuscate, concat, truncate. This text is BOTH the model
  // input and the hallucination-guard haystack.
  const sourceText = deobfuscate(stripHtml(htmls.join("\n\n"))).slice(0, MAX_SOURCE_CHARS);
  if (!sourceText.trim()) return fail("no readable text after stripping HTML");

  const prompt = buildTier2Prompt(home, sourceText);

  // Call Haiku, retry ONCE on parse failure.
  let parsed: ParsedTier2 | null = null;
  let inputChars = 0;
  let outputChars = 0;
  let lastFailure: string | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    inputChars += prompt.length + TIER2_SYSTEM.length;
    const ai = await deps.aiComplete({
      system: TIER2_SYSTEM,
      prompt,
      model: TIER2_MODEL,
      maxTokens: 1024,
      tag: "contact_scraper_tier2",
    });
    if (!ai.ok) {
      lastFailure = ai.message ?? ai.reason ?? "ai call failed";
      break;
    }
    outputChars += ai.text.length;
    parsed = parseTier2Json(ai.text);
    if (!parsed) lastFailure = "model returned unparseable JSON";
  }

  const cost = estimateCostUsd(inputChars, outputChars);
  if (!parsed) return fail(lastFailure ?? "tier 2 failed", cost);

  const emails = guardEmails(parsed.emails, sourceText, home, loc.apex);
  const instagram = parsed.instagram_url ? extractInstagram(parsed.instagram_url) : null;
  const facebook = parsed.facebook_url ? extractFacebook(parsed.facebook_url) : null;

  return {
    emails,
    instagram,
    facebook,
    cost_estimate_usd: cost,
    duration_ms: deps.now() - start,
    status: emails.length > 0 ? "success" : "failed",
    notes: parsed.notes,
  };
}

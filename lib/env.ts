/**
 * Centralized, validated environment configuration.
 *
 * Rules (see CLAUDE.md §6 and DECISIONS.md):
 *   - All env access goes through this module. Never read process.env elsewhere.
 *   - Zod validates at import time, failing fast with a clear error.
 *   - Server-only by default. Client-exposed values (none currently) must be
 *     NEXT_PUBLIC_-prefixed and explicitly opted in.
 *   - Phase-gated: variables required only in later phases are .optional() here
 *     and validated at use-site (e.g. NextAuth requires NEXTAUTH_SECRET when it
 *     boots, not at app start).
 */

import { z } from "zod";

const stringRequired = z.string().min(1);
const stringOptional = z.string().min(1).optional();
const urlString = z.string().url();

const envSchema = z.object({
  // --- Phase 0: core runtime ---
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_URL: urlString.default("http://localhost:3001"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: stringRequired,
  REDIS_URL: stringRequired,
  // 64-char hex (32 bytes) for AES-256-GCM. See lib/crypto.ts.
  // Required for encrypt/decrypt; optional at boot so dev without secrets works.
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)")
    .optional(),

  // --- Phase 3: auth ---
  NEXTAUTH_SECRET: stringOptional,
  // GOOGLE_OAUTH_CLIENT_ID / _SECRET still used by app/api/auth/google/*
  // for CONNECTING Gmail inboxes (read + send mail). They are NOT used
  // for login any more — that switched to email + password in commit
  // eca4157. The OAuth flow is admin-initiated from /settings/inboxes.
  GOOGLE_OAUTH_CLIENT_ID: stringOptional,
  GOOGLE_OAUTH_CLIENT_SECRET: stringOptional,
  // Note: GOOGLE_WORKSPACE_DOMAIN and ENABLE_DEV_IMPERSONATION were
  // removed when password auth replaced Google sign-in. The first was
  // a Workspace `hd` restriction on the OAuth login flow that no
  // longer exists; the second gated a dev-only Credentials provider
  // that's been replaced by admin-issued impersonation via a signed
  // grant cookie (see /admin/users in the UI + lib/impersonation-cookie.ts).

  // --- Phase 5: lead generation ---
  // SERVER key: used by lib/google-places.ts for Places/Geocoding fetches
  // from the VPS. MUST NOT have an HTTP-referrer ("Websites") restriction —
  // server requests carry no Referer, so a referrer-restricted key 403s.
  // Restrict this one by IP (the VPS) or leave unrestricted + API-limited.
  GOOGLE_MAPS_API_KEY: stringOptional,
  // BROWSER key: injected into the client Maps JS map (CityVenueMap).
  // This one SHOULD be HTTP-referrer restricted to https://*.barcrawlconnect.com/*
  // and limited to the Maps JavaScript API. Falls back to the server key
  // if unset (single-key setups), but two keys is the correct setup.
  GOOGLE_MAPS_BROWSER_KEY: stringOptional,
  ZEROBOUNCE_API_KEY: stringOptional,

  // --- Phase 6: outreach ---
  POSTMARK_FALLBACK_SERVER_TOKEN: stringOptional,
  POSTMARK_FALLBACK_SENDER: stringOptional,
  QUO_API_KEY: stringOptional,
  QUO_API_BASE_URL: urlString.optional(),
  // For verifying inbound POSTs to /api/webhooks/quo
  QUO_WEBHOOK_SIGNING_SECRET: stringOptional,

  // --- Phase 5: SMS (Twilio + A2P 10DLC) ---
  // The SMS subsystem is INERT until all of these land: lib/sms.ts
  // isSmsConfigured() gates every send, and the inbound webhook fails closed
  // without the auth token. A2P 10DLC carrier approval (1-3 weeks) is a
  // separate operator step; code goes live the moment these are set.
  TWILIO_ACCOUNT_SID: stringOptional,
  TWILIO_AUTH_TOKEN: stringOptional,
  TWILIO_MESSAGING_SERVICE_SID: stringOptional,
  TWILIO_FROM_E164: stringOptional,
  // Public URL Twilio posts inbound SMS to; used to validate X-Twilio-Signature.
  TWILIO_PUBLIC_WEBHOOK_URL: urlString.optional(),

  // --- Engine read API (machine clients: Smart Map, Eventbrite pusher) ---
  // Static shared secret checked by app/api/engine/* via the X-Engine-Api-Key
  // header (cron-secret pattern; machine clients have no Google session).
  ENGINE_API_KEY: stringOptional,

  // Sentry — graceful no-op when DSN is unset. SENTRY_DSN is for the
  // server/edge runtimes; NEXT_PUBLIC_SENTRY_DSN ships into the browser
  // bundle (same DSN value, different consumer). SENTRY_AUTH_TOKEN +
  // SENTRY_ORG + SENTRY_PROJECT are only needed for the source-map
  // upload step at build time.
  SENTRY_DSN: stringOptional,
  NEXT_PUBLIC_SENTRY_DSN: stringOptional,
  SENTRY_AUTH_TOKEN: stringOptional,
  SENTRY_ORG: stringOptional,
  SENTRY_PROJECT: stringOptional,
  SENTRY_TRACES_SAMPLE_RATE: stringOptional,

  // Anthropic / Claude — AI-assisted outreach drafting.
  // Without a key, the AI button surfaces a 'not configured' state.
  ANTHROPIC_API_KEY: stringOptional,
  ANTHROPIC_MODEL: stringOptional,

  // OpenAI - embeddings for semantic reference-doc retrieval
  // (text-embedding-3-small). Without a key, retrieval falls back to
  // Postgres full-text search.
  OPENAI_API_KEY: stringOptional,
  OPENAI_EMBEDDING_MODEL: stringOptional,

  // --- Phase 7: confirmation automations ---
  PUPPETEER_EXECUTABLE_PATH: stringOptional,

  // --- Phase 8: external sync + backups ---
  EVENTBRITE_FALLBACK_TOKEN: stringOptional,
  // Org-wide EB OAuth token — all linked events live on this account
  EVENTBRITE_PRIVATE_TOKEN: stringOptional,
  B2_BUCKET: stringOptional,

  // --- Warm-only email open tracking ---
  // TRACKING_BASE_URL is the master switch: the feature is INERT until it is
  // set, and it MUST be the app's own first-party domain (never a shared
  // tracker domain) to protect sender reputation. EMAIL_OPEN_TRACKING_ENABLED
  // defaults ON when the base URL is set ("automatically on"); set it to "0"
  // or "false" to disable in code without unsetting the URL. Tracking is also
  // gated per-team at runtime via teams.open_tracking_paused, and NEVER fires
  // on cold threads (lib/open-tracking-gate.ts).
  TRACKING_BASE_URL: urlString.optional(),
  EMAIL_OPEN_TRACKING_ENABLED: stringOptional,

  // --- Build-time (set by scripts/build-with-version.sh) ---
  BUILD_VERSION: stringOptional,
  BUILD_COMMIT: stringOptional,
  BUILD_AT: stringOptional,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print every issue. Don't show .env values, only paths.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}\n`);
}

export const env = parsed.data;

/**
 * Warm-only open tracking is env-enabled when a first-party TRACKING_BASE_URL
 * is set and EMAIL_OPEN_TRACKING_ENABLED is not explicitly turned off. This is
 * only the ENV gate -- the warm-only thread gate (lib/open-tracking-gate.ts)
 * and the per-team runtime kill-switch (teams.open_tracking_paused) still apply.
 */
export function isOpenTrackingEnvOn(): boolean {
  if (!env.TRACKING_BASE_URL) return false;
  const flag = env.EMAIL_OPEN_TRACKING_ENABLED;
  return flag !== "0" && flag !== "false";
}

/**
 * Assert that a Phase-N variable is present at the moment a feature needs it.
 * Use at feature entry points (e.g. NextAuth handlers, Google Maps callers).
 *
 * Example:
 *   requireEnv("GOOGLE_OAUTH_CLIENT_ID", "google-oauth");
 */
export function requireEnv<K extends keyof typeof env>(
  key: K,
  featureName: string,
): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Environment variable ${key} is required for ${featureName} but is not set. Check .env.example for the full list and group.`,
    );
  }
  return value as NonNullable<(typeof env)[K]>;
}

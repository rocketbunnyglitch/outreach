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
  GOOGLE_OAUTH_CLIENT_ID: stringOptional,
  GOOGLE_OAUTH_CLIENT_SECRET: stringOptional,
  GOOGLE_WORKSPACE_DOMAIN: stringOptional,
  // Opt-in flag to enable the dev impersonation Credentials provider.
  // Necessary because Next.js standalone hard-codes NODE_ENV=production
  // at server.js startup, so we can't rely on NODE_ENV as the gate.
  // Set ENABLE_DEV_IMPERSONATION=1 in non-prod environments only.
  // NEVER set this in production — it lets anyone impersonate any staffer
  // who knows their primary_email.
  ENABLE_DEV_IMPERSONATION: stringOptional,

  // --- Phase 5: lead generation ---
  GOOGLE_MAPS_API_KEY: stringOptional,
  ZEROBOUNCE_API_KEY: stringOptional,

  // --- Phase 6: outreach ---
  POSTMARK_FALLBACK_SERVER_TOKEN: stringOptional,
  POSTMARK_FALLBACK_SENDER: stringOptional,
  QUO_API_KEY: stringOptional,
  QUO_API_BASE_URL: urlString.optional(),
  // For verifying inbound POSTs to /api/webhooks/quo
  QUO_WEBHOOK_SIGNING_SECRET: stringOptional,

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

  // --- Phase 7: confirmation automations ---
  PUPPETEER_EXECUTABLE_PATH: stringOptional,

  // --- Phase 8: external sync + backups ---
  EVENTBRITE_FALLBACK_TOKEN: stringOptional,
  // Org-wide EB OAuth token — all linked events live on this account
  EVENTBRITE_PRIVATE_TOKEN: stringOptional,
  B2_BUCKET: stringOptional,

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

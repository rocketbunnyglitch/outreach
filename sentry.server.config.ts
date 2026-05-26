/**
 * Sentry server-runtime configuration.
 *
 * Loaded by Next.js for Server Components, Server Actions, and API
 * route handlers. Initializes the Sentry SDK with the DSN from env.
 *
 * Graceful degrade: when SENTRY_DSN is unset, init() is a no-op —
 * the SDK is effectively disabled and the app runs normally. This
 * matches the rest of the platform's "vendor key gates feature"
 * pattern (Quo, Eventbrite, ZeroBounce, Places).
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Tag every event with the build version + git commit so the
    // operator can correlate Sentry issues with a specific deploy.
    release: process.env.BUILD_VERSION ?? undefined,

    environment: process.env.NODE_ENV ?? "production",

    // Sampling — keep error rate at 100% (the whole point of error
    // tracking) but performance traces at 10% to stay under the free
    // tier ceiling (5K events/month). Override at deploy time via
    // SENTRY_TRACES_SAMPLE_RATE if you upgrade Sentry plan.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),

    // Capture useful spans by default. The pg + http integrations
    // are already enabled by @sentry/nextjs.
    sendDefaultPii: false,

    // Don't capture body content — staff communications can contain
    // private venue info. Tagging the request URL + status code is
    // enough for debugging without leaking content.
    beforeSend(event) {
      if (event.request) {
        // biome-ignore lint/performance/noDelete: explicit privacy scrub
        delete event.request.data;
        // biome-ignore lint/performance/noDelete: explicit privacy scrub
        delete event.request.cookies;
      }
      return event;
    },

    // Don't spam Sentry with known-noisy errors. Add to this list
    // when something is loud and not actionable.
    ignoreErrors: [
      // Redirect-style throws from Next.js are control flow, not errors
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
      // Common cancelled-fetch noise
      "AbortError",
      "TypeError: Failed to fetch",
    ],
  });
}

/**
 * Sentry edge-runtime configuration.
 *
 * Loaded by Next.js middleware and any route handler running on the
 * Edge runtime. Lighter than the Node config — no Node-only APIs are
 * available here.
 *
 * Graceful degrade: no-op when SENTRY_DSN isn't set.
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.BUILD_VERSION ?? undefined,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        // biome-ignore lint/performance/noDelete: explicit privacy scrub
        delete event.request.data;
        // biome-ignore lint/performance/noDelete: explicit privacy scrub
        delete event.request.cookies;
      }
      return event;
    },
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "AbortError", "TypeError: Failed to fetch"],
  });
}

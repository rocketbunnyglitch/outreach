/**
 * Sentry browser-runtime configuration.
 *
 * Loaded into the client bundle. Sends client-side errors + UX
 * performance traces (Web Vitals, navigation timings) to Sentry.
 *
 * The DSN is read from NEXT_PUBLIC_SENTRY_DSN — the NEXT_PUBLIC_
 * prefix is required for browser-accessible env vars. Without it,
 * the client SDK initializes to a no-op and never makes network
 * calls.
 *
 * Privacy:
 *   • Session replay is OFF by default — staff communications can
 *     contain private venue info and we don't want to record forms
 *   • beforeSend strips request bodies and cookies before transmission
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    release: process.env.NEXT_PUBLIC_BUILD_VERSION ?? undefined,
    environment: process.env.NEXT_PUBLIC_NODE_ENV ?? "production",
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
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
    ignoreErrors: [
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
      "AbortError",
      "TypeError: Failed to fetch",
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
  });
}

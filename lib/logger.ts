/**
 * Structured logging via Pino.
 *
 * In development, pino-pretty makes output readable. In production, JSON lines
 * to stdout, captured by PM2 to ~/.pm2/logs/crawl-engine-*.log.
 *
 * Always include enough context for incident response: request ID, brand
 * context, staff ID, venue ID. Never log secrets, OAuth tokens, or full
 * email bodies. First 200 chars of an email is fine for debugging; full
 * body is fine in the DB but never the logs.
 */

import pino, { type Logger } from "pino";
import { env } from "./env";

const isDev = env.NODE_ENV === "development";

export const logger: Logger = pino({
  level: isDev ? "debug" : "info",
  base: {
    app: "crawl-engine",
    version: env.BUILD_VERSION ?? "0.0.0-dev",
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.api_key",
      "*.authorization",
      "*.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname,app,version",
          },
        },
      }
    : {}),
});

/**
 * Child logger with a request scope. Use in API routes and server actions:
 *   const log = childLogger({ requestId, staffId });
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

/**
 * Send an exception to Sentry AND log it locally with full context.
 *
 * Use this instead of bare `logger.error(...)` when something genuinely
 * went wrong and the operator should see it in Sentry's dashboard —
 * caught DB errors, failed external API calls, unexpected branches.
 *
 * Safe to call without SENTRY_DSN set: the Sentry SDK is a no-op when
 * uninitialized, so this still logs via Pino either way.
 *
 *   try {
 *     await fetchEventbriteSales(eventId);
 *   } catch (err) {
 *     captureException(err, { tag: "eventbrite_sync", eventId });
 *     return null;
 *   }
 */
export async function captureException(
  err: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  // Always log locally first — Sentry might be down or unconfigured,
  // and PM2 log files are the source of truth on the VPS.
  logger.error({ err, ...context }, "captureException");

  // Dynamic import so the Sentry SDK never enters the cold-path bundle
  // for callers who never error. Safe on both Node + Edge runtimes.
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    // Never let Sentry failures hide the original problem
    logger.warn({ sentryErr }, "Sentry captureException failed");
  }
}

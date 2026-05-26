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

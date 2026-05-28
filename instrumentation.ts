/**
 * Next.js 15 instrumentation entry point.
 *
 * Called by Next.js once when the server starts up, for each runtime
 * the app uses (Node + Edge). We branch on the runtime and import the
 * matching Sentry config. Sentry.client.config.ts loads automatically
 * via the bundler — no manual import needed here.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Capture errors from nested React Server Components — Next.js 15 wires
 * this to Sentry's captureRequestError automatically when available.
 *
 * Belt-and-suspenders local logging
 * ---------------------------------
 * The PRIMARY purpose of this hook used to be Sentry forwarding. The bug
 * (carryover from operator session 11): when SENTRY_DSN was unset, OR
 * when Sentry itself was down, the hook returned early and the error
 * never reached pm2 logs. Server Component crashes silently disappeared
 * — operators saw the error page in the browser, engineers saw nothing
 * in `pm2 logs outreach`.
 *
 * Fix: log via Pino FIRST, regardless of Sentry status. The lib/logger.ts
 * captureException wrapper handles both sinks atomically (local +
 * optional Sentry forward), so we route through that single entry
 * point and inherit:
 *   - structured Pino JSON line on stdout (pm2 captures)
 *   - Sentry forward only when DSN is set
 *   - Sentry failures don't hide the original error
 *
 * The Next.js-specific captureRequestError call below still runs in
 * addition. That's the channel that ties the error to a Sentry
 * request/trace ID — useful when Sentry IS configured. The redundant
 * pino entry exists for the always-on case.
 */
export async function onRequestError(
  err: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[]>;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
    renderSource:
      | "react-server-components"
      | "react-server-components-payload"
      | "server-rendering";
    revalidateReason: "on-demand" | "stale" | undefined;
    renderType: "dynamic" | "dynamic-resume";
  },
) {
  // Always log locally first via the captureException wrapper. The
  // wrapper writes a structured Pino line + (only when DSN is set)
  // forwards to Sentry. So even unconfigured envs leave a trace in
  // pm2 logs.
  //
  // Dynamic import: instrumentation.ts loads at server boot, but
  // lib/logger.ts pulls in env validation which doesn't run until
  // after Next.js has finished its own init. The lazy import avoids
  // a chicken-and-egg.
  try {
    const { captureException } = await import("./lib/logger");
    await captureException(err, {
      source: "onRequestError",
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
    });
  } catch {
    // If even the logger import fails, fall back to stderr so
    // PM2 still captures something. console.error is safe even
    // before any module init has completed.
    console.error("[onRequestError] logger import failed", err);
  }

  // Tie the error to a Sentry trace ID + request span when Sentry
  // is configured. Skipped when no DSN — the pino entry above is the
  // only sink in that case.
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(err, request, context);
  } catch {
    // Already logged via pino above; Sentry failure is non-fatal.
  }
}

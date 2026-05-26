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
 * Without a DSN this is a harmless no-op.
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
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, context);
}

import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * Build-time variables. Set by scripts/build-with-version.sh (production)
 * or fall back to development values (local). Exposed to server components
 * via process.env; never sent to the browser unless explicitly prefixed with
 * NEXT_PUBLIC_, which we don't do for these — the version footer is rendered
 * server-side and inlined as HTML.
 */
const env = {
  BUILD_VERSION: process.env.BUILD_VERSION ?? "0.0.0-dev",
  BUILD_COMMIT: process.env.BUILD_COMMIT ?? "local",
  BUILD_AT: process.env.BUILD_AT ?? new Date().toISOString(),
};

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Standalone output keeps deploy bundles small for ZIP-based deploys.
  output: "standalone",

  // Expose build-time vars to server runtime. Note: env values in next.config
  // are read at build time and baked into the output. For runtime-changing
  // values, use process.env directly in server code.
  env,

  // We never serve images from third parties without an allowlist.
  // shadcn/ui + Tailwind + our own assets only for now.
  images: {
    remotePatterns: [],
  },

  // Sensible defaults for a server-rendered admin app behind Caddy.
  serverExternalPackages: ["pg", "ioredis", "bullmq"],

  // Compress responses (Caddy also compresses, but keeping at app level
  // ensures consistency in dev where there's no proxy).
  compress: true,
};

/**
 * Sentry wrapping is a no-op when SENTRY_DSN isn't set — the SDK simply
 * doesn't initialize, and withSentryConfig's source-map upload step also
 * skips silently. The app builds and runs identically without Sentry
 * configured; turning it on is a pure-env decision at deploy time.
 *
 * widenClientFileUpload: include large source maps so client stack traces
 *   are readable in production
 * disableLogger: drop the verbose Sentry init logger from the prod bundle
 * automaticVercelMonitors: irrelevant on our VPS deploy but harmless
 */
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Tree-shake debug logs out of prod via webpack instead of the
  // deprecated disableLogger flag.
  reactComponentAnnotation: { enabled: false },
  // Skip source-map upload when no auth token — keeps local + CI-less
  // builds fast and avoids the "no SENTRY_AUTH_TOKEN" warning every build.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});

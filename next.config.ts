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

  // Security headers (FULL_AUDIT P337): the proxy adds none, so the app
  // ships them. Conservative set — no CSP yet (Next's inline runtime
  // scripts need nonce plumbing first; X-Frame-Options covers the
  // clickjacking case CSP frame-ancestors would).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },

  // Deployment-skew protection. Tags every static-asset + RSC/Server-Action
  // request with this build's id (the git SHA, already exported as
  // BUILD_COMMIT by scripts/deploy.sh). When a tab opened on an OLD build
  // makes a request after a deploy, Next detects the id mismatch and does a
  // clean hard navigation to the current build instead of failing with
  // "Failed to find Server Action" / a half-hydrated freeze. This is the
  // durable cure for the recurring "it froze / nothing happens after a
  // deploy" reports (the client-side chunk-reload guard is the backstop).
  // Baked at build time; falls back to undefined locally (no skew there).
  deploymentId: process.env.NEXT_DEPLOYMENT_ID ?? process.env.BUILD_COMMIT ?? undefined,

  // Server Action request-body limit. Default is 1 MB. The Halloween
  // 2025 review-queue action receives the full dry-run ImportReport
  // (derived from the ~2 MB data/halloween_2025.json) as its argument,
  // which Next rejects with 413 "Body exceeded 1 MB limit" BEFORE the
  // action runs — surfacing to the operator as a generic 500. 4 MB gives
  // headroom over the current report size.
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },

  // Standalone output keeps deploy bundles small for ZIP-based deploys.
  output: "standalone",

  // Expose build-time vars to server runtime. Note: env values in next.config
  // are read at build time and baked into the output. For runtime-changing
  // values, use process.env directly in server code.
  env,

  // We never serve images from third parties without an allowlist.
  // shadcn/ui + Tailwind + our own assets only for now.
  //
  // unoptimized: the `sharp` native binary for linux-x64 fails to load in
  // the standalone runtime ("Could not load the sharp module using the
  // linux-x64 runtime"), so every /_next/image request 500s and all images
  // (logo, login art) break sitewide. We only serve a handful of static
  // first-party assets, so on-the-fly resizing/format-conversion buys us
  // nothing — bypass the optimizer entirely. This renders next/image as a
  // plain <img src=originalsrc>, removing the sharp dependency from the
  // critical path. (If we ever need true optimization, install the linux
  // sharp binary into the standalone bundle and drop this flag.)
  images: {
    remotePatterns: [],
    unoptimized: true,
  },

  // Sensible defaults for a server-rendered admin app behind Caddy.
  serverExternalPackages: ["pg", "ioredis", "bullmq"],

  // Non-code data files Next.js needs to copy into the standalone
  // output. Without this, files under data/ are stripped at build
  // time and server actions that read them (e.g. the campaign
  // imports) crash with ENOENT against
  // /var/www/.../.next/standalone/data/<file>.json. The trace key
  // is the route path that reads the file; the value lists the
  // patterns to include from the repo root.
  //
  // ./data/**/*.json covers all 6 campaign JSONs + their per-campaign
  // resolver-overrides files. Belt-and-suspenders with deploy.sh's
  // `cp -r data/.` step — that copies at deploy time, this includes
  // at build time. Either alone is sufficient; both ensures the
  // file is present regardless of which build path the bundle takes.
  outputFileTracingIncludes: {
    "/admin": ["./data/**/*.json"],
    "/admin/**/*": ["./data/**/*.json"],
  },

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

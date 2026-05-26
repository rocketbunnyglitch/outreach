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

export default config;

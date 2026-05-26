/**
 * Version info read from build-time environment variables.
 *
 * In production, scripts/build-with-version.sh sets these before `next build`:
 *   BUILD_VERSION   — semver from the VERSION file (e.g. "0.4.2")
 *   BUILD_COMMIT    — short git SHA (e.g. "7a3f1c2")
 *   BUILD_AT        — ISO 8601 timestamp (e.g. "2026-06-14T18:22:41Z")
 *
 * In dev, they fall back to placeholder values. The version footer renders
 * "0.0.0-dev · local · <boot-time>" locally, which is the cue that you're
 * looking at a dev build.
 *
 * Why read process.env directly here (and not via lib/env.ts):
 * lib/env.ts validates startup env. These three are baked into the build by
 * Next.js at compile time via next.config.ts's `env` block, so they're
 * available at any phase of execution without re-validation.
 */

export interface VersionInfo {
  /** Semver. "0.0.0-dev" in development. */
  version: string;
  /** Short git SHA. "local" in development. */
  commit: string;
  /** Build timestamp, ISO 8601. Boot time in development. */
  builtAt: string;
}

export function getVersion(): VersionInfo {
  return {
    version: process.env.BUILD_VERSION ?? "0.0.0-dev",
    commit: process.env.BUILD_COMMIT ?? "local",
    builtAt: process.env.BUILD_AT ?? new Date().toISOString(),
  };
}

/**
 * Short, single-line representation for the version footer.
 * Example: "v0.4.2 · 7a3f1c2 · 2026-06-14T18:22Z"
 */
export function getVersionLine(): string {
  const { version, commit, builtAt } = getVersion();
  // Trim ISO 8601 to minute precision for compactness in the footer.
  const trimmed = `${builtAt.slice(0, 16)}Z`;
  return `v${version} · ${commit} · ${trimmed}`;
}

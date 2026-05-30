#!/usr/bin/env bash
#
# scripts/build-with-version.sh — wraps `next build` with build-time env vars
# so the version footer and lib/version.ts have accurate info.
#
# Injected:
#   BUILD_VERSION  — semver from the VERSION file
#   BUILD_COMMIT   — git rev-parse --short HEAD (or "unknown" outside a repo)
#   BUILD_AT       — ISO 8601 UTC timestamp of the build
#
# Called by:
#   - `pnpm build` locally
#   - CI on every PR (typecheck + build, no deploy)
#   - The release pipeline before zipping for deploy
#

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Version: prefer the VERSION file (canonical), fall back to package.json.
if [[ -f VERSION ]]; then
  BUILD_VERSION=$(tr -d '[:space:]' < VERSION)
else
  BUILD_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0-unknown")
fi

# Commit: short SHA. Empty in CI checkouts? Use $GITHUB_SHA as a fallback.
if BUILD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null); then
  : # ok
elif [[ -n "${GITHUB_SHA:-}" ]]; then
  BUILD_COMMIT="${GITHUB_SHA:0:7}"
else
  BUILD_COMMIT="unknown"
fi

# Build time, ISO 8601 UTC.
BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

export BUILD_VERSION BUILD_COMMIT BUILD_AT

# Next's build worker crashed with JavaScript heap out of memory
# after dep tree growth (adding googleapis pushed it over Node's
# default ~1.7 GB heap on this Node 22 build). 3072 MB is well
# inside the VPS's 5.8 GB and matches the heap Next.js recommends
# for prod builds at this code size.
# Honors any caller-provided NODE_OPTIONS instead of clobbering them.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=3072"

echo "Building crawl-engine"
echo "  version: ${BUILD_VERSION}"
echo "  commit:  ${BUILD_COMMIT}"
echo "  at:      ${BUILD_AT}"
echo "  heap:    ${NODE_OPTIONS}"
echo ""

exec next build

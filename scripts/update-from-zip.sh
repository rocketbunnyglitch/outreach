#!/usr/bin/env bash
#
# scripts/update-from-zip.sh — operator-proof update for installed deployments.
#
# Modeled on the promoter-engine deploy pattern (same server, consistent
# operator muscle memory — DECISIONS.md#003).
#
# Usage:
#   bash scripts/update-from-zip.sh /tmp/crawl-engine-x.y.z.zip
#
# What it does:
#   1. Verifies the zip is a valid crawl-engine release
#   2. Snapshots .env, .next/, node_modules/ keys into a timestamped backup dir
#   3. Extracts the new zip into a temp directory
#   4. rsyncs the new code into the app dir, PRESERVING:
#         .env, data/, logs/, node_modules/, .next/cache/
#   5. Runs pnpm install --prod, then pnpm db:migrate
#   6. Runs `pnpm build` (with version injection) if dist not pre-built
#   7. Restarts via PM2 (pm2 restart crawl-engine)
#   8. Verifies /api/health returns 200 and version matches the new release
#
# Exit codes:
#   0 — success, /api/health returns 200, version matches.
#   1 — pre-flight failure (bad zip, missing dirs). No changes made.
#   2 — mid-flight failure AFTER rsync. Print rollback steps.
#   3 — post-restart health check failed. Code IS new version; investigate.
#
# Configuration via env (override at invocation time):
#   APP_DIR                  default: /var/www/crawl-engine
#   PM2_NAME                 default: crawl-engine
#   HEALTH_URL               default: http://127.0.0.1:3001/api/health
#   SKIP_BUILD=1             use if dist is pre-built in the zip
#   SKIP_DB_MIGRATE=1        emergency rollforward only
#   SKIP_RESTART=1           operator handles restart

set -u

# Cleaner error messages without set -e
# (we want explicit rollback instructions on failure)

APP_DIR="${APP_DIR:-/var/www/crawl-engine}"
PM2_NAME="${PM2_NAME:-crawl-engine}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
ZIP_PATH="${1:-}"

if [[ -t 1 ]]; then
  C_RESET='\033[0m'; C_RED='\033[0;31m'; C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'; C_BLUE='\033[0;34m'; C_BOLD='\033[1m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''
fi

log() { echo -e "${C_BLUE}[$(date +%H:%M:%S)]${C_RESET} $*"; }
ok()  { echo -e "${C_GREEN}  ✓${C_RESET} $*"; }
warn(){ echo -e "${C_YELLOW}  ⚠${C_RESET} $*"; }
err() { echo -e "${C_RED}  ✗${C_RESET} $*"; }

# =====================================================================
# Pre-flight
# =====================================================================

if [[ -z "${ZIP_PATH}" ]]; then
  err "Usage: $0 /path/to/crawl-engine-X.Y.Z.zip"
  exit 1
fi

if [[ ! -f "${ZIP_PATH}" ]]; then
  err "Zip not found: ${ZIP_PATH}"
  exit 1
fi

if ! command -v unzip >/dev/null; then
  err "unzip not installed"
  exit 1
fi

if [[ ! -d "${APP_DIR}" ]]; then
  err "App directory does not exist: ${APP_DIR}"
  err "Run scripts/setup-server.sh first."
  exit 1
fi

# Validate the zip looks like a crawl-engine release.
log "Validating zip..."
if ! unzip -l "${ZIP_PATH}" 2>/dev/null | grep -q "package.json"; then
  err "Zip does not appear to be a crawl-engine release (no package.json found)"
  exit 1
fi
ok "Zip looks valid"

# Extract package name + version from inside the zip without extracting everything.
TMP_VALIDATE=$(mktemp -d)
unzip -j -q "${ZIP_PATH}" "*/package.json" -d "${TMP_VALIDATE}" 2>/dev/null || true
NEW_VERSION=$(node -p "require('${TMP_VALIDATE}/package.json').version" 2>/dev/null || echo "unknown")
NEW_NAME=$(node -p "require('${TMP_VALIDATE}/package.json').name" 2>/dev/null || echo "unknown")
rm -rf "${TMP_VALIDATE}"

if [[ "${NEW_NAME}" != "crawl-engine" ]]; then
  err "Zip package name is '${NEW_NAME}', expected 'crawl-engine'"
  exit 1
fi
ok "Release version: ${NEW_VERSION}"

# =====================================================================
# Snapshot
# =====================================================================

TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${APP_DIR}/.backups/deploy-${TS}"
log "Snapshotting current state → ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# Preserve env + version markers for rollback reference.
if [[ -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env" "${BACKUP_DIR}/.env"
fi
if [[ -f "${APP_DIR}/VERSION" ]]; then
  cp "${APP_DIR}/VERSION" "${BACKUP_DIR}/VERSION.prev"
fi
ok "Snapshot complete"

# =====================================================================
# Extract
# =====================================================================

TMP_EXTRACT=$(mktemp -d)
log "Extracting zip → ${TMP_EXTRACT}"
unzip -q "${ZIP_PATH}" -d "${TMP_EXTRACT}" || { err "unzip failed"; exit 2; }

# Zip layout is crawl-engine-X.Y.Z/<files>. Find the actual root.
EXTRACT_ROOT=$(find "${TMP_EXTRACT}" -mindepth 1 -maxdepth 1 -type d | head -1)
if [[ -z "${EXTRACT_ROOT}" ]]; then
  err "Could not find extracted root directory"
  rm -rf "${TMP_EXTRACT}"
  exit 2
fi
ok "Extracted to ${EXTRACT_ROOT}"

# =====================================================================
# rsync new code in, preserving local state
# =====================================================================

log "Syncing new code into ${APP_DIR}..."
rsync -a --delete \
  --exclude=".env" \
  --exclude=".env.local" \
  --exclude="node_modules" \
  --exclude=".next/cache" \
  --exclude=".backups" \
  --exclude="logs" \
  --exclude="data" \
  "${EXTRACT_ROOT}/" "${APP_DIR}/" \
  || { err "rsync failed"; rm -rf "${TMP_EXTRACT}"; exit 2; }

rm -rf "${TMP_EXTRACT}"
ok "Code synced"

# =====================================================================
# Dependencies + DB migrations + build
# =====================================================================

cd "${APP_DIR}" || { err "cd to ${APP_DIR} failed"; exit 2; }

log "Installing dependencies (pnpm install --prod)..."
pnpm install --prod --frozen-lockfile || {
  err "pnpm install failed"
  warn "App may not start. Rollback: see snapshot in ${BACKUP_DIR}"
  exit 2
}
ok "Dependencies installed"

if [[ "${SKIP_DB_MIGRATE:-0}" == "1" ]]; then
  warn "Skipping DB migrations (SKIP_DB_MIGRATE=1)"
else
  log "Running DB migrations..."
  pnpm db:migrate || {
    err "DB migration failed"
    warn "Rollback: see ${BACKUP_DIR} and the latest pg backup at /var/backups/crawl-engine/"
    exit 2
  }
  ok "Migrations applied"
fi

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  warn "Skipping build (SKIP_BUILD=1)"
elif [[ -d "${APP_DIR}/.next/standalone" ]] && [[ -d "${APP_DIR}/.next/static" ]]; then
  ok "Pre-built .next found, skipping build"
else
  log "Building..."
  pnpm build || {
    err "Build failed"
    exit 2
  }
  ok "Build complete"
fi

# =====================================================================
# Restart
# =====================================================================

if [[ "${SKIP_RESTART:-0}" == "1" ]]; then
  warn "Skipping restart (SKIP_RESTART=1)"
else
  log "Restarting PM2 process '${PM2_NAME}'..."
  if pm2 list | grep -q "${PM2_NAME}"; then
    pm2 restart "${PM2_NAME}" --update-env || { err "PM2 restart failed"; exit 2; }
  else
    pm2 start ecosystem.config.cjs || { err "PM2 start failed"; exit 2; }
  fi
  pm2 save >/dev/null 2>&1 || true
  ok "Process restarted"
fi

# =====================================================================
# Verify
# =====================================================================

log "Waiting 3s for boot..."
sleep 3

log "Verifying /api/health → ${HEALTH_URL}"
HEALTH_RESPONSE=$(curl -s -o /tmp/health-resp -w "%{http_code}" "${HEALTH_URL}" || echo "000")

if [[ "${HEALTH_RESPONSE}" == "200" ]]; then
  RUNNING_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/health-resp','utf8')).version)" 2>/dev/null || echo "?")
  if [[ "${RUNNING_VERSION}" == "${NEW_VERSION}" ]]; then
    ok "Health check OK — running v${RUNNING_VERSION}"
  else
    err "Health OK but version mismatch: expected ${NEW_VERSION}, running ${RUNNING_VERSION}"
    exit 3
  fi
else
  err "Health check failed: HTTP ${HEALTH_RESPONSE}"
  cat /tmp/health-resp 2>/dev/null
  exit 3
fi

rm -f /tmp/health-resp

# =====================================================================
# Done
# =====================================================================

echo
echo -e "${C_GREEN}${C_BOLD}Deploy complete: v${NEW_VERSION}${C_RESET}"
echo "Snapshot: ${BACKUP_DIR}"
echo "Logs:     pm2 logs ${PM2_NAME}"
exit 0

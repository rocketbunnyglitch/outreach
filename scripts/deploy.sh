#!/bin/bash
#
# Outreach engine deploy script.
#
# What this does, in order:
#   1. Pulls latest code from GitHub (origin/main)
#   2. Installs any new npm dependencies
#   3. Applies any new SQL migrations (idempotent — safe to re-run)
#   4. Builds the Next.js standalone bundle
#   5. Copies static assets into the standalone tree
#   6. Reloads the PM2 process with zero downtime (preserves old process
#      until new one passes its first request)
#   7. Hits the health endpoint and exits non-zero if it fails
#
# Idempotent and safe to re-run. If anything fails, the old version stays
# running. Exit codes:
#   0 — deploy successful
#   1 — pre-flight check failed (wrong directory, missing .env, etc.)
#   2 — git pull failed (network issue, conflicts, etc.)
#   3 — npm install failed
#   4 — DB migration failed
#   5 — build failed
#   6 — pm2 reload failed
#   7 — health check failed after deploy
#
# Usage:
#   bash /root/deploy.sh                # standard deploy
#   bash /root/deploy.sh --skip-build   # skip rebuild (for non-code changes)
#   bash /root/deploy.sh --rollback     # roll back one commit and redeploy
#
# Logs to /var/log/outreach-deploy.log in addition to stdout.

set -euo pipefail

APP_DIR="/var/www/outreach"
LOG_FILE="/var/log/outreach-deploy.log"
PM2_NAME="outreach"
HEALTH_URL="http://127.0.0.1:3001/api/health"
NODE_MAX_OLD_SPACE="1536"

# === Parse flags ===
SKIP_BUILD=0
ROLLBACK=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --rollback) ROLLBACK=1 ;;
    --force) FORCE=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# === Helper for timestamped log lines ===
log() {
  local msg="$1"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $msg" | tee -a "$LOG_FILE"
}

trap 'log "FAIL: deploy exited at line $LINENO"' ERR

# === Pre-flight checks ===
log "=== Outreach deploy starting ==="
[ -d "$APP_DIR" ] || { log "ERROR: $APP_DIR doesn't exist"; exit 1; }
[ -f "$APP_DIR/.env" ] || { log "ERROR: $APP_DIR/.env missing"; exit 1; }
[ -f "$APP_DIR/package.json" ] || { log "ERROR: not an outreach checkout"; exit 1; }

cd "$APP_DIR"

# Pre-deploy snapshot — what version are we on?
PREV_COMMIT=$(git rev-parse HEAD)
log "current commit: $PREV_COMMIT"

# === Step 1: Pull (or rollback) ===
if [ "$ROLLBACK" = "1" ]; then
  log "ROLLBACK requested — moving HEAD back one commit"
  git reset --hard HEAD~1
  TARGET_COMMIT=$(git rev-parse HEAD)
  log "rolled back to: $TARGET_COMMIT"
else
  log "fetching origin/main from GitHub..."
  git fetch origin main 2>&1 | tee -a "$LOG_FILE"
  TARGET_COMMIT=$(git rev-parse origin/main)
  DEPLOYED_COMMIT=""
  if [ -f .next/.deployed-commit ]; then
    DEPLOYED_COMMIT=$(tr -d '[:space:]' < .next/.deployed-commit)
  fi
  log "target: $TARGET_COMMIT"
  log "last deployed: ${DEPLOYED_COMMIT:-<unknown>}"
  if [ "$FORCE" != "1" ] && [ -n "$DEPLOYED_COMMIT" ] && [ "$DEPLOYED_COMMIT" = "$TARGET_COMMIT" ]; then
    log "deployed commit matches target — nothing to deploy (pass --force to rebuild anyway)"
    exit 0
  fi
  log "deploying ${DEPLOYED_COMMIT:-<unknown>} → $TARGET_COMMIT"
  git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"
  # Keep /root/deploy.sh in sync with the repo's canonical script.
  if [ -f /root/deploy.sh ] && ! cmp -s scripts/deploy.sh /root/deploy.sh; then
    log "syncing /root/deploy.sh from scripts/deploy.sh"
    cp scripts/deploy.sh /root/deploy.sh
    chmod +x /root/deploy.sh
  fi
fi

# === Step 2: npm ci ===
log "installing dependencies (npm ci)..."
npm ci --no-audit --no-fund 2>&1 | tail -10 | tee -a "$LOG_FILE"

# === Step 3: Apply migrations ===
# Loads .env to get DATABASE_URL
log "applying SQL migrations..."
set -a
. "$APP_DIR/.env"
set +a

# Parse DATABASE_URL into psql-friendly env vars
# Format: postgresql://USER:PASSWORD@HOST:PORT/DBNAME
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

PSQL="PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1 -X -q -t"

# Ensure tracking table exists. This is itself idempotent.
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q -c "
CREATE TABLE IF NOT EXISTS _outreach_migrations_applied (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text
);
" >/dev/null

# Bootstrap: on the first run after introducing this tracking, mark every
# migration that's been applied as such. We detect "already applied" by
# checking whether the audit_log table exists (a Phase 1 migration creates
# it). If it does AND the tracking table is empty, we backfill.
ALREADY_APPLIED_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -t -A -c \
  "SELECT count(*) FROM _outreach_migrations_applied;")
AUDIT_LOG_EXISTS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_log';")

if [ "$ALREADY_APPLIED_COUNT" = "0" ] && [ "$AUDIT_LOG_EXISTS" = "1" ]; then
  log "  bootstrap: marking all existing migrations as already-applied"
  for f in db/migrations/*.sql; do
    filename=$(basename "$f")
    checksum=$(md5sum "$f" | awk '{print $1}')
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -c \
      "INSERT INTO _outreach_migrations_applied (filename, checksum) VALUES ('$filename', '$checksum') ON CONFLICT (filename) DO NOTHING;" >/dev/null
    log "    bootstrap-recorded $filename"
  done
fi

# Apply each migration only if not yet recorded.
for f in db/migrations/*.sql; do
  filename=$(basename "$f")
  checksum=$(md5sum "$f" | awk '{print $1}')
  existing=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -t -A -c \
    "SELECT checksum FROM _outreach_migrations_applied WHERE filename='$filename';")
  if [ -n "$existing" ]; then
    if [ "$existing" != "$checksum" ]; then
      log "  WARN: $filename has been modified since last apply (checksum mismatch). Skipping anyway."
    else
      log "  skip $filename (already applied)"
    fi
    continue
  fi
  log "  applying $filename (new)"
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "$f" 2>&1 | tail -3 | tee -a "$LOG_FILE"
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -c \
    "INSERT INTO _outreach_migrations_applied (filename, checksum) VALUES ('$filename', '$checksum');" >/dev/null
done

# === Step 4: Build ===
if [ "$SKIP_BUILD" = "1" ]; then
  log "SKIP_BUILD set — skipping npm run build"
else
  log "building Next.js standalone bundle..."
  log "(this is the slow step — 4-7 min on 2GB RAM)"
  # Preserve the previous build's hashed static chunks so tabs opened
  # before this deploy can still fetch their immutable chunks instead of
  # 404 -> ChunkLoadError. Archived before `next build` wipes .next, then
  # merged back (no-clobber) after the fresh static is copied in.
  PREV_STATIC_ARCHIVE=""
  if [ -d .next/standalone/.next/static ]; then
    PREV_STATIC_ARCHIVE="$(mktemp -d)"
    cp -r .next/standalone/.next/static/. "$PREV_STATIC_ARCHIVE/" 2>/dev/null || true
  fi
  NODE_OPTIONS="--max-old-space-size=$NODE_MAX_OLD_SPACE" \
  BUILD_VERSION=$(git rev-parse --short HEAD) \
  BUILD_COMMIT=$(git rev-parse HEAD) \
  BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  npm run build 2>&1 | tail -10 | tee -a "$LOG_FILE"

  # Copy static assets into standalone tree (next build doesn't do this)
  cp -r .next/static .next/standalone/.next/
  # Merge prior build's chunks back without overwriting this build's files.
  if [ -n "$PREV_STATIC_ARCHIVE" ] && [ -d "$PREV_STATIC_ARCHIVE" ]; then
    cp -rn "$PREV_STATIC_ARCHIVE/." .next/standalone/.next/static/ 2>/dev/null || true
    rm -rf "$PREV_STATIC_ARCHIVE"
  fi
  [ -d public ] && cp -r public .next/standalone/ 2>/dev/null || true

  # Copy data/ — non-code import payloads (e.g. halloween_2025.json
  # for the Halloween 2025 import action). outputFileTracingIncludes
  # in next.config.ts SHOULD pull these in, but we also copy them
  # here as a belt-and-suspenders so the standalone tree always has
  # them. Idempotent: if data/ doesn't exist at the repo root, the
  # copy is a no-op.
  if [ -d data ]; then
    mkdir -p .next/standalone/data
    cp -r data/. .next/standalone/data/ 2>/dev/null || true
  fi
fi

# === Step 5: Reload PM2 (staggered across web instances) ===
# Two web instances (outreach :3001, outreach-2 :3003) sit behind nginx
# with failover. Reload them ONE AT A TIME with a per-port health gate
# between, so nginx always has a live instance — true zero-downtime, and
# both end on the new build (no split-brain serving stale chunks). If an
# instance won't come healthy we abort BEFORE touching the other, leaving
# it serving rather than risking a full outage.
reload_instance() {
  _name="$1"; _port="$2"
  if pm2 describe "$_name" >/dev/null 2>&1; then
    log "reloading $_name (:$_port)..."
    pm2 reload "$_name" --update-env 2>&1 | tail -3 | tee -a "$LOG_FILE"
  else
    log "$_name not registered — starting it from ecosystem.config.cjs"
    pm2 start ecosystem.config.cjs --only "$_name" --update-env 2>&1 | tail -3 | tee -a "$LOG_FILE"
  fi
  _ok=""
  for _i in $(seq 1 20); do
    if curl -fsS --max-time 4 "http://127.0.0.1:$_port/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      _ok=1; break
    fi
    sleep 1
  done
  if [ -n "$_ok" ]; then
    log "  ok $_name healthy on :$_port"
  else
    log "  FAIL $_name not healthy on :$_port — aborting before touching the other instance"
    exit 7
  fi
}

# Keep the failover instance's env file in sync with .env — identical
# secrets, only PORT differs (3001 -> 3003). Regenerated every deploy so
# it can never drift or go missing. instance "outreach-2" loads this via
# --env-file in ecosystem.config.cjs.
if [ -f "$APP_DIR/.env" ]; then
  sed 's/^PORT=3001$/PORT=3003/' "$APP_DIR/.env" > "$APP_DIR/.env.3003"
  chmod 600 "$APP_DIR/.env.3003"
fi

log "reloading web instances (staggered, zero-downtime)..."
reload_instance "$PM2_NAME" 3001
reload_instance "outreach-2" 3003

# Reload the WebSocket presence sidecar IF it's registered. It's a
# separate PM2 app ("outreach-ws", realtime/ws-server.mjs) wired up
# once on the box (nginx /ws + ecosystem entry). If it isn't registered
# yet, skip silently — the main deploy must not fail on its absence.
if pm2 describe outreach-ws >/dev/null 2>&1; then
  log "reloading PM2 process: outreach-ws..."
  pm2 reload outreach-ws --update-env 2>&1 | tail -5 | tee -a "$LOG_FILE"
else
  log "outreach-ws not registered yet — skipping (set it up per docs/server-setup.md)"
fi

pm2 save 2>&1 | tail -2 | tee -a "$LOG_FILE"

# === Step 6: Health check ===
log "waiting 5s for app to be ready..."
sleep 5

log "checking health endpoint..."
HEALTH_RESPONSE=$(curl -fsS --max-time 10 "$HEALTH_URL" || echo "FAIL")
if [[ "$HEALTH_RESPONSE" == *'"status":"ok"'* ]]; then
  log "✓ health check passed: $HEALTH_RESPONSE"
else
  log "✗ HEALTH CHECK FAILED — app may be down"
  log "response: $HEALTH_RESPONSE"
  log ""
  log "Recent pm2 logs for outreach:"
  pm2 logs "$PM2_NAME" --lines 30 --nostream 2>&1 | tail -40 | tee -a "$LOG_FILE"
  exit 7
fi

# === Done ===
# Record the successfully-deployed commit so the next run's guard works.
# CRITICAL: only stamp when we ACTUALLY built for this commit. With
# --skip-build the standalone bundle is whatever was there from the last
# real build, NOT $TARGET_COMMIT. If we stamped here, the next normal
# deploy would see "already deployed" and exit without rebuilding, so
# the app would keep running stale code despite git being at the new
# commit. Operator session 11 caught this: "deploy.sh skip-build bug".
mkdir -p .next
if [ "$SKIP_BUILD" = "1" ]; then
  log "skip-build was set — NOT stamping .next/.deployed-commit"
  log "  (next normal deploy will rebuild for $TARGET_COMMIT, as intended)"
else
  echo "$TARGET_COMMIT" > .next/.deployed-commit
  log "stamped .next/.deployed-commit = $TARGET_COMMIT"
fi

log ""
log "=========================================="
log "DEPLOY SUCCESSFUL"
log "  Previous commit: $PREV_COMMIT"
log "  Now running:     $TARGET_COMMIT"
log "  Health endpoint: OK"
log "=========================================="
log ""
log "If anything looks wrong, roll back with:"
log "  bash /root/deploy.sh --rollback"

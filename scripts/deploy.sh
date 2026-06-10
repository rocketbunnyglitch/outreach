#!/bin/bash
#
# Outreach engine deploy script -- ATOMIC RELEASE EDITION (2026-06-10).
#
# WHY: the previous script built IN-PLACE inside the live serving tree
# (/var/www/outreach), wiping/regenerating .next while both pm2 instances
# served from it. Every deploy caused a 4-7 minute window of
# "Application error" / ChunkLoadError for anyone using the site. Now each
# release builds in its own directory while the live release keeps serving
# untouched, and cutover is an atomic symlink flip + a health-gated reload.
#
# LAYOUT (one-time setup; see DEPLOY.md "Atomic release deploys"):
#   /var/www/outreach            -> SYMLINK to the active release dir
#   /var/www/outreach-releases/  -> one dir per release: <utc-ts>-<shortsha>/
#   /var/www/outreach-shared/    -> state that outlives releases:
#                                     .env             (secrets)
#                                     chunk-pool/      (old hashed chunks for stale tabs)
#                                     deployed-commit  (last successfully deployed sha)
#                                     release-history  (activation log, newest last)
#   /var/www/outreach-src        -> fetch-only git clone; releases are worktrees of it
#
# pm2 (outreach / outreach-2 / outreach-ws), nginx, and the /root cron
# scripts all reference /var/www/outreach/... paths -- they resolve through
# the symlink, so NONE of them needed changes for this layout.
#
# FLOW:
#   1. fetch origin/main into /var/www/outreach-src
#   2. worktree-add the target commit into a NEW release dir
#   3. npm ci + migration-safety scan + SQL migrations + reference docs
#      (migrations run BEFORE cutover -- they must be expand/contract safe,
#       see migration_guard below)
#   4. hydration gate + next build IN THE RELEASE DIR (live untouched)
#   5. chunk-pool merge + build-integrity gate
#   6. atomic symlink flip + staggered pm2 reload (per-port health gate)
#   7. SMOKE TEST (scripts/smoke-test.sh) -- on failure, AUTO-ROLLBACK to
#      the previous release and exit non-zero
#   8. stamp + prune old releases (keep last $KEEP_RELEASES)
#
# Exit codes:
#   0 ok | 1 preflight | 2 git | 3 npm | 4 migration (incl. safety guard)
#   5 build/gates | 6 pm2 | 7 health | 8 smoke failed (auto-rolled-back)
#
# Usage:
#   bash /root/deploy.sh                            # standard deploy
#   bash /root/deploy.sh --skip-build               # migrations/docs only, current release
#   bash /root/deploy.sh --rollback                 # INSTANT flip to previous release
#   bash /root/deploy.sh --force                    # rebuild even if commit unchanged
#   bash /root/deploy.sh --allow-unsafe-migration   # bypass the expand/contract guard
#
# NOTE: /root/deploy.sh self-syncs from the repo's scripts/deploy.sh at the
# start of each run (atomically, via rename), so changes to this file take
# effect on the NEXT run.

set -euo pipefail

APP_LINK="/var/www/outreach"
RELEASES_DIR="/var/www/outreach-releases"
SHARED_DIR="/var/www/outreach-shared"
SRC_DIR="/var/www/outreach-src"
LOG_FILE="/var/log/outreach-deploy.log"
PM2_NAME="outreach"
HEALTH_URL="http://127.0.0.1:3001/api/health"
NODE_MAX_OLD_SPACE="3072"
KEEP_RELEASES=4

# === Parse flags ===
SKIP_BUILD=0
ROLLBACK=0
FORCE=0
ALLOW_UNSAFE_MIGRATION=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --rollback) ROLLBACK=1 ;;
    --force) FORCE=1 ;;
    --allow-unsafe-migration) ALLOW_UNSAFE_MIGRATION=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

log() {
  local msg="$1"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $msg" | tee -a "$LOG_FILE"
}

trap 'log "FAIL: deploy exited at line $LINENO"' ERR

# Atomically repoint the live symlink. ln -sfn alone unlinks then creates
# (a tiny window where the path is missing); symlink-then-rename is a single
# rename(2) so readers never see a gap.
flip_to() {
  local target="$1"
  local tmp="$APP_LINK.tmp.$$"
  ln -s "$target" "$tmp"
  mv -T "$tmp" "$APP_LINK"
  log "ACTIVE RELEASE -> $target"
}

# === Build integrity gate (unchanged behavior, now parameterized by dir) ===
# An OOM-killed or otherwise incomplete `next build` can exit 0 yet omit
# chunks the build manifests reference -> ChunkLoadError / frozen pages.
verify_build() {
  local dir="$1"
  local sa="$dir/.next/standalone/.next"
  local missing=0 checked=0 rel
  for manifest in "$sa/app-build-manifest.json" "$sa/build-manifest.json"; do
    if [ ! -f "$manifest" ]; then
      log "  integrity: manifest missing: $manifest"
      missing=$((missing + 1))
      continue
    fi
    for rel in $(grep -oE '"static/[^"]+\.(js|css)"' "$manifest" | tr -d '"' | sort -u); do
      checked=$((checked + 1))
      if [ ! -f "$sa/$rel" ]; then
        log "  integrity: MISSING chunk $rel"
        missing=$((missing + 1))
      fi
    done
  done
  log "  integrity: checked $checked referenced chunks, $missing missing"
  if [ "$missing" -gt 0 ]; then
    log "x BUILD INTEGRITY FAILED -- $missing referenced chunk(s) absent. Aborting"
    log "  BEFORE cutover; the current release keeps serving. Re-run the deploy."
    exit 5
  fi
  log "  ok: build integrity OK"
}

# === Migration safety guard (Layer 3) ===
# Migrations run against the shared DB BEFORE the symlink flip, so the
# still-running OLD release must tolerate the new schema for a few seconds
# (and for as long as a rollback might stay active). Enforce expand/contract:
# additive-only changes now; destructive/renaming changes in a LATER deploy
# once no old code references the object. Line-based heuristic -- it can
# false-positive on comments; use --allow-unsafe-migration after a human
# review when a flagged migration is genuinely safe.
migration_guard() {
  local f="$1"
  local bad=0
  local hits
  hits=$(grep -nEi 'drop[[:space:]]+table|drop[[:space:]]+column' "$f" || true)
  if [ -n "$hits" ]; then log "  UNSAFE (drop): $hits"; bad=1; fi
  hits=$(grep -nEi 'rename[[:space:]]+(to|column)' "$f" || true)
  if [ -n "$hits" ]; then log "  UNSAFE (rename): $hits"; bad=1; fi
  hits=$(grep -nEi 'alter[[:space:]]+column[[:space:]]+[^ ]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type' "$f" || true)
  if [ -n "$hits" ]; then log "  UNSAFE (type change): $hits"; bad=1; fi
  # ADD COLUMN ... NOT NULL without a DEFAULT on the same line: blocks reads
  # AND breaks old-code INSERTs during the cutover window.
  hits=$(grep -nEi 'add[[:space:]]+column' "$f" | grep -Ei 'not[[:space:]]+null' | grep -Eiv 'default' || true)
  if [ -n "$hits" ]; then log "  UNSAFE (NOT NULL without DEFAULT): $hits"; bad=1; fi
  return $bad
}

# === Staggered, health-gated pm2 reload (unchanged behavior) ===
# "outreach" runs in pm2 CLUSTER mode (1 instance) so reload overlaps the
# old and new worker on :3001 -- a genuinely gapless reload. "outreach-2"
# is the idle warm spare on :3003 (nginx sends it no traffic) and reloads
# second. If an instance won't come healthy we abort before touching the
# next one.
reload_instance() {
  _name="$1"; _port="$2"
  if pm2 describe "$_name" >/dev/null 2>&1; then
    log "reloading $_name (:$_port)..."
    pm2 reload "$_name" --update-env 2>&1 | tail -3 | tee -a "$LOG_FILE"
  else
    log "$_name not registered -- starting it from ecosystem.config.cjs"
    pm2 start "$APP_LINK/ecosystem.config.cjs" --only "$_name" --update-env 2>&1 | tail -3 | tee -a "$LOG_FILE"
  fi
  _ok=""
  for _i in $(seq 1 30); do
    if curl -fsS --max-time 4 "http://127.0.0.1:$_port/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      _ok=1; break
    fi
    sleep 1
  done
  if [ -n "$_ok" ]; then
    log "  ok $_name healthy on :$_port"
  else
    log "  FAIL $_name not healthy on :$_port -- aborting before touching the other instance"
    return 1
  fi
}

reload_all() {
  reload_instance "$PM2_NAME" 3001 || return 1
  reload_instance "outreach-2" 3003 || return 1
  if pm2 describe outreach-ws >/dev/null 2>&1; then
    log "reloading pm2 process: outreach-ws..."
    pm2 reload outreach-ws --update-env 2>&1 | tail -3 | tee -a "$LOG_FILE"
  fi
  pm2 save 2>&1 | tail -1 | tee -a "$LOG_FILE"
}

# === Pre-flight ===
log "=== Outreach deploy starting (atomic-release) ==="
if [ ! -L "$APP_LINK" ]; then
  log "ERROR: $APP_LINK is not a symlink. The atomic-release layout has not"
  log "been set up on this box. See DEPLOY.md 'Atomic release deploys' for"
  log "the one-time setup, or restore the previous deploy.sh."
  exit 1
fi
[ -d "$RELEASES_DIR" ] || { log "ERROR: $RELEASES_DIR missing"; exit 1; }
[ -f "$SHARED_DIR/.env" ] || { log "ERROR: $SHARED_DIR/.env missing"; exit 1; }
[ -d "$SRC_DIR/.git" ] || { log "ERROR: $SRC_DIR is not a git clone"; exit 1; }
mkdir -p "$SHARED_DIR/chunk-pool"

CURRENT_RELEASE=$(readlink -f "$APP_LINK")
log "current release: $CURRENT_RELEASE"

# === Rollback: instant symlink flip, no rebuild ===
if [ "$ROLLBACK" = "1" ]; then
  HISTORY="$SHARED_DIR/release-history"
  [ -f "$HISTORY" ] || { log "ERROR: no release history at $HISTORY"; exit 1; }
  PREV=""
  while IFS= read -r line; do
    if [ -n "$line" ] && [ "$line" != "$CURRENT_RELEASE" ] && [ -d "$line" ]; then
      PREV="$line"
    fi
  done < "$HISTORY"
  if [ -z "$PREV" ]; then
    log "ERROR: no previous release found to roll back to"
    exit 1
  fi
  log "ROLLBACK: $CURRENT_RELEASE -> $PREV"
  flip_to "$PREV"
  reload_all || { log "x pm2 reload failed during rollback -- investigate immediately"; exit 6; }
  PREV_SHA=$(git -C "$PREV" rev-parse HEAD 2>/dev/null || echo "unknown")
  echo "$PREV_SHA" > "$SHARED_DIR/deployed-commit"
  echo "$PREV" >> "$HISTORY"
  log "running post-rollback smoke test (advisory)..."
  if [ ! -f "$PREV/scripts/smoke-test.sh" ]; then
    log "WARN: $PREV has no smoke-test.sh (pre-atomic release) -- checking health only"
    curl -fsS --max-time 8 "$HEALTH_URL" | tee -a "$LOG_FILE" || log "WARN: health check failed after rollback"
  elif bash "$PREV/scripts/smoke-test.sh" 2>&1 | tee -a "$LOG_FILE"; then
    log "ok: rollback smoke passed"
  else
    log "WARN: smoke test reported failures AFTER rollback -- the previous"
    log "release may share the problem. Investigate; do not deploy on top."
  fi
  log "ROLLBACK COMPLETE -- now serving $PREV ($PREV_SHA)"
  exit 0
fi

# === skip-build: run migrations + docs against the CURRENT release ===
if [ "$SKIP_BUILD" = "1" ]; then
  log "--skip-build: applying migrations + reference docs on current release only"
  RELEASE_DIR="$CURRENT_RELEASE"
  cd "$RELEASE_DIR"
else
  # === Step 1: fetch + create the new release dir ===
  log "fetching origin/main..."
  git -C "$SRC_DIR" fetch origin main 2>&1 | tee -a "$LOG_FILE"
  TARGET_COMMIT=$(git -C "$SRC_DIR" rev-parse origin/main)
  DEPLOYED_COMMIT=""
  if [ -f "$SHARED_DIR/deployed-commit" ]; then
    DEPLOYED_COMMIT=$(tr -d '[:space:]' < "$SHARED_DIR/deployed-commit")
  fi
  log "target: $TARGET_COMMIT"
  log "last deployed: ${DEPLOYED_COMMIT:-<unknown>}"
  if [ "$FORCE" != "1" ] && [ -n "$DEPLOYED_COMMIT" ] && [ "$DEPLOYED_COMMIT" = "$TARGET_COMMIT" ]; then
    log "deployed commit matches target -- nothing to deploy (--force to rebuild)"
    exit 0
  fi
  SHORT_SHA=$(git -C "$SRC_DIR" rev-parse --short "$TARGET_COMMIT")
  RELEASE_ID="$(date -u +%Y%m%d-%H%M%S)-$SHORT_SHA"
  RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
  log "creating release $RELEASE_ID"
  git -C "$SRC_DIR" worktree add --detach "$RELEASE_DIR" "$TARGET_COMMIT" 2>&1 | tail -2 | tee -a "$LOG_FILE"
  ln -s "$SHARED_DIR/.env" "$RELEASE_DIR/.env"
  ln -s "$SHARED_DIR/chunk-pool" "$RELEASE_DIR/.chunk-pool"

  # Self-sync /root/deploy.sh ATOMICALLY (write-new + rename). A plain cp over
  # the running script corrupts the bash parse mid-run -- the rename swaps the
  # inode so the running copy keeps reading its original file.
  if [ -f /root/deploy.sh ] && ! cmp -s "$RELEASE_DIR/scripts/deploy.sh" /root/deploy.sh; then
    log "syncing /root/deploy.sh from scripts/deploy.sh (takes effect next run)"
    cp "$RELEASE_DIR/scripts/deploy.sh" /root/deploy.sh.new
    chmod +x /root/deploy.sh.new
    mv -f /root/deploy.sh.new /root/deploy.sh
  fi

  # === Step 2: npm ci in the release dir ===
  cd "$RELEASE_DIR"
  log "installing dependencies (npm ci)..."
  npm ci --no-audit --no-fund 2>&1 | tail -5 | tee -a "$LOG_FILE"
fi

# === Step 3: migrations (run BEFORE cutover; guarded) ===
log "applying SQL migrations..."
set -a
. "$SHARED_DIR/.env"
set +a

DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

psql_q() {
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q "$@"
}

psql_q -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS _outreach_migrations_applied (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text
);
" >/dev/null

# Collect NEW migrations first so the safety guard can scan them as a set
# before anything is applied.
NEW_MIGRATIONS=()
for f in db/migrations/*.sql; do
  filename=$(basename "$f")
  existing=$(psql_q -t -A -c "SELECT checksum FROM _outreach_migrations_applied WHERE filename='$filename';")
  if [ -n "$existing" ]; then
    checksum=$(md5sum "$f" | awk '{print $1}')
    if [ "$existing" != "$checksum" ]; then
      log "  WARN: $filename modified since last apply (checksum mismatch). Skipping anyway."
    fi
    continue
  fi
  NEW_MIGRATIONS+=("$f")
done

if [ "${#NEW_MIGRATIONS[@]}" -gt 0 ]; then
  log "migration safety scan (${#NEW_MIGRATIONS[@]} new file(s))..."
  GUARD_FAILED=0
  for f in "${NEW_MIGRATIONS[@]}"; do
    log "  scanning $(basename "$f")"
    migration_guard "$f" || GUARD_FAILED=1
  done
  if [ "$GUARD_FAILED" = "1" ] && [ "$ALLOW_UNSAFE_MIGRATION" != "1" ]; then
    log "x MIGRATION SAFETY GUARD FAILED. Migrations run BEFORE cutover, so the"
    log "  still-running old release must tolerate the new schema (and a rollback"
    log "  must keep working afterwards). Use the expand/contract pattern:"
    log "    deploy N:   ADD COLUMN nullable (or with DEFAULT); write to both"
    log "    deploy N+1: backfill + switch reads; later: DROP/RENAME the old"
    log "  If this migration was human-reviewed and is genuinely safe, re-run"
    log "  with --allow-unsafe-migration. See DEPLOY.md 'Migration policy'."
    exit 4
  fi
  if [ "$GUARD_FAILED" = "1" ]; then
    log "  WARN: unsafe patterns ALLOWED via --allow-unsafe-migration"
  fi
  for f in "${NEW_MIGRATIONS[@]}"; do
    filename=$(basename "$f")
    checksum=$(md5sum "$f" | awk '{print $1}')
    log "  applying $filename (new)"
    psql_q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | tail -3 | tee -a "$LOG_FILE"
    psql_q -c "INSERT INTO _outreach_migrations_applied (filename, checksum) VALUES ('$filename', '$checksum');" >/dev/null
  done
else
  log "  no new migrations"
fi

# === Step 3.6: Load reference docs (idempotent, non-fatal) ===
log "loading reference docs..."
if npx tsx scripts/load-reference-doc.ts --slug halloween-2026-intl >> "$LOG_FILE" 2>&1; then
  log "  reference docs in sync"
else
  log "  WARN: reference-docs load failed (non-fatal); see $LOG_FILE"
fi

if [ "$SKIP_BUILD" = "1" ]; then
  log "--skip-build complete (no rebuild, no cutover, no stamp)"
  exit 0
fi

# === Step 3.5: Hydration-safety gate ===
log "running hydration-safety gate..."
node scripts/check-hydration-safety.cjs 2>&1 | tee -a "$LOG_FILE" || {
  log "x HYDRATION-SAFETY GATE FAILED -- aborting before build; live release untouched."
  exit 5
}

# === Step 4: Build (in the release dir; live release untouched) ===
log "building Next.js standalone bundle in $RELEASE_DIR ..."
CHUNK_POOL="$SHARED_DIR/chunk-pool"
NODE_OPTIONS="--max-old-space-size=$NODE_MAX_OLD_SPACE" \
BUILD_VERSION=$(git -C "$RELEASE_DIR" rev-parse --short HEAD) \
BUILD_COMMIT=$(git -C "$RELEASE_DIR" rev-parse HEAD) \
BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
npm run build 2>&1 | tail -10 | tee -a "$LOG_FILE"

cp -r .next/static .next/standalone/.next/
# Chunk-pool retention (PRESERVED from the stale-chunk incident): merge every
# recent deploy's immutable hashed chunks into this release so a tab opened
# days/deploys ago still resolves its chunks instead of 404 -> ChunkLoadError.
cp -rn "$CHUNK_POOL/." .next/standalone/.next/static/ 2>/dev/null || true
cp -rn .next/standalone/.next/static/. "$CHUNK_POOL/" 2>/dev/null || true
find "$CHUNK_POOL" -type f -mtime +7 -delete 2>/dev/null || true
find "$CHUNK_POOL" -type d -empty -delete 2>/dev/null || true
[ -d public ] && cp -r public .next/standalone/ 2>/dev/null || true
if [ -d data ]; then
  mkdir -p .next/standalone/data
  cp -r data/. .next/standalone/data/ 2>/dev/null || true
fi

verify_build "$RELEASE_DIR"

# === Step 5: CUTOVER -- atomic flip + staggered health-gated reload ===
PREV_RELEASE="$CURRENT_RELEASE"
flip_to "$RELEASE_DIR"
if ! reload_all; then
  log "x reload failed after flip -- rolling the symlink back to $PREV_RELEASE"
  flip_to "$PREV_RELEASE"
  reload_all || log "x reload ALSO failed on the previous release -- manual intervention required"
  exit 6
fi

# === Step 6: Smoke test (Layer 2) -- auto-rollback on failure ===
log "running post-deploy smoke test..."
if bash "$RELEASE_DIR/scripts/smoke-test.sh" 2>&1 | tee -a "$LOG_FILE"; then
  log "  ok: smoke test passed"
else
  log "x SMOKE TEST FAILED -- auto-rolling back to $PREV_RELEASE"
  flip_to "$PREV_RELEASE"
  if reload_all; then
    log "  rollback complete; previous release serving again"
  else
    log "x reload failed during auto-rollback -- manual intervention required"
  fi
  exit 8
fi

# === Step 7: stamp + history + prune ===
echo "$TARGET_COMMIT" > "$SHARED_DIR/deployed-commit"
echo "$RELEASE_DIR" >> "$SHARED_DIR/release-history"

log "pruning old releases (keep $KEEP_RELEASES newest + active + previous)..."
PRUNE_KEPT=0
for d in $(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null); do
  d="${d%/}"
  PRUNE_KEPT=$((PRUNE_KEPT + 1))
  if [ "$PRUNE_KEPT" -le "$KEEP_RELEASES" ] || [ "$d" = "$RELEASE_DIR" ] || [ "$d" = "$PREV_RELEASE" ]; then
    continue
  fi
  log "  pruning $d"
  rm -rf "$d"
done
git -C "$SRC_DIR" worktree prune 2>/dev/null || true

log ""
log "=========================================="
log "DEPLOY SUCCESSFUL (atomic)"
log "  Previous release: $PREV_RELEASE"
log "  Now serving:      $RELEASE_DIR"
log "  Commit:           $TARGET_COMMIT"
log "  Health + smoke:   OK"
log "=========================================="
log ""
log "Instant rollback if anything looks wrong:"
log "  bash /root/deploy.sh --rollback"

#!/usr/bin/env bash
#
# verify-backup.sh — paranoid round-trip integrity test
#
# Downloads the most recent backup from B2, decrypts it, and
# pg_restores it into a temporary side database. Confirms:
#   • Network access to B2 + permissions work
#   • Encryption passphrase decrypts correctly
#   • Dump is structurally valid (pg_restore can read it)
#   • Schema + data round-trip without errors
#
# Does NOT touch the production database. Side database name:
#   crawl_engine_verify
# Dropped + recreated each run.
#
# Run weekly via cron, or after any backup-related change, to make
# sure your disaster-recovery story actually works.
#
# Required env (sourced from /root/outreach-secrets/credentials.env):
#   DATABASE_URL                 — needed to derive the verify URL
#   B2_KEY_ID
#   B2_APPLICATION_KEY
#   B2_BUCKET_NAME
#   B2_ENDPOINT_URL
#   BACKUP_ENCRYPTION_PASSPHRASE
#

set -euo pipefail

log() { printf '[verify-backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${B2_KEY_ID:?B2_KEY_ID must be set}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY must be set}"
: "${B2_BUCKET_NAME:?B2_BUCKET_NAME must be set}"
: "${B2_ENDPOINT_URL:?B2_ENDPOINT_URL must be set}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set}"

export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"

PREFIX="${BACKUP_PREFIX:-outreach}"

# ------------------------------------------------------------------------
# Find the most recent backup
# ------------------------------------------------------------------------
log "Looking for most recent backup in s3://${B2_BUCKET_NAME}/${PREFIX}/"
LATEST=$(aws s3 ls "s3://${B2_BUCKET_NAME}/${PREFIX}/" \
  --endpoint-url "$B2_ENDPOINT_URL" \
  | sort | tail -1 | awk '{print $NF}')

if [[ -z "$LATEST" ]]; then
  die "No backups found under ${PREFIX}/ in s3://${B2_BUCKET_NAME}/"
fi

LATEST_KEY="${PREFIX}/${LATEST}"
log "Most recent: $LATEST_KEY"

# ------------------------------------------------------------------------
# Build the verify-DB URL (swap database name in DATABASE_URL)
# ------------------------------------------------------------------------
VERIFY_DB="crawl_engine_verify"
VERIFY_URL="$(echo "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|$)#/${VERIFY_DB}\1#")"

# Derive a maintenance URL (postgres database) so we can DROP/CREATE
# the verify DB. Strip everything after / and substitute postgres.
MAINT_URL="$(echo "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|$)#/postgres\1#")"

# ------------------------------------------------------------------------
# Reset the verify DB (drop + recreate)
# ------------------------------------------------------------------------
log "Resetting $VERIFY_DB"
psql "$MAINT_URL" -c "DROP DATABASE IF EXISTS ${VERIFY_DB};" > /dev/null
psql "$MAINT_URL" -c "CREATE DATABASE ${VERIFY_DB};" > /dev/null

# ------------------------------------------------------------------------
# Download → decrypt → restore
# ------------------------------------------------------------------------
TMP_DIR="$(mktemp -d -t outreach-verify-XXXXXX)"
TMP_ENC="${TMP_DIR}/backup.dump.gz.enc"
TMP_DEC="${TMP_DIR}/backup.dump"
trap 'rm -rf "$TMP_DIR"' EXIT

log "Downloading..."
aws s3 cp \
  "s3://${B2_BUCKET_NAME}/${LATEST_KEY}" \
  "$TMP_ENC" \
  --endpoint-url "$B2_ENDPOINT_URL" \
  --no-progress

log "Decrypting + decompressing..."
openssl enc -d -aes-256-cbc -pbkdf2 -pass "env:BACKUP_ENCRYPTION_PASSPHRASE" \
  -in "$TMP_ENC" \
  | gunzip \
  > "$TMP_DEC"

DEC_SIZE=$(stat --printf="%s" "$TMP_DEC")
if [[ "$DEC_SIZE" -lt 1024 ]]; then
  die "Decrypted dump is suspiciously small (${DEC_SIZE} bytes) — bad passphrase?"
fi

log "Restoring into $VERIFY_DB..."
pg_restore \
  --no-owner \
  --no-privileges \
  --jobs=2 \
  --dbname="$VERIFY_URL" \
  "$TMP_DEC" 2>&1 | tail -20

# ------------------------------------------------------------------------
# Smoke-test the restored DB
# ------------------------------------------------------------------------
log "Smoke-testing restored DB..."
STAFF_COUNT=$(psql "$VERIFY_URL" -tAc "SELECT COUNT(*) FROM staff_members;" 2>/dev/null || echo "?")
VENUE_COUNT=$(psql "$VERIFY_URL" -tAc "SELECT COUNT(*) FROM venues;" 2>/dev/null || echo "?")
LOG_COUNT=$(psql "$VERIFY_URL" -tAc "SELECT COUNT(*) FROM outreach_log;" 2>/dev/null || echo "?")

log "  staff_members: $STAFF_COUNT"
log "  venues:        $VENUE_COUNT"
log "  outreach_log:  $LOG_COUNT"

if [[ "$STAFF_COUNT" == "?" || "$STAFF_COUNT" -lt 1 ]]; then
  die "Smoke test failed — staff_members table missing or empty"
fi

log ""
log "✓ Backup verified successfully."
log "  Source: ${LATEST_KEY}"
log "  Restored into ${VERIFY_DB} on the same Postgres instance."
log "  The verify DB is left in place for inspection. Drop it manually when done:"
log "    psql \"$MAINT_URL\" -c 'DROP DATABASE ${VERIFY_DB};'"

#!/usr/bin/env bash
#
# restore-db.sh — restore Postgres from a specific B2 backup
#
# DESTRUCTIVE. Wipes the target database and replaces it with the
# contents of the chosen backup. Refuses to run without an explicit
# CONFIRM=yes env var so it doesn't fire accidentally.
#
# Workflow:
#   1. List available backups in B2
#   2. Operator picks one (passed via BACKUP_KEY env)
#   3. Download → decrypt → restore via pg_restore
#
# Required env (sourced from /root/outreach-secrets/credentials.env):
#   DATABASE_URL                 — target Postgres
#   B2_KEY_ID
#   B2_APPLICATION_KEY
#   B2_BUCKET_NAME
#   B2_ENDPOINT_URL
#   BACKUP_ENCRYPTION_PASSPHRASE — must match the passphrase the
#                                  backup was encrypted with
#
# Required CLI args:
#   BACKUP_KEY=outreach/20260526T040001Z.dump.gz.enc
#   CONFIRM=yes
#
# Optional env:
#   RESTORE_TO_DB                — override the target DB inside the
#                                  DATABASE_URL connection (useful to
#                                  restore into a side database like
#                                  crawl_engine_restore_test first,
#                                  then promote with rename + symlink)
#
# Usage examples:
#
#   # List backups
#   bash /var/www/outreach/scripts/restore-db.sh
#
#   # Restore from a specific backup (operator confirms each safety prompt)
#   BACKUP_KEY=outreach/20260526T040001Z.dump.gz.enc \
#   CONFIRM=yes \
#   bash /var/www/outreach/scripts/restore-db.sh
#
#   # Safer: restore into a test database first
#   BACKUP_KEY=outreach/20260526T040001Z.dump.gz.enc \
#   CONFIRM=yes \
#   RESTORE_TO_DB=crawl_engine_restore_test \
#   bash /var/www/outreach/scripts/restore-db.sh
#

set -euo pipefail

log() { printf '[restore-db %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# ------------------------------------------------------------------------
# Validate env
# ------------------------------------------------------------------------
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${B2_KEY_ID:?B2_KEY_ID must be set}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY must be set}"
: "${B2_BUCKET_NAME:?B2_BUCKET_NAME must be set}"
: "${B2_ENDPOINT_URL:?B2_ENDPOINT_URL must be set}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set}"

export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"

# ------------------------------------------------------------------------
# List mode: no BACKUP_KEY → just show what's available + exit
# ------------------------------------------------------------------------
if [[ -z "${BACKUP_KEY:-}" ]]; then
  log "Available backups in s3://${B2_BUCKET_NAME}/:"
  aws s3 ls "s3://${B2_BUCKET_NAME}/" --recursive --endpoint-url "$B2_ENDPOINT_URL"
  log ""
  log "To restore from one of these, run:"
  log "  BACKUP_KEY=<key from above> CONFIRM=yes bash $(basename "$0")"
  exit 0
fi

# ------------------------------------------------------------------------
# Safety gate: requires explicit CONFIRM=yes
# ------------------------------------------------------------------------
if [[ "${CONFIRM:-}" != "yes" ]]; then
  die "Restoring will WIPE the target database. Re-run with CONFIRM=yes to proceed."
fi

# ------------------------------------------------------------------------
# Optional: redirect to an alternate database name (safer pattern —
# restore into a side DB, verify, then rename).
# ------------------------------------------------------------------------
TARGET_URL="$DATABASE_URL"
if [[ -n "${RESTORE_TO_DB:-}" ]]; then
  # Strip the existing DB name from the URL and substitute
  TARGET_URL="$(echo "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|$)#/${RESTORE_TO_DB}\1#")"
  log "Target DB override: $RESTORE_TO_DB"
fi

TMP_DIR="$(mktemp -d -t outreach-restore-XXXXXX)"
TMP_ENC="${TMP_DIR}/backup.dump.gz.enc"
TMP_DEC="${TMP_DIR}/backup.dump"
trap 'rm -rf "$TMP_DIR"' EXIT

# ------------------------------------------------------------------------
# Download
# ------------------------------------------------------------------------
log "Downloading s3://${B2_BUCKET_NAME}/${BACKUP_KEY}"
aws s3 cp \
  "s3://${B2_BUCKET_NAME}/${BACKUP_KEY}" \
  "$TMP_ENC" \
  --endpoint-url "$B2_ENDPOINT_URL" \
  --no-progress

SIZE_BYTES=$(stat --printf="%s" "$TMP_ENC")
SIZE_MB=$(awk "BEGIN{printf \"%.1f\", $SIZE_BYTES/1024/1024}")
log "Downloaded ${SIZE_MB}MB"

# ------------------------------------------------------------------------
# Decrypt + decompress (pg_restore reads the custom format directly,
# no need to land an intermediate uncompressed file)
# ------------------------------------------------------------------------
log "Decrypting + decompressing → $TMP_DEC"
openssl enc -d -aes-256-cbc -pbkdf2 -pass "env:BACKUP_ENCRYPTION_PASSPHRASE" \
  -in "$TMP_ENC" \
  | gunzip \
  > "$TMP_DEC"

DEC_SIZE=$(stat --printf="%s" "$TMP_DEC")
if [[ "$DEC_SIZE" -lt 1024 ]]; then
  die "Decrypted backup is suspiciously small (${DEC_SIZE} bytes) — wrong passphrase?"
fi
log "Decrypted size: $(awk "BEGIN{printf \"%.1f\", $DEC_SIZE/1024/1024}")MB"

# ------------------------------------------------------------------------
# Restore. --clean inside pg_dump means DROP TABLE statements are in
# the dump itself; pg_restore will use them. We pass --if-exists so
# the DROPs don't fail on missing objects (fresh DB) and -j2 for
# moderate parallelism.
# ------------------------------------------------------------------------
log "Restoring into target..."
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --jobs=2 \
  --dbname="$TARGET_URL" \
  "$TMP_DEC"

log "Restore complete."
log "Verify with: psql \"$TARGET_URL\" -c 'SELECT COUNT(*) FROM staff_members;'"

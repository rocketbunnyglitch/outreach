#!/usr/bin/env bash
#
# backup-db.sh — encrypted Postgres → Backblaze B2 daily backup
#
# What it does:
#   1. pg_dump the crawl_engine database (custom format = compact +
#      indexes/triggers/etc preserved cleanly)
#   2. Gzip + symmetric-encrypt with openssl AES-256-CBC
#   3. Upload to Backblaze B2 via the S3-compatible API (aws CLI)
#   4. Prune backups older than ${BACKUP_RETENTION_DAYS:-30} days
#   5. Log result to /var/log/outreach-backup.log + journalctl
#
# Encryption matters: B2 is a cold-storage vendor we trust for
# availability but not necessarily confidentiality. Venue contact
# data + outreach communications belong to operators, not to the
# storage provider. Encrypt before upload; the key never leaves the
# VPS.
#
# If the VPS itself is compromised, both the DB and the encryption
# key are gone — client-side encryption mainly protects against B2
# bucket leaks, which is the realistic threat model.
#
# Required env (typically sourced from /root/outreach-secrets/credentials.env):
#   DATABASE_URL                 — pg_dump target
#   B2_KEY_ID                    — Backblaze key (S3 access key id)
#   B2_APPLICATION_KEY           — Backblaze key (S3 secret)
#   B2_BUCKET_NAME               — target bucket
#   B2_ENDPOINT_URL              — e.g. https://s3.us-west-002.backblazeb2.com
#   BACKUP_ENCRYPTION_PASSPHRASE — secure passphrase for openssl
#
# Optional env:
#   BACKUP_RETENTION_DAYS        — default 30
#   BACKUP_PREFIX                — default 'outreach' (object name prefix)
#
# Usage:
#   bash /var/www/outreach/scripts/backup-db.sh
#
# Install:
#   apt install -y postgresql-client awscli openssl
#   chmod +x /var/www/outreach/scripts/backup-db.sh
#   # Cron entry (4 AM daily):
#   echo '0 4 * * * source /root/outreach-secrets/credentials.env && \
#         /var/www/outreach/scripts/backup-db.sh >> /var/log/outreach-backup.log 2>&1' \
#         | crontab -
#

set -euo pipefail

LOG_PREFIX="[backup-db $(date -u +%FT%TZ)]"
log() { printf '%s %s\n' "$LOG_PREFIX" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# ------------------------------------------------------------------------
# Validate env up front. Fail loudly instead of half-completing.
# ------------------------------------------------------------------------
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${B2_KEY_ID:?B2_KEY_ID must be set}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY must be set}"
: "${B2_BUCKET_NAME:?B2_BUCKET_NAME must be set}"
: "${B2_ENDPOINT_URL:?B2_ENDPOINT_URL must be set (e.g. https://s3.us-west-002.backblazeb2.com)}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
PREFIX="${BACKUP_PREFIX:-outreach}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OBJECT_NAME="${PREFIX}/${STAMP}.dump.gz.enc"
TMP_DIR="$(mktemp -d -t outreach-backup-XXXXXX)"
TMP_FILE="${TMP_DIR}/${STAMP}.dump.gz.enc"

# Always clean up the temp file, even on failure — pg_dump output
# contains the whole database in cleartext.
trap 'rm -rf "$TMP_DIR"' EXIT

# AWS CLI talks to B2 over the S3-compatible API.
export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"

# ------------------------------------------------------------------------
# 1. Dump + gzip + encrypt in a single pipeline so the cleartext dump
#    never lands on disk. pg_dump --format=custom + gzip is double
#    compression (custom is already compressed) but the extra ~5% is
#    worth the simpler restore flow.
# ------------------------------------------------------------------------
log "Dumping → gzip → encrypt → $TMP_FILE"
pg_dump \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --quote-all-identifiers \
  --format=custom \
  "$DATABASE_URL" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "env:BACKUP_ENCRYPTION_PASSPHRASE" \
  > "$TMP_FILE"

SIZE_BYTES=$(stat --printf="%s" "$TMP_FILE")
SIZE_MB=$(awk "BEGIN{printf \"%.1f\", $SIZE_BYTES/1024/1024}")
log "Backup file created: ${SIZE_MB}MB"

if [[ "$SIZE_BYTES" -lt 1024 ]]; then
  die "Backup file is suspiciously small (${SIZE_BYTES} bytes) — pg_dump may have failed"
fi

# ------------------------------------------------------------------------
# 2. Upload to B2 via S3-compatible API. --no-progress keeps logs clean.
# ------------------------------------------------------------------------
log "Uploading → s3://${B2_BUCKET_NAME}/${OBJECT_NAME}"
aws s3 cp \
  "$TMP_FILE" \
  "s3://${B2_BUCKET_NAME}/${OBJECT_NAME}" \
  --endpoint-url "$B2_ENDPOINT_URL" \
  --no-progress

log "Upload OK"

# Stamp a liveness heartbeat so the anti-silence monitor can VERIFY the offsite
# backup actually completed — this bash job has no other DB trace, which is
# exactly how it silently failed to upload for weeks before. Non-fatal.
if [ -n "${DATABASE_URL:-}" ]; then
  SIZE_BYTES=$(stat -c %s "$TMP_FILE" 2>/dev/null || echo 0)
  psql "$DATABASE_URL" -c \
    "INSERT INTO system_heartbeats (component, last_seen_at, last_value, note) VALUES ('backup-offsite', now(), ${SIZE_BYTES}, 'offsite upload ok') ON CONFLICT (component) DO UPDATE SET last_seen_at = now(), last_value = EXCLUDED.last_value, note = EXCLUDED.note, updated_at = now();" \
    >/dev/null 2>&1 || log "backup heartbeat stamp skipped"
fi

# ------------------------------------------------------------------------
# 3. Prune backups older than retention window. Uses aws ls + filter +
#    rm rather than lifecycle rules because some operators want full
#    visibility into what's being deleted.
# ------------------------------------------------------------------------
CUTOFF_EPOCH=$(date -u -d "$RETENTION_DAYS days ago" +%s)
log "Pruning ${PREFIX}/* older than $RETENTION_DAYS days (cutoff $(date -u -d "@$CUTOFF_EPOCH" +%FT%TZ))"

PRUNED=0
while IFS= read -r line; do
  # aws s3 ls output format: '2026-05-26 04:00:01    1234567 outreach/20260526T040000Z.dump.gz.enc'
  date_part="$(echo "$line" | awk '{print $1" "$2}')"
  key_part="$(echo "$line" | awk '{$1=$2=$3=""; print substr($0,4)}')"

  # Empty lines or odd output → skip
  [[ -z "$date_part" || -z "$key_part" ]] && continue

  # Parse the date — skip if not a valid timestamp
  obj_epoch=$(date -u -d "$date_part" +%s 2>/dev/null || echo 0)
  [[ "$obj_epoch" -eq 0 ]] && continue

  if (( obj_epoch < CUTOFF_EPOCH )); then
    log "  prune: $key_part (uploaded $date_part)"
    aws s3 rm "s3://${B2_BUCKET_NAME}/${key_part}" \
      --endpoint-url "$B2_ENDPOINT_URL" \
      --no-progress > /dev/null
    PRUNED=$((PRUNED + 1))
  fi
done < <(aws s3 ls "s3://${B2_BUCKET_NAME}/${PREFIX}/" --endpoint-url "$B2_ENDPOINT_URL" || true)

log "Pruned $PRUNED old backups"

# ------------------------------------------------------------------------
# 4. Write status file so /api/health can report freshness. Stored in
#    /var/lib/outreach/ (created if missing); world-readable so the
#    Next.js process can read it without elevated permissions.
# ------------------------------------------------------------------------
STATUS_DIR="/var/lib/outreach"
STATUS_FILE="${STATUS_DIR}/last-backup.json"
mkdir -p "$STATUS_DIR"
cat > "$STATUS_FILE" <<EOF
{
  "last_run_at": "$(date -u +%FT%TZ)",
  "object_key": "${OBJECT_NAME}",
  "size_mb": ${SIZE_MB},
  "retention_days": ${RETENTION_DAYS},
  "pruned_count": ${PRUNED}
}
EOF
chmod 644 "$STATUS_FILE"

log "Done."

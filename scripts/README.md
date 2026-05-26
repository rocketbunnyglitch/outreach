# Outreach Engine — Backup & Restore

Encrypted off-site backups to Backblaze B2. Daily cron, 30-day retention,
client-side AES-256 encryption.

## Files in this directory

| Script | Purpose |
|---|---|
| `backup-db.sh` | Daily backup (called by cron). pg_dump → gzip → openssl encrypt → upload to B2 → prune old. |
| `restore-db.sh` | Manual restore. Download → decrypt → pg_restore. Requires `CONFIRM=yes`. |
| `verify-backup.sh` | Smoke test the latest backup — downloads + decrypts to validate the passphrase + integrity without touching prod. |

## One-time setup

### 1. Create the Backblaze bucket + key

In the Backblaze B2 console:

1. Create a private bucket — `outreach-backups-prod` (any name works).
2. Settings → enable Object Lock if you want write-once semantics (recommended).
3. Application Keys → create a key scoped to **only that bucket** with `listBuckets`, `listFiles`, `readFiles`, `writeFiles`, `deleteFiles` permissions.
4. Note the **Key ID**, **Application Key**, and the **S3 Endpoint** (looks like `https://s3.us-west-002.backblazeb2.com`).

### 2. Install dependencies on the VPS

```bash
apt update
apt install -y postgresql-client awscli openssl
```

### 3. Add env vars to credentials file

Append to `/root/outreach-secrets/credentials.env`:

```bash
# Backblaze B2 (S3-compatible)
B2_KEY_ID=...
B2_APPLICATION_KEY=...
B2_BUCKET_NAME=outreach-backups-prod
B2_ENDPOINT_URL=https://s3.us-west-002.backblazeb2.com

# Backup encryption — generate a strong passphrase once and store it
# in a separate password manager. If you lose this, backups are
# unrecoverable.
BACKUP_ENCRYPTION_PASSPHRASE=$(openssl rand -base64 32)

# Optional overrides
# BACKUP_RETENTION_DAYS=30
# BACKUP_PREFIX=outreach
```

**Important:** print `BACKUP_ENCRYPTION_PASSPHRASE` after generating
and store it in a password manager OFF the VPS. If the VPS is lost
and you only have the B2 backup, you'll need this passphrase to
restore.

### 4. Run the first backup manually to verify

```bash
source /root/outreach-secrets/credentials.env
bash /var/www/outreach/scripts/backup-db.sh
```

You should see output like:

```
[backup-db 2026-05-26T18:30:00Z] Dumping → gzip → encrypt → /tmp/...
[backup-db 2026-05-26T18:30:05Z] Backup file created: 12.4MB
[backup-db 2026-05-26T18:30:05Z] Uploading → s3://outreach-backups-prod/outreach/20260526T183005Z.dump.gz.enc
[backup-db 2026-05-26T18:30:11Z] Upload OK
[backup-db 2026-05-26T18:30:12Z] Pruned 0 old backups
[backup-db 2026-05-26T18:30:12Z] Done.
```

### 5. Verify the round-trip

Critical — never trust a backup until you've restored from it.

```bash
bash /var/www/outreach/scripts/verify-backup.sh
```

This downloads the most recent backup, decrypts it, and pg_restores
it into a temporary side database `crawl_engine_verify` to confirm
the dump is structurally valid. It does NOT touch your prod DB.

### 6. Install the cron job

```bash
crontab -e
```

Add this line — runs daily at 4 AM UTC:

```cron
0 4 * * * source /root/outreach-secrets/credentials.env && /var/www/outreach/scripts/backup-db.sh >> /var/log/outreach-backup.log 2>&1
```

Then `tail -f /var/log/outreach-backup.log` the next morning to confirm.

## Day-to-day operations

### Check backup health

```bash
ls -la /var/log/outreach-backup.log         # last cron run output
aws s3 ls s3://${B2_BUCKET_NAME}/ \
  --endpoint-url ${B2_ENDPOINT_URL} \
  --recursive                               # full B2 inventory
```

### Restore from a specific backup

```bash
source /root/outreach-secrets/credentials.env

# List available backups
bash /var/www/outreach/scripts/restore-db.sh

# Pick one and restore — SAFER PATTERN: restore into a side DB first
BACKUP_KEY=outreach/20260526T040001Z.dump.gz.enc \
CONFIRM=yes \
RESTORE_TO_DB=crawl_engine_restore_test \
bash /var/www/outreach/scripts/restore-db.sh

# Verify the restored DB has what you expect
psql "${DATABASE_URL/crawl_engine/crawl_engine_restore_test}" \
  -c "SELECT COUNT(*) FROM staff_members;"

# When satisfied, swap by renaming
psql "$DATABASE_URL" -c "ALTER DATABASE crawl_engine RENAME TO crawl_engine_old;"
psql "$DATABASE_URL" -c "ALTER DATABASE crawl_engine_restore_test RENAME TO crawl_engine;"
pm2 restart outreach
```

### Disaster recovery (fresh VPS, no local data)

1. Provision a new VPS, install Postgres + Node + PM2.
2. Clone the repo, `npm ci && npm run build`.
3. Restore `/root/outreach-secrets/credentials.env` from your password manager.
4. Create an empty `crawl_engine` database.
5. `BACKUP_KEY=<latest> CONFIRM=yes bash scripts/restore-db.sh`
6. `pm2 start ecosystem.config.cjs`

Time-to-recovery from total loss: ~30 minutes assuming you have the
credentials file in a password manager.

## What if the encryption passphrase is lost?

The backups are **unrecoverable**. AES-256-CBC with PBKDF2 has no
backdoor. Always store `BACKUP_ENCRYPTION_PASSPHRASE` in a password
manager BEFORE running the first backup, and verify with the
`verify-backup.sh` script that you can decrypt your own output.

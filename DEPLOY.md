# DEPLOY.md — outreach engine deployment runbook

This is the operator-facing reference for everything related to running outreach in production. If you can't remember how to do something, this should tell you in 30 seconds.

The audience here is "future me at 3am" — you, six months from now, half-asleep, trying to figure out why something broke. So everything is explicit even when it's "obvious."

---

## Where everything lives

```
/var/www/outreach                   ← SYMLINK to the active release (see
                                      "Atomic release deploys" below)
/var/www/outreach-releases/         ← one directory per built release
  └── <utc-ts>-<shortsha>/          ← full checkout + node_modules + .next
/var/www/outreach-shared/           ← state that outlives releases
  ├── .env                          ← secrets, chmod 600, root only
  ├── chunk-pool/                   ← old hashed JS chunks (stale-tab safety)
  ├── deployed-commit               ← last successfully deployed sha
  └── release-history               ← activation log (rollback target list)
/var/www/outreach-src/              ← fetch-only git clone (worktree source)
/var/www/outreach/.next/standalone/ ← the built app PM2 serves (via symlink)
/var/www/outreach/db/migrations/    ← SQL migrations, applied in order
/var/www/outreach/scripts/deploy.sh ← the deploy script (also at /root/deploy.sh)

/root/outreach-secrets/
  └── credentials.env               ← generated DB password + secrets backup

/var/log/
  ├── outreach-out.log              ← stdout from PM2
  ├── outreach-error.log            ← stderr from PM2
  └── outreach-deploy.log           ← every run of deploy.sh appends here

/etc/nginx/sites-available/outreach.barcrawlconnect.com
                                    ← reverse proxy config
/etc/letsencrypt/live/outreach.barcrawlconnect.com/
                                    ← TLS certs (auto-renewed)
```

---

## Atomic release deploys (2026-06-10)

The old script built IN-PLACE inside the live tree, so every deploy showed
users "Application error" / ChunkLoadError for the whole 4-7 minute build.
Now each release builds in its own directory and goes live in one atomic
symlink flip:

1. `git worktree add` the target commit into `/var/www/outreach-releases/<id>`
2. `npm ci`, migration safety scan + apply (BEFORE cutover -- see Migration
   policy), reference docs, hydration gate, `next build` -- all in the new
   dir while the live release keeps serving untouched
3. chunk-pool merge + build-integrity gate
4. atomic flip of the `/var/www/outreach` symlink, then a staggered,
   health-gated `pm2 reload` -- `outreach` runs in pm2 CLUSTER mode so the
   reload itself is gapless on :3001
5. smoke test (`scripts/smoke-test.sh`): /api/health on :3001 AND :3003,
   plus the key routes through nginx -- unauthenticated AND authenticated
   (a real session JWT minted with the server's NEXTAUTH_SECRET via
   `scripts/mint-smoke-session.mjs`, so server renders actually execute).
   ANY failure auto-rolls the symlink back to the previous release.
6. stamp + prune (keeps the last 4 releases + active + previous)

**Rollback is instant** -- `bash /root/deploy.sh --rollback` flips the
symlink to the previous release and reloads (seconds, no rebuild).

pm2, nginx, and the /root cron scripts all kept their `/var/www/outreach/...`
paths -- they resolve through the symlink, nothing else changed.

### Migration policy (expand/contract)

Migrations run BEFORE cutover and a rollback can put the previous release
back in front of the new schema at any moment. So migrations must be
backwards-compatible with the running release: ADD COLUMN only nullable or
with a DEFAULT; no DROP/RENAME/type-narrowing in the same deploy as the code
that stops using the old shape -- do that in a LATER deploy ("expand" now,
"contract" later). `deploy.sh` scans new migrations and ABORTS on these
patterns; `--allow-unsafe-migration` bypasses after human review.

### One-time layout setup (already done 2026-06-10; for rebuild-from-scratch)

```bash
git clone git@github.com:rocketbunnyglitch/outreach.git /var/www/outreach-src
mkdir -p /var/www/outreach-releases /var/www/outreach-shared/chunk-pool
# move shared state out of the live tree
mv /var/www/outreach/.env /var/www/outreach-shared/.env
cp -a /var/www/outreach/.chunk-pool/. /var/www/outreach-shared/chunk-pool/ 2>/dev/null
cat /var/www/outreach/.next/.deployed-commit > /var/www/outreach-shared/deployed-commit
# seed the current tree as the first release + flip to symlink (sub-second)
mv /var/www/outreach /var/www/outreach-releases/initial
ln -s /var/www/outreach-releases/initial /var/www/outreach
ln -s /var/www/outreach-shared/.env /var/www/outreach-releases/initial/.env
echo /var/www/outreach-releases/initial > /var/www/outreach-shared/release-history
# convert pm2 "outreach" to cluster mode (2-3s blip; do in a quiet window)
pm2 delete outreach && pm2 start /var/www/outreach/ecosystem.config.cjs --only outreach && pm2 save
```

---

## The deploy loop

Future code changes ship like this:

```
   Claude pushes to GitHub        you run on server
            │                            │
            ▼                            ▼
   ┌───────────────┐           ┌───────────────────┐
   │  GitHub repo  │ ───────▶  │ bash /root/deploy │
   │ origin/main   │  git pull │      .sh          │
   └───────────────┘           └─────────┬─────────┘
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                       npm ci          npx migrations
                              ▼                     ▼
                       npm run build         pm2 reload
                              ▼                     ▼
                       health check          ✓ done
```

**To deploy a new version**, when Claude tells you a new commit is on GitHub:

```bash
ssh root@203.161.61.240
bash /root/deploy.sh
```

That's it. Takes 4-7 min. Logs to `/var/log/outreach-deploy.log`.

The deploy is **zero-downtime** — `pm2 reload` starts a new process, waits for it to be ready, then swaps. Active sessions don't drop.

---

## Common scenarios

### Update is on GitHub, deploy normally

```bash
bash /root/deploy.sh
```

### Latest deploy broke something, roll back

```bash
bash /root/deploy.sh --rollback
```

This is an INSTANT atomic symlink flip to the previous release plus a reload — seconds, no rebuild. Test the previous version, then call Claude to fix the broken commit.

### Tiny change that doesn't need a rebuild (config, docs, env var)

```bash
bash /root/deploy.sh --skip-build
```

Skips the slow `npm run build` step. Only valid for changes that don't touch app code (env vars, README, etc.).

### Force a fresh rebuild (e.g. corrupted .next directory)

```bash
cd /var/www/outreach
rm -rf .next
bash /root/deploy.sh
```

### App is down and you want to see why

```bash
# Last 50 lines of recent logs
pm2 logs outreach --lines 50 --nostream

# Live tail
pm2 logs outreach

# Or look at the raw log files
tail -100 /var/log/outreach-error.log
tail -100 /var/log/outreach-out.log

# Or the deploy log if a deploy just happened
tail -100 /var/log/outreach-deploy.log

# Is the process even running?
pm2 list

# Hit the health endpoint
curl -s http://127.0.0.1:3001/api/health
```

### Restart everything (nuclear option)

```bash
pm2 restart outreach
systemctl restart postgresql
systemctl restart redis-server
systemctl reload nginx
sleep 5
curl -s http://127.0.0.1:3001/api/health
```

### Check database directly

```bash
# Use the password from /root/outreach-secrets/credentials.env
PGPASSWORD=$(grep DB_PASSWORD /root/outreach-secrets/credentials.env | cut -d= -f2) \
  psql -h 127.0.0.1 -U crawl_engine_app -d crawl_engine

# Inside psql:
# \dt              -- list tables
# \d venues        -- describe a table
# \q               -- quit
```

### Promote impersonation to real OAuth (Phase 6-ish)

Currently `.env` has `ENABLE_DEV_IMPERSONATION=1` which lets you sign in by typing any staff email. When Google OAuth is configured:

```bash
# Edit /var/www/outreach/.env
# Set ENABLE_DEV_IMPERSONATION=0
# Set GOOGLE_OAUTH_CLIENT_ID=...
# Set GOOGLE_OAUTH_CLIENT_SECRET=...
# Then:
pm2 restart outreach --update-env
```

---

## Disaster recovery

### Scenario: server is fine but app keeps crashing

1. `pm2 logs outreach --lines 200 --nostream` → find the error
2. If recent deploy is the cause: `bash /root/deploy.sh --rollback`
3. If it's an env or DB issue: check `/var/www/outreach/.env` and `systemctl status postgresql`
4. If it's RAM exhaustion: `free -h` to confirm, then PM2's `max_memory_restart` should catch it (set to 600M)

### Scenario: server died, need to rebuild from scratch

1. Spin up new Ubuntu 24.04 box at your VPS provider
2. Restore root SSH access (paste your authorized_keys or use provider's KVM)
3. Follow `docs/server-setup.md` step by step
4. Get GitHub deploy key onto new server (`ssh-keygen` + add to GitHub deploy keys)
5. `git clone git@github.com:toptorontoclubs/outreach.git /var/www/outreach`
6. Restore `.env` from `/root/outreach-secrets/credentials.env` (or regenerate if lost)
7. Restore DB from latest B2 backup (once we set those up) OR re-seed empty
8. Run `bash /root/deploy.sh` to build + start
9. Point DNS at new IP, run `certbot --nginx -d outreach.barcrawlconnect.com`

### Scenario: lost the `.env` file

Regenerate it from `/root/outreach-secrets/credentials.env`:

```bash
# View the original-generated secrets
cat /root/outreach-secrets/credentials.env

# Manually rebuild .env from the template
cp /var/www/outreach/.env.example /var/www/outreach/.env
# Edit .env to fill in DB_PASSWORD, NEXTAUTH_SECRET, APP_ENCRYPTION_KEY
# from credentials.env
nano /var/www/outreach/.env
chmod 600 /var/www/outreach/.env
pm2 restart outreach --update-env
```

### Scenario: lost everything including credentials.env

The DB password isn't recoverable, but you can reset it:

```bash
su - postgres -c "psql -c \"ALTER USER crawl_engine_app WITH PASSWORD 'NEW_PASSWORD_HERE';\""
# Then update DATABASE_URL in /var/www/outreach/.env
# pm2 restart outreach --update-env
```

NextAuth secret and encryption key can be regenerated (`openssl rand -hex 32`), but rotating the encryption key invalidates any encrypted data (currently nothing, will matter once Phase 6 stores OAuth tokens).

---

## Architecture

```
Internet
  │
  ▼
┌─────────────────────────────────────────────┐
│  nginx (ports 80, 443)                      │
│  TLS terminated here via Let's Encrypt      │
│  Reverse proxies → 127.0.0.1:3001           │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  PM2 process "outreach"                     │
│  Running Next.js standalone bundle          │
│  Auto-restarts at 600MB RAM                 │
│  Auto-resurrects on server reboot           │
└─────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────┐      ┌─────────────┐
│ Postgres 16 │      │  Redis 7    │
│ + PostGIS   │      │  (BullMQ    │
│ port 5432   │      │   queues)   │
│ localhost   │      │ port 6379   │
└─────────────┘      └─────────────┘
```

**Why this stack:**
- nginx instead of Caddy because promoter-engine is already using nginx (don't disrupt it)
- PM2 instead of systemd directly because PM2 has zero-downtime reload + auto-restart on OOM
- Bare-metal Postgres instead of Docker because we only have 2GB RAM
- Redis is used for BullMQ (Phase 6 outreach cadences, not yet active)

---

## Ports and processes

| Port | Process | Bound to | Purpose |
|---|---|---|---|
| 80 | nginx | 0.0.0.0 | HTTP (redirects to 443) |
| 443 | nginx | 0.0.0.0 | HTTPS — TLS terminated here |
| 3000 | promoter-engine | 0.0.0.0 | Promoter engine, separate codebase |
| 3001 | outreach (Next.js) | 127.0.0.1 | This app. Only reachable via nginx. |
| 5432 | Postgres | 127.0.0.1 | DB. Only reachable from localhost. |
| 6379 | Redis | 127.0.0.1 | Queue. Only reachable from localhost. |

`outreach`, Postgres, and Redis all bind to localhost only — they can only be hit from inside the server. The only public surface is nginx.

---

## Backups (TODO)

Right now there are no automated backups. **Set this up before going live with real data.**

The plan is nightly `pg_dump → /tmp → upload to Backblaze B2`. Will be configured in `/etc/cron.d/outreach-backup` once you have B2 credentials.

Until then, manual backup is:

```bash
PGPASSWORD=$(grep DB_PASSWORD /root/outreach-secrets/credentials.env | cut -d= -f2) \
  pg_dump -h 127.0.0.1 -U crawl_engine_app -d crawl_engine -F c -f /root/backups/outreach-$(date +%Y%m%d-%H%M%S).dump
```

Restore from backup:

```bash
PGPASSWORD=... pg_restore -h 127.0.0.1 -U crawl_engine_app -d crawl_engine -c /root/backups/outreach-XXXX.dump
```

---

## Monitoring

PM2 has built-in process monitoring. Run `pm2 monit` for an interactive top-style view.

For external uptime checks (Phase 8 deliverable), point UptimeRobot or similar at `https://outreach.barcrawlconnect.com/api/health`. The endpoint returns 200 + JSON with `status: "ok"` when everything's healthy, returns 503 otherwise.

---

## What's running where on this box

This server (`203.161.61.240`) runs two engines:

1. **promoter-engine** at `/var/www/promoter-engine`, port 3000, separate database. Different codebase entirely. Don't touch unless you know what you're doing — this is what handles your Eventbrite referral tracking. Mature, has its own boot guards and `.env`.

2. **outreach (this engine)** at `/var/www/outreach`, port 3001. New deployment.

Both are managed by the same PM2 instance. `pm2 list` shows both. They share nothing — separate databases (`promoter` and `crawl_engine`), separate code, separate logs. They just happen to share the same nginx and the same machine.

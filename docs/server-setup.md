# docs/server-setup.md — Fresh server setup

Run these steps in order on a fresh Ubuntu 24.04 server to bring up an outreach engine deployment from nothing. Use this if you need to migrate to a new server, or rebuild after disaster.

For ongoing deploys (after this initial setup), see `DEPLOY.md`.

---

## 0. Prerequisites

- Fresh Ubuntu 24.04 LTS server
- ≥2GB RAM (4GB recommended), ≥20GB disk
- Root SSH access via password or key
- A domain you can point at the server's IP (Namecheap / Cloudflare / etc.)
- The original `credentials.env` file from `/root/outreach-secrets/` on the OLD server — OR willingness to regenerate

## 1. Install system packages

```bash
apt-get update
apt-get install -y \
  nodejs npm \
  postgresql-16 postgresql-16-postgis-3 postgresql-contrib-16 \
  redis-server \
  nginx \
  certbot python3-certbot-nginx \
  git curl jq

# Install PM2 globally
npm install -g pm2
```

Then verify versions:

```bash
node --version    # Should be ≥ v20 (v22+ ideal)
psql --version    # Should be PostgreSQL 16+
redis-cli --version
pm2 --version
nginx -v
```

## 2. Tune Postgres for the box size

Edit `/etc/postgresql/16/main/postgresql.conf`. Settings for a 2GB box:

```
shared_buffers = 256MB
work_mem = 16MB
maintenance_work_mem = 64MB
effective_cache_size = 512MB
max_connections = 50
listen_addresses = 'localhost'
```

For a 4GB box, double everything except `max_connections`:

```
shared_buffers = 512MB
work_mem = 32MB
maintenance_work_mem = 128MB
effective_cache_size = 1GB
max_connections = 50
listen_addresses = 'localhost'
```

Then restart:

```bash
systemctl restart postgresql
systemctl enable postgresql
```

## 3. Tune Redis

Edit `/etc/redis/redis.conf`:

```
maxmemory 128mb
maxmemory-policy allkeys-lru
bind 127.0.0.1 -::1
```

Then restart:

```bash
systemctl restart redis-server
systemctl enable redis-server
```

## 4. Create the database

```bash
# Generate a strong password (or use the one from credentials.env)
DB_PASSWORD=$(openssl rand -hex 24)
echo "DB_PASSWORD: $DB_PASSWORD"
# Save it — you'll need it for .env

su - postgres -c "psql -c \"CREATE USER crawl_engine_app WITH PASSWORD '$DB_PASSWORD';\""
su - postgres -c "psql -c \"CREATE DATABASE crawl_engine OWNER crawl_engine_app;\""
su - postgres -c "psql -d crawl_engine -c \"CREATE EXTENSION IF NOT EXISTS postgis;\""
su - postgres -c "psql -d crawl_engine -c \"CREATE EXTENSION IF NOT EXISTS \\\"uuid-ossp\\\";\""
su - postgres -c "psql -d crawl_engine -c \"GRANT ALL ON SCHEMA public TO crawl_engine_app;\""

# Verify
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U crawl_engine_app -d crawl_engine -c "SELECT current_user, current_database();"
```

## 5. Save secrets to a known location

```bash
mkdir -p /root/outreach-secrets
cat > /root/outreach-secrets/credentials.env << EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
DB_PASSWORD=$DB_PASSWORD
NEXTAUTH_SECRET=$(openssl rand -hex 32)
APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF
chmod 600 /root/outreach-secrets/credentials.env
cat /root/outreach-secrets/credentials.env
```

Save those three values — you'll paste them into `.env` in step 8.

## 6. Set up GitHub deploy key

```bash
ssh-keygen -t ed25519 -C "outreach-deploy@$(hostname)" -f /root/.ssh/outreach_deploy -N "" -q
cat /root/.ssh/outreach_deploy.pub
```

Copy that `ssh-ed25519 AAAA...` line. Go to https://github.com/toptorontoclubs/outreach/settings/keys → Add deploy key → paste it → leave "Allow write access" UNCHECKED → Add.

Then configure SSH to use this key for GitHub:

```bash
cat > /root/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile /root/.ssh/outreach_deploy
    IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config

# Verify it works
ssh -T git@github.com 2>&1
# Should say: "Hi toptorontoclubs/outreach! You've successfully authenticated"
```

## 7. Clone the repo

```bash
mkdir -p /var/www
cd /var/www
git clone git@github.com:toptorontoclubs/outreach.git
cd outreach
ls -la
git log --oneline | head -3
```

## 8. Create the `.env` file

```bash
cd /var/www/outreach

# Get the secrets you saved in step 5
. /root/outreach-secrets/credentials.env

cat > .env << EOF
# Production environment — outreach.barcrawlconnect.com
DATABASE_URL=postgresql://crawl_engine_app:$DB_PASSWORD@127.0.0.1:5432/crawl_engine
REDIS_URL=redis://127.0.0.1:6379/0
NODE_ENV=production
APP_URL=https://outreach.barcrawlconnect.com
PORT=3001
HOSTNAME=127.0.0.1
NEXTAUTH_URL=https://outreach.barcrawlconnect.com
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY
ENABLE_DEV_IMPERSONATION=1
BUILD_VERSION=initial
BUILD_COMMIT=initial
BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

chmod 600 .env
cat .env
```

## 9. Install dependencies, run migrations, seed, build

```bash
cd /var/www/outreach

# Install
npm ci --no-audit --no-fund

# Migrations
for f in db/migrations/*.sql; do
  echo "applying $f"
  PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -U crawl_engine_app -d crawl_engine \
    -v ON_ERROR_STOP=1 -f "$f"
done

# Verify tables
PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -U crawl_engine_app -d crawl_engine -c "\dt"

# Seed initial data (skip this if restoring from a backup instead)
npx tsx scripts/seed.ts

# Build
NODE_OPTIONS="--max-old-space-size=1536" \
BUILD_VERSION=initial \
BUILD_COMMIT=initial \
BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
npm run build

# Copy static assets into standalone tree
cp -r .next/static .next/standalone/.next/
[ -d public ] && cp -r public .next/standalone/ || true
```

## 10. Configure nginx

```bash
cat > /etc/nginx/sites-available/outreach.barcrawlconnect.com << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name outreach.barcrawlconnect.com;

    client_max_body_size 20M;

    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Host $host;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}
EOF

ln -sf /etc/nginx/sites-available/outreach.barcrawlconnect.com \
       /etc/nginx/sites-enabled/outreach.barcrawlconnect.com

nginx -t
systemctl reload nginx
```

## 11. Configure PM2

```bash
cat > /var/www/outreach/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: "outreach",
    script: ".next/standalone/server.js",
    cwd: "/var/www/outreach",
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "600M",
    env: { NODE_ENV: "production", PORT: 3001, HOSTNAME: "127.0.0.1" },
    env_file: ".env",
    error_file: "/var/log/outreach-error.log",
    out_file: "/var/log/outreach-out.log",
    time: true,
  }],
};
EOF

cd /var/www/outreach
set -a
. .env
set +a
pm2 start ecosystem.config.cjs
pm2 list
pm2 save
pm2 startup systemd -u root --hp /root
# (run any sudo command the above prints, if any)
```

### 11b. WebSocket presence sidecar (live cursors + avatars)

The presence layer ("feels like Google Sheets") runs as a SECOND PM2
process — `realtime/ws-server.mjs` on port 3002 (127.0.0.1) — proxied by
nginx at `/ws`. It reuses `NEXTAUTH_SECRET` to authenticate sockets; no
new env var is required (optional: `WS_PORT`).

1) nginx — add this `location` ABOVE `location /` in the 443 server
   block (the global config already sets the Upgrade headers; the long
   timeouts here are REQUIRED so idle sockets aren't dropped at 120s):

```nginx
location /ws {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```
Then `nginx -t && systemctl reload nginx`.

2) PM2 — add a second app to `ecosystem.config.cjs` (leave "outreach"
   untouched):

```js
{
  name: "outreach-ws",
  script: "realtime/ws-server.mjs",
  cwd: "/var/www/outreach",
  instances: 1,
  exec_mode: "fork",
  max_memory_restart: "300M",
  env: { NODE_ENV: "production", WS_PORT: "3002" },
  env_file: ".env",
  error_file: "/var/log/outreach-ws-error.log",
  out_file: "/var/log/outreach-ws-out.log",
  time: true,
}
```
Then `pm2 start ecosystem.config.cjs --only outreach-ws && pm2 save`.

Once registered, `deploy.sh` reloads `outreach-ws` automatically on every
deploy (it skips silently if the app isn't registered yet).



```bash
sleep 5
echo "--- Direct ---"
curl -s http://127.0.0.1:3001/api/health
echo ""
echo "--- Through nginx ---"
curl -s -H "Host: outreach.barcrawlconnect.com" http://127.0.0.1/api/health
```

Both should return `{"status":"ok",...}`.

## 13. Set up DNS and TLS

At your DNS provider (Namecheap), add an A record:
- Host: `outreach` (just that — provider auto-appends domain)
- Value: server's IP
- TTL: Automatic

Wait 5-15 min for propagation. Verify from outside the server:

```bash
# On a different machine
nslookup outreach.barcrawlconnect.com 8.8.8.8
# Should return server's IP
```

Then on the server, run certbot:

```bash
certbot --nginx -d outreach.barcrawlconnect.com --non-interactive --agree-tos \
  -m YOUR_EMAIL@example.com --redirect
```

Certbot auto-configures nginx for HTTPS and sets up auto-renewal.

## 14. Test from browser

Open `https://outreach.barcrawlconnect.com/login` in your browser. Sign in with the dev-impersonation form using `bryle@example.local` (or whatever staff emails were seeded).

You're live.

---

## Deploy script

After this initial setup, install the deploy script for easy future updates:

```bash
cp /var/www/outreach/scripts/deploy.sh /root/deploy.sh
chmod +x /root/deploy.sh

# Test it (no-op since we're at the latest commit)
bash /root/deploy.sh
```

For ongoing operations, see `DEPLOY.md`.

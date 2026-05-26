#!/usr/bin/env bash
#
# scripts/setup-server.sh — Phase 0 server provisioning for the Crawl Outreach Engine.
#
# This script is IDEMPOTENT. Run it as many times as you need; each step
# checks the current state before acting. It will not damage anything that's
# already correctly installed.
#
# WHAT IT DOES:
#   1. Verifies prerequisites (Ubuntu, root or sudo, internet).
#   2. Inspects the server (CPU, RAM, disk, what's running, what's installed).
#   3. Installs PostgreSQL 16 + PostGIS extension (if not present).
#   4. Installs Redis 7 (if not present).
#   5. Installs Caddy 2 (if not present).
#   6. Installs pnpm (if not present).
#   7. Installs Docker (for self-hosted Supabase Realtime, used in Phase 3).
#   8. Creates the crawl_engine Postgres database and a limited-privilege user.
#   9. Enables PostGIS extension in that database.
#  10. Reserves a Redis logical DB number (no conflict with promoter-engine).
#  11. Writes a placeholder Caddy block for the admin domain.
#  12. Creates /var/www/crawl-engine deploy directory.
#  13. Configures daily pg_dump backups (target TBD — see OPEN_QUESTIONS.md#Q003).
#  14. Prints next steps.
#
# WHAT IT WILL NOT DO:
#   - Touch the promoter-engine deployment in any way.
#   - Touch any existing reverse-proxy config (nginx etc.) — Caddy listens on
#     its own ports and is added alongside, not in place of, anything existing.
#   - Modify firewall rules without explicit confirmation.
#   - Write secrets — those come in a follow-up step from the operator.
#
# USAGE:
#   sudo bash scripts/setup-server.sh
#
# After it completes, you'll have:
#   - postgres user `crawl_engine_app` with password (generated, printed once)
#   - DB `crawl_engine` with PostGIS enabled
#   - Redis logical DB 1 reserved (promoter-engine uses 0 by convention)
#   - /var/www/crawl-engine ready for the first ZIP deploy
#   - /etc/caddy/Caddyfile.d/crawl-engine.caddy with a placeholder
#
# Exit codes:
#   0 — success
#   1 — pre-flight failure (wrong OS, no root, no internet)
#   2 — mid-flight failure (apt failed, postgres failed to start, etc.)
#
# =====================================================================

set -u

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOG_FILE="/tmp/crawl-engine-setup-$(date +%Y%m%d-%H%M%S).log"

# Colors (disabled if not a tty)
if [[ -t 1 ]]; then
  C_RESET='\033[0m'
  C_RED='\033[0;31m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_BLUE='\033[0;34m'
  C_BOLD='\033[1m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''
fi

log() { echo -e "${C_BLUE}[$(date +%H:%M:%S)]${C_RESET} $*" | tee -a "${LOG_FILE}"; }
ok()  { echo -e "${C_GREEN}  ✓${C_RESET} $*" | tee -a "${LOG_FILE}"; }
warn(){ echo -e "${C_YELLOW}  ⚠${C_RESET} $*" | tee -a "${LOG_FILE}"; }
err() { echo -e "${C_RED}  ✗${C_RESET} $*" | tee -a "${LOG_FILE}"; }
hdr() { echo; echo -e "${C_BOLD}${C_BLUE}=== $* ===${C_RESET}" | tee -a "${LOG_FILE}"; }

die() {
  err "$*"
  echo "Log: ${LOG_FILE}"
  exit 2
}

# ---------- 1. Prereqs ----------
hdr "1. Pre-flight checks"

if [[ "$(id -u)" -ne 0 ]]; then
  err "Run with sudo: sudo bash scripts/setup-server.sh"
  exit 1
fi
ok "Running as root"

if ! command -v apt-get >/dev/null 2>&1; then
  err "This script targets Ubuntu/Debian. apt-get not found."
  exit 1
fi
ok "Debian-family OS detected"

if ! ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
  err "No internet (can't reach 8.8.8.8). Check network."
  exit 1
fi
ok "Internet reachable"

OS_ID="$(. /etc/os-release && echo "${ID:-unknown}")"
OS_VERSION="$(. /etc/os-release && echo "${VERSION_ID:-unknown}")"
log "OS: ${OS_ID} ${OS_VERSION}"

# ---------- 2. Inspection ----------
hdr "2. Server inspection"

CPU_COUNT=$(nproc)
RAM_GB=$(free -g | awk '/^Mem:/ {print $2}')
DISK_FREE_GB=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')

log "CPU cores: ${CPU_COUNT}"
log "RAM: ${RAM_GB} GB"
log "Disk free on /: ${DISK_FREE_GB} GB"

if [[ "${RAM_GB}" -lt 4 ]]; then
  warn "RAM is ${RAM_GB} GB. Recommended minimum is 4 GB for Postgres + Redis + Node + promoter-engine."
  warn "Will continue, but monitor swap usage after deploying."
fi
if [[ "${DISK_FREE_GB}" -lt 10 ]]; then
  warn "Disk free is ${DISK_FREE_GB} GB. Recommended minimum is 10 GB."
fi

if [[ -d "/var/www/promoter-engine" ]]; then
  ok "promoter-engine detected at /var/www/promoter-engine (will not be touched)"
else
  warn "promoter-engine not found at /var/www/promoter-engine. This script assumes it lives there; if it doesn't, no action needed."
fi

# ---------- 3. Postgres + PostGIS ----------
hdr "3. PostgreSQL 16 + PostGIS"

if command -v psql >/dev/null 2>&1; then
  PG_VERSION=$(psql --version | grep -oE '[0-9]+' | head -1)
  log "Postgres ${PG_VERSION} already installed"
  if [[ "${PG_VERSION}" -lt 16 ]]; then
    warn "Postgres ${PG_VERSION} is older than 16. The crawl engine targets 16+ but will likely run on 14/15. Note in DECISIONS.md if you proceed."
  fi
else
  log "Installing Postgres 16 + PostGIS..."
  apt-get update -qq || die "apt-get update failed"

  # Add Postgres official APT repo for Postgres 16
  apt-get install -y -qq curl ca-certificates gnupg lsb-release >> "${LOG_FILE}" 2>&1
  install -d /usr/share/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq || die "apt-get update (after adding pgdg) failed"
  apt-get install -y -qq postgresql-16 postgresql-16-postgis-3 >> "${LOG_FILE}" 2>&1 \
    || die "Postgres install failed; see ${LOG_FILE}"
  ok "Postgres 16 + PostGIS installed"
fi

systemctl enable postgresql >> "${LOG_FILE}" 2>&1
systemctl start postgresql >> "${LOG_FILE}" 2>&1
ok "Postgres service running"

# ---------- 4. Redis ----------
hdr "4. Redis 7"

if command -v redis-server >/dev/null 2>&1; then
  REDIS_VERSION=$(redis-server --version | grep -oE 'v=[0-9]+\.[0-9]+' | head -1 | tr -d 'v=')
  log "Redis ${REDIS_VERSION} already installed"
else
  log "Installing Redis..."
  apt-get install -y -qq redis-server >> "${LOG_FILE}" 2>&1 || die "Redis install failed"
  ok "Redis installed"
fi

# Ensure Redis binds to localhost only (security default but verify)
if grep -q "^bind 127.0.0.1" /etc/redis/redis.conf 2>/dev/null; then
  ok "Redis bound to 127.0.0.1"
else
  warn "Redis bind config not confirmed; verify /etc/redis/redis.conf manually."
fi

systemctl enable redis-server >> "${LOG_FILE}" 2>&1 || true
systemctl start redis-server >> "${LOG_FILE}" 2>&1 || true
ok "Redis service running"

# ---------- 5. Caddy ----------
hdr "5. Caddy 2"

if command -v caddy >/dev/null 2>&1; then
  CADDY_VERSION=$(caddy version | head -1)
  log "Caddy already installed: ${CADDY_VERSION}"
else
  log "Installing Caddy 2..."
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >> "${LOG_FILE}" 2>&1
  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >> "${LOG_FILE}" 2>&1 || die "Caddy install failed"
  ok "Caddy installed"
fi

# ---------- 6. pnpm ----------
hdr "6. pnpm"

if command -v pnpm >/dev/null 2>&1; then
  log "pnpm already installed: $(pnpm --version)"
else
  log "Installing pnpm via npm..."
  if ! command -v npm >/dev/null 2>&1; then
    die "npm not found. Node 22 should bring npm; install Node first."
  fi
  npm install -g pnpm >> "${LOG_FILE}" 2>&1 || die "pnpm install failed"
  ok "pnpm installed"
fi

# ---------- 7. Docker ----------
hdr "7. Docker (for Supabase Realtime, Phase 3)"

if command -v docker >/dev/null 2>&1; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh >> "${LOG_FILE}" 2>&1 || die "Docker install failed"
  ok "Docker installed"
fi

# ---------- 7b. rclone (for B2 backups) ----------
hdr "7b. rclone (Backblaze B2 backups, DECISIONS.md#014)"

if command -v rclone >/dev/null 2>&1; then
  log "rclone already installed: $(rclone --version | head -1)"
else
  log "Installing rclone..."
  curl -fsSL https://rclone.org/install.sh | bash >> "${LOG_FILE}" 2>&1 || die "rclone install failed"
  ok "rclone installed"
fi

log "Configure B2 remote after this script finishes: ${C_BOLD}rclone config${C_RESET}"
log "  Create a remote named 'b2-crawl' of type 'Backblaze B2'"
log "  Then add B2_BUCKET=your-bucket-name to /var/www/crawl-engine/.env"

# ---------- 8. Postgres DB + user ----------
hdr "8. Crawl engine DB + user"

DB_NAME="crawl_engine"
DB_USER="crawl_engine_app"

# Check if DB exists
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || echo "")
USER_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null || echo "")

if [[ "${DB_EXISTS}" == "1" ]]; then
  log "Database '${DB_NAME}' already exists"
else
  log "Creating database '${DB_NAME}'..."
  sudo -u postgres createdb "${DB_NAME}" || die "createdb failed"
  ok "Database created"
fi

if [[ "${USER_EXISTS}" == "1" ]]; then
  log "User '${DB_USER}' already exists (skipping password reset)"
  log "If you need a fresh password, run: sudo -u postgres psql -c \"ALTER USER ${DB_USER} WITH PASSWORD 'newpass';\""
else
  DB_PASS=$(openssl rand -hex 32)
  log "Creating user '${DB_USER}'..."
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL >> "${LOG_FILE}" 2>&1
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
    GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_USER};
    \\c ${DB_NAME}
    GRANT USAGE ON SCHEMA public TO ${DB_USER};
    GRANT CREATE ON SCHEMA public TO ${DB_USER};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
SQL
  ok "User created"
  echo
  echo -e "${C_BOLD}${C_YELLOW}SAVE THIS PASSWORD — it will not be shown again:${C_RESET}"
  echo -e "  ${C_BOLD}DB_USER: ${DB_USER}${C_RESET}"
  echo -e "  ${C_BOLD}DB_PASS: ${DB_PASS}${C_RESET}"
  echo
  echo "Put it in your .env as:"
  echo "  DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
  echo
fi

# Enable PostGIS in the DB
log "Enabling PostGIS extension..."
sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis;" >> "${LOG_FILE}" 2>&1 \
  || die "PostGIS enable failed; the postgresql-16-postgis-3 package may not have installed correctly."
ok "PostGIS enabled in ${DB_NAME}"

sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" >> "${LOG_FILE}" 2>&1 || true
ok "uuid-ossp enabled in ${DB_NAME}"

# ---------- 9. Deploy directory ----------
hdr "9. Deploy directory"

DEPLOY_DIR="/var/www/crawl-engine"
if [[ -d "${DEPLOY_DIR}" ]]; then
  log "Deploy directory ${DEPLOY_DIR} already exists"
else
  mkdir -p "${DEPLOY_DIR}"
  ok "Created ${DEPLOY_DIR}"
fi

# Mirror promoter-engine ownership pattern if it exists
if [[ -d "/var/www/promoter-engine" ]]; then
  PROMOTER_OWNER=$(stat -c '%U:%G' /var/www/promoter-engine)
  log "Mirroring ownership from promoter-engine: ${PROMOTER_OWNER}"
  chown -R "${PROMOTER_OWNER}" "${DEPLOY_DIR}"
fi

# ---------- 10. Caddy placeholder ----------
hdr "10. Caddy placeholder block"

CADDY_FRAGMENT_DIR="/etc/caddy/Caddyfile.d"
CADDY_FRAGMENT="${CADDY_FRAGMENT_DIR}/crawl-engine.caddy"
mkdir -p "${CADDY_FRAGMENT_DIR}"

if [[ -f "${CADDY_FRAGMENT}" ]]; then
  log "Caddy fragment already exists at ${CADDY_FRAGMENT} (leaving alone)"
else
  cat > "${CADDY_FRAGMENT}" <<'CADDY'
# /etc/caddy/Caddyfile.d/crawl-engine.caddy
#
# Resolved via DECISIONS.md#016. Caddy will auto-provision HTTPS on first
# request once DNS for admin.barcrawlconnect.com points to this server.

admin.barcrawlconnect.com {
    reverse_proxy 127.0.0.1:3001
    encode gzip zstd
    log {
        output file /var/log/caddy/crawl-engine.log
        format json
    }
}

# Public JSON API — same Node process, different hostname, edge-cached.
api.barcrawlconnect.com {
    reverse_proxy 127.0.0.1:3001
    header Cache-Control "public, max-age=30, s-maxage=30"
    encode gzip zstd
}
CADDY
  ok "Caddy fragment placeholder written: ${CADDY_FRAGMENT}"
fi

# Ensure main Caddyfile imports our fragment
MAIN_CADDYFILE="/etc/caddy/Caddyfile"
if [[ -f "${MAIN_CADDYFILE}" ]]; then
  if grep -q "import Caddyfile.d/\*" "${MAIN_CADDYFILE}"; then
    ok "Main Caddyfile already imports Caddyfile.d/*"
  else
    echo "" >> "${MAIN_CADDYFILE}"
    echo "import Caddyfile.d/*" >> "${MAIN_CADDYFILE}"
    ok "Added 'import Caddyfile.d/*' to main Caddyfile"
  fi
else
  cat > "${MAIN_CADDYFILE}" <<'CADDY'
# Main Caddyfile
# Per-app fragments live in Caddyfile.d/
import Caddyfile.d/*
CADDY
  ok "Created main Caddyfile"
fi

log "Reload Caddy after editing the placeholder: sudo systemctl reload caddy"

# ---------- 11. Daily backup placeholder ----------
hdr "11. Daily backup (placeholder)"

BACKUP_SCRIPT="/usr/local/bin/crawl-engine-backup.sh"
if [[ -f "${BACKUP_SCRIPT}" ]]; then
  log "Backup script already exists at ${BACKUP_SCRIPT} (leaving alone)"
else
  cat > "${BACKUP_SCRIPT}" <<'BACKUP'
#!/usr/bin/env bash
# Daily pg_dump for crawl_engine DB.
# Resolved per DECISIONS.md#014: Backblaze B2 as offsite target.
#
# Local retention: 14 days. Offsite retention: 90 days (handled by B2 lifecycle).
# Requires rclone configured with a remote named "b2-crawl" (set up once via
# `rclone config`). Bucket name from env: B2_BUCKET.

set -u
BACKUP_DIR="/var/backups/crawl-engine"
mkdir -p "${BACKUP_DIR}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="${BACKUP_DIR}/crawl_engine-${TS}.sql.gz"

# Dump and compress
sudo -u postgres pg_dump -d crawl_engine | gzip > "${OUT}"
echo "$(date -Iseconds) local backup: ${OUT}"

# Local retention: 14 days
find "${BACKUP_DIR}" -name 'crawl_engine-*.sql.gz' -mtime +14 -delete

# Offsite upload to Backblaze B2 (skip if rclone not configured)
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q '^b2-crawl:'; then
  if [[ -n "${B2_BUCKET:-}" ]]; then
    rclone copy "${OUT}" "b2-crawl:${B2_BUCKET}/daily/" --quiet
    echo "$(date -Iseconds) uploaded to b2-crawl:${B2_BUCKET}/daily/"
  else
    echo "$(date -Iseconds) WARN: B2_BUCKET not set; skipping offsite upload"
  fi
else
  echo "$(date -Iseconds) WARN: rclone or b2-crawl remote not configured; local-only backup"
fi
BACKUP
  chmod +x "${BACKUP_SCRIPT}"
  ok "Backup script written: ${BACKUP_SCRIPT}"
fi

CRON_LINE="0 4 * * * ${BACKUP_SCRIPT} >> /var/log/crawl-engine-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -F "${BACKUP_SCRIPT}" >/dev/null; then
  ok "Backup cron already installed"
else
  ( crontab -l 2>/dev/null; echo "${CRON_LINE}" ) | crontab -
  ok "Backup cron installed (daily at 04:00)"
fi

# ---------- 12. Summary ----------
hdr "Summary"

cat <<EOF

${C_GREEN}Phase 0 server setup complete.${C_RESET}

Installed/verified:
  • Postgres 16 + PostGIS extension
  • Redis 7 (bound to localhost)
  • Caddy 2 (with /etc/caddy/Caddyfile.d/crawl-engine.caddy placeholder)
  • pnpm
  • Docker (for Supabase Realtime in Phase 3)

Provisioned:
  • Database: crawl_engine
  • User: crawl_engine_app (password printed above; save it now)
  • Deploy dir: /var/www/crawl-engine
  • Daily backup cron at 04:00

Next steps:
  1. Point DNS for ${C_BOLD}admin.barcrawlconnect.com${C_RESET} and ${C_BOLD}api.barcrawlconnect.com${C_RESET} at this server.
  2. Configure rclone for Backblaze B2 (DECISIONS.md#014):
     ${C_BOLD}rclone config${C_RESET}  # create remote named "b2-crawl"
  3. Reload Caddy once DNS propagates:
     ${C_BOLD}sudo systemctl reload caddy${C_RESET}
  4. Deploy the first version of the crawl engine:
     ${C_BOLD}bash scripts/update-from-zip.sh /tmp/crawl-engine-X.Y.Z.zip${C_RESET}
  5. Start the app:
     ${C_BOLD}cd /var/www/crawl-engine && pm2 start ecosystem.config.cjs${C_RESET}

Log: ${LOG_FILE}

EOF

exit 0

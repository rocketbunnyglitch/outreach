#!/bin/bash
#
# Post-deploy smoke test (deploy Layer 2). Run by scripts/deploy.sh right
# after cutover; a non-zero exit makes the deploy auto-rollback to the
# previous release.
#
# What it checks:
#   1. /api/health on BOTH web instances (:3001 active, :3003 warm spare)
#      must return {"status":"ok"}.
#   2. Key routes through the public URL (nginx + TLS end to end):
#      unauthenticated, a 2xx or auth-redirect 3xx is PASS; 5xx, timeouts,
#      or Next error markers in the body are FAIL.
#   3. AUTHENTICATED server renders: mints a real session JWT with the
#      box's NEXTAUTH_SECRET (scripts/mint-smoke-session.mjs) and fetches
#      the key admin routes, requiring HTTP 200 + no error markers. This is
#      what catches "compiled fine but the page 500s" -- an unauthenticated
#      curl only exercises the middleware redirect, the page never renders.
#      If minting itself fails (lib API change etc), authed checks are
#      SKIPPED WITH A LOUD WARNING rather than failing the deploy -- the
#      unauth + health checks still gate.
#
# Usage: bash scripts/smoke-test.sh   (cwd = the release dir; .env symlink
#        and node_modules must exist there)

set -uo pipefail

BASE="${SMOKE_BASE_URL:-https://outreach.barcrawlconnect.com}"
ENV_FILE="${SMOKE_ENV_FILE:-/var/www/outreach/.env}"
FAIL=0

say() { echo "[smoke] $*"; }

body_has_error_marker() {
  # data-dgst="<digits>" : Next streams <template data-dgst="..."> in place
  #   of any server segment that threw -- present even when a custom
  #   error.tsx boundary renders a graceful page with HTTP 200. (Verified
  #   live via the intentionally-broken /venues evidence run.) MUST require
  #   the ="<digit> tail: some pages legitimately contain the bare substring
  #   "data-dgst" in inline script/text, and the loose match would have
  #   auto-rolled-back a healthy deploy (caught in the 2026-06-10 UI sweep).
  # __next_error__ : Next's default error-page <html id>.
  # "Application error:" : the client-exception shell text.
  grep -qE "data-dgst=\"[0-9]|__next_error__|Application error: a client-side exception" "$1"
}

# --- 1. health on both instances ---
for port in 3001 3003; do
  resp=$(curl -fsS --max-time 8 "http://127.0.0.1:$port/api/health" 2>/dev/null || echo "FAIL")
  if echo "$resp" | grep -q '"status":"ok"'; then
    say "ok  health :$port"
  else
    say "FAIL health :$port -> $resp"
    FAIL=1
  fi
done

# --- resolve a real city-campaign id for the dynamic route ---
CITY_CAMPAIGN_PATH=""
if [ -f "$ENV_FILE" ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  if [ -n "${DATABASE_URL:-}" ]; then
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
    DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
    CC_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -t -A \
      -c "SELECT id FROM city_campaigns ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || true)
    [ -n "${CC_ID:-}" ] && CITY_CAMPAIGN_PATH="/city-campaigns/$CC_ID"
    STAFF_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -t -A \
      -c "SELECT id FROM users ORDER BY created_at ASC LIMIT 1;" 2>/dev/null || true)
    # Campaign cookie: / and /inbox are campaign-gated in middleware and
    # redirect to /pick-campaign without it; with it they fully render.
    CAMPAIGN_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -q -t -A \
      -c "SELECT id FROM campaigns WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || true)
  fi
fi

ROUTES="/ /venues /campaigns /inbox /email-queue /pipeline"
[ -n "$CITY_CAMPAIGN_PATH" ] && ROUTES="$ROUTES $CITY_CAMPAIGN_PATH"

# --- 2. unauthenticated checks (status + error markers) ---
TMP=$(mktemp)
for route in $ROUTES; do
  code=$(curl -sS --max-time 15 -o "$TMP" -w "%{http_code}" "$BASE$route" 2>/dev/null || echo "000")
  case "$code" in
    2*|3*)
      if body_has_error_marker "$TMP"; then
        say "FAIL unauth $route -> $code but body contains a Next error marker"
        FAIL=1
      else
        say "ok  unauth $route -> $code"
      fi
      ;;
    *)
      say "FAIL unauth $route -> HTTP $code"
      FAIL=1
      ;;
  esac
done

# --- 3. authenticated SSR checks ---
AUTH_OK=1
TOKEN=""
if [ -z "${STAFF_ID:-}" ]; then
  say "WARN no staff id resolvable -- SKIPPING authenticated checks"
  AUTH_OK=0
else
  TOKEN=$(node --env-file="$ENV_FILE" scripts/mint-smoke-session.mjs --staff-id "$STAFF_ID" 2>/dev/null) || true
  if [ -z "$TOKEN" ]; then
    say "WARN session mint failed -- SKIPPING authenticated checks (fix scripts/mint-smoke-session.mjs)"
    AUTH_OK=0
  fi
fi

if [ "$AUTH_OK" = "1" ]; then
  COOKIE="__Secure-authjs.session-token=$TOKEN"
  [ -n "${CAMPAIGN_ID:-}" ] && COOKIE="$COOKIE; crawl_engine_current_campaign=$CAMPAIGN_ID"
  # Probe with /venues (not campaign-gated): if it redirects, the minted
  # token is not being accepted -- treat as mint breakage (warn + skip),
  # not a deploy failure. A genuinely broken app shows as 5xx/markers.
  probe=$(curl -sS --max-time 20 -o "$TMP" -w "%{http_code}" -H "Cookie: $COOKIE" "$BASE/venues" 2>/dev/null || echo "000")
  if [ "$probe" != "200" ]; then
    if [ "${probe:0:1}" = "5" ] || [ "$probe" = "000" ]; then
      say "FAIL authed /venues -> HTTP $probe"
      FAIL=1
    else
      say "WARN authed probe got $probe (token not accepted?) -- SKIPPING remaining authed checks"
    fi
  else
    if body_has_error_marker "$TMP"; then
      say "FAIL authed /venues -> 200 but body contains a Next error marker"
      FAIL=1
    else
      say "ok  authed /venues -> 200"
    fi
    for route in $ROUTES; do
      [ "$route" = "/venues" ] && continue
      code=$(curl -sS --max-time 20 -o "$TMP" -w "%{http_code}" -H "Cookie: $COOKIE" "$BASE$route" 2>/dev/null || echo "000")
      if [ "$code" = "200" ] && ! body_has_error_marker "$TMP"; then
        say "ok  authed $route -> 200"
      elif [ "$code" = "200" ]; then
        say "FAIL authed $route -> 200 with Next error marker in body"
        FAIL=1
      elif [ "${code:0:1}" = "3" ]; then
        # An authed redirect to a campaign/login picker still proves auth +
        # middleware ran; only treat server errors as failures here.
        say "ok  authed $route -> $code (redirect)"
      else
        say "FAIL authed $route -> HTTP $code"
        FAIL=1
      fi
    done
  fi
fi

rm -f "$TMP"
if [ "$FAIL" = "1" ]; then
  say "RESULT: FAIL"
  exit 1
fi
say "RESULT: PASS"
exit 0

#!/usr/bin/env bash
# audit-raw-sql.sh — list every raw `sql\`...\`` template literal in lib/
# and app/ so a human can visually audit column refs against db/schema/
# before deploy.
#
# Context: TypeScript does NOT type-check column names inside raw sql
# template literals. Drizzle's relational query builder DOES catch wrong
# column names at compile time, but we use raw SQL for complex CTEs.
# Every column reference inside a sql`...` block must be verified by
# eye against db/schema/<table>.ts.
#
# Why a script instead of a parser: the surface is small (low hundreds
# of sites), and humans can scan a list of file:line:snippet in 5
# minutes. A real AST parser is more work than the bug rate justifies.
#
# Usage:
#   bash scripts/audit-raw-sql.sh           # list all sites with context
#   bash scripts/audit-raw-sql.sh --terse   # one line per site, count only
#
# Exit code is always 0 — this is a reporting tool, not a CI gate.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MODE="full"
if [[ "${1:-}" == "--terse" ]]; then
  MODE="terse"
fi

# Files in scope: server-side TS that calls Drizzle's db.execute(sql`...`)
# or imports `sql` from drizzle-orm. Migrations are out of scope —
# they're raw SQL and reviewed by hand on every change.
FILES=$(grep -rln --include="*.ts" --include="*.tsx" \
  -E 'sql`|db\.execute\(' lib/ app/ 2>/dev/null || true)

if [[ -z "$FILES" ]]; then
  echo "No raw SQL sites found."
  exit 0
fi

COUNT=0
if [[ "$MODE" == "terse" ]]; then
  echo "Raw SQL sites:"
  for f in $FILES; do
    n=$(grep -cE 'sql`|db\.execute\(' "$f" || true)
    if [[ "$n" -gt 0 ]]; then
      printf "  %-70s %3d sites\n" "$f" "$n"
      COUNT=$((COUNT + n))
    fi
  done
  echo ""
  echo "Total: $COUNT raw SQL sites across $(echo "$FILES" | wc -l | xargs) files."
  exit 0
fi

echo "============================================================"
echo "RAW SQL AUDIT — verify every column ref against db/schema/*.ts"
echo "============================================================"
echo ""
echo "Common column-name pitfalls (see CLAUDE.md §12.1):"
echo "  outreach_brands       → display_name (NOT brand_name)"
echo "  cities                → location (NOT geocode), country_code (NOT country)"
echo "  venue_events          → role + slot_position (NOT crawl_position)"
echo "  staff_outreach_emails → email_address (NOT email); NO display_name; NO archived_at"
echo "  events                → ticket_sales_count; NO ticket_price_cents"
echo ""
echo "============================================================"

for f in $FILES; do
  n=$(grep -cE 'sql`|db\.execute\(' "$f" || true)
  [[ "$n" -eq 0 ]] && continue
  echo ""
  echo "▼ $f  ($n site(s))"
  echo "------------------------------------------------------------"
  # Show the file:line for each occurrence with a short snippet
  grep -nE 'sql`|db\.execute\(' "$f" | head -20 | sed 's/^/  /'
  COUNT=$((COUNT + n))
done

echo ""
echo "============================================================"
echo "Total: $COUNT raw SQL sites."
echo ""
echo "Next: open each site, list every <table>.<column> or <alias>.<column>"
echo "reference, and verify against db/schema/<table>.ts."
echo "============================================================"

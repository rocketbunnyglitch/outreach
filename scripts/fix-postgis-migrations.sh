#!/usr/bin/env bash
#
# scripts/fix-postgis-migrations.sh
#
# Known Drizzle behavior: customType identifiers containing parens or
# spaces (like `geography(POINT, 4326)`) get wrapped in double quotes in
# the generated DDL, which Postgres then treats as a literal identifier
# and fails to resolve.
#
# This script strips the over-quoting for known PostGIS types. Runs as a
# post-step of `pnpm db:generate`. Idempotent.
#
# When Drizzle gains native PostGIS support (issue tracked upstream), this
# step can be removed.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

migrations=$(find db/migrations -name '*.sql' -type f)

if [[ -z "${migrations}" ]]; then
  exit 0
fi

# Currently used PostGIS types in the schema:
for f in ${migrations}; do
  # Skip if already fixed (or doesn't contain the bad pattern)
  if grep -q '"geography(POINT, 4326)"' "${f}"; then
    sed -i 's/"geography(POINT, 4326)"/geography(POINT, 4326)/g' "${f}"
    echo "  fixed PostGIS quoting in ${f}"
  fi
done

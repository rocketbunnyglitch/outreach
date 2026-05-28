#!/usr/bin/env bash
# audit-server-only-imports.sh — catch the build-breaking pattern where a
# client component value-imports from a `server-only` module.
#
# Context (CLAUDE.md §12.2): a module that does `import "server-only"`
# throws if it's ever pulled into the browser bundle. TYPE-only imports
# (`import type { X }`) are erased at compile time and are safe. But a
# VALUE import (a const or function — e.g. `import { SLOT_ROLE_ORDER }`)
# drags the whole server-only module into the client bundle and fails
# the `next build` with the standard server-only-in-client error.
#
# This bit us once: crawl-slot-table.tsx (a "use client" component)
# imported the SLOT_ROLE_ORDER *value* from lib/city-sheet-data.ts
# (server-only). The fix was to split the client-safe types + consts
# into lib/city-sheet-shared.ts (no server-only, no db) and import from
# there. See also lib/tracker-status-types.ts (split from
# tracker-status.ts) and lib/city-progress-shared.ts.
#
# Run before deploy. Exits non-zero if it finds a violation, so it can
# gate CI later if desired.
#
# Why a script not a parser: the surface is small and a heuristic grep
# catches the real-world case (value import from a known server-only
# specifier) cheaply.

set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Collect modules that actually declare `import "server-only";`
#    (line-anchored — ignore the string appearing in comments).
mapfile -t SERVER_ONLY < <(
  grep -rlE '^import "server-only";' lib/ 2>/dev/null \
    | sed -E 's|^lib/|@/lib/|; s|\.ts$||'
)

if [ "${#SERVER_ONLY[@]}" -eq 0 ]; then
  echo "No server-only modules found (unexpected) — check the grep."
  exit 0
fi

echo "Server-only modules (${#SERVER_ONLY[@]}):"
printf '  %s\n' "${SERVER_ONLY[@]}"
echo ""

# 2) For each "use client" file under app/ and components/, flag any
#    NON-type import from a server-only module.
violations=0
while IFS= read -r file; do
  # only client components
  if ! head -3 "$file" | grep -qE '^"use client";|^'"'"'use client'"'"';'; then
    continue
  fi
  for spec in "${SERVER_ONLY[@]}"; do
    # `import { ... } from "<spec>"` WITHOUT a leading `type` keyword.
    if grep -nE "^import[[:space:]]+\{[^}]*\}[[:space:]]+from[[:space:]]+[\"']${spec//\//\\/}[\"']" "$file" >/dev/null 2>&1; then
      echo "⚠️  $file"
      echo "     value-imports from server-only $spec"
      echo "     → move the shared const/type into a *-shared.ts (no server-only, no db) and import that."
      violations=$((violations + 1))
    fi
  done
done < <(find app components -type f \( -name '*.tsx' -o -name '*.ts' \) 2>/dev/null)

echo ""
if [ "$violations" -gt 0 ]; then
  echo "❌ $violations server-only-in-client violation(s). Fix before deploy (see CLAUDE.md §12.2)."
  exit 1
fi
echo "✅ No client component value-imports from server-only modules."

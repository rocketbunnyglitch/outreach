#!/usr/bin/env bash
# audit-client-helper-imports.sh — catch the INVERSE of
# audit-server-only-imports.sh: a SERVER component value-importing a
# non-component helper from a `"use client"` module.
#
# Context: importing a client COMPONENT from a server component is the
# normal composition pattern and fine. But importing a lowercase helper
# (a plain function/const) and CALLING it during server render throws
# at runtime ("Functions exported from client modules cannot be called
# from server components"). This took /inbox down once: ThreadPane (a
# server component) called normalizeQuickReplies exported from the
# use-client QuickReplyChips.tsx (fix c6aa50a — helper moved to
# lib/quick-replies-shared.ts).
#
# Heuristic: components are PascalCase, helpers are camelCase. Flag any
# camelCase named import from a use-client module by a file that does
# NOT itself declare "use client". import type {...} is ignored.
#
# Run before deploy. Exits non-zero on a violation.

set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Modules declaring "use client" (first 3 lines, quoted either way).
client_modules=$(grep -rlE '^\s*["'\'']use client["'\'']' app components lib --include='*.tsx' --include='*.ts' 2>/dev/null || true)

violations=0

for mod in $client_modules; do
  # Module specifier as importers would write it: strip extension, map to @/ alias.
  spec="@/${mod%.tsx}"
  spec="${spec%.ts}"

  # Files importing from this module.
  importers=$(grep -rlE "from ['\"]${spec}['\"]" app components lib --include='*.tsx' --include='*.ts' 2>/dev/null || true)
  for imp in $importers; do
    [ "$imp" = "$mod" ] && continue
    # Skip importers that are themselves client modules — calling client
    # helpers from client code is fine.
    if head -5 "$imp" | grep -qE '^\s*["'\'']use client["'\'']'; then
      continue
    fi
    # Pull the named-import list; ignore `import type` lines entirely.
    lines=$(grep -E "import\s*\{[^}]*\}\s*from ['\"]${spec}['\"]" "$imp" | grep -v 'import type' || true)
    [ -z "$lines" ] && continue
    # camelCase names in the braces = helper value imports. `type X` inside
    # mixed braces is stripped first.
    helpers=$(echo "$lines" \
      | sed -E 's/.*\{([^}]*)\}.*/\1/' \
      | tr ',' '\n' \
      | sed -E 's/^\s+|\s+$//g; s/\s+as\s+.*//' \
      | grep -vE '^type\s' \
      | grep -E '^[a-z][a-zA-Z0-9]*$' || true)
    if [ -n "$helpers" ]; then
      echo "VIOLATION: $imp imports helper(s) [$(echo "$helpers" | tr '\n' ' ' | sed 's/ $//')] from use-client module $mod"
      violations=$((violations + 1))
    fi
  done
done

if [ "$violations" -gt 0 ]; then
  echo "audit-client-helper-imports: $violations violation(s) — move the helper to a *-shared.ts module (no directives)."
  exit 1
fi
echo "audit-client-helper-imports: clean."

/**
 * Server-rendered version footer visible to all staff.
 *
 * Per DECISIONS.md#003 (PM2) and the spec §10.3, every admin page shows the
 * version, commit, and build time so bug reports always include precise
 * version context. Clicking opens an expanded view (TBD in Phase 3).
 *
 * Rendered as a React Server Component — no client JS needed for the static
 * version info. If we add the expanded modal later, we'll co-locate a small
 * client component beside this one.
 */

import { getVersionLine } from "@/lib/version";

export function VersionFooter() {
  return (
    <footer
      className="fixed right-0 bottom-0 z-50 select-none px-3 py-1.5 font-mono text-xs text-zinc-500 dark:text-zinc-400"
      aria-label="Application version"
    >
      {getVersionLine()}
    </footer>
  );
}

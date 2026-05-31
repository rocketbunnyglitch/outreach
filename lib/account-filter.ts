/**
 * Parse the `?accounts=<id>,<id>` URL param into a UUID list.
 *
 * Used by both the inbox page + the thread detail page to feed
 * fetchInboxThreads / fetchFolderCounts the operator's
 * AccountSwitcher scope.
 *
 * Returns undefined when the param is missing OR every id is
 * malformed — that's the "no filter" sentinel value. Returns a
 * non-empty array of valid UUIDs otherwise. Garbage entries are
 * dropped silently rather than throwing; a stray semicolon or
 * stale id shouldn't 500 the whole page.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAccountIds(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
  return ids.length > 0 ? ids : undefined;
}

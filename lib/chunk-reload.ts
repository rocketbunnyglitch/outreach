/**
 * Stale code-split chunk auto-recovery.
 *
 * Next.js emits content-hashed, immutable chunks (…-<hash>.js). A deploy
 * replaces them and the previous build's hashes 404. A tab loaded before
 * the deploy still references the old hashes, so the first lazy import()
 * (opening a dialog, entering a route segment) fails with a ChunkLoadError
 * and React tears the page down — a "crash" that only hits long-lived
 * logged-in tabs, never a freshly opened incognito window.
 *
 * The root document is served no-store, so a plain reload pulls the
 * current build's HTML + matching chunks. These helpers detect the chunk
 * failure and reload exactly once, guarded by a short sessionStorage
 * cooldown so a genuinely broken build can't trap the tab in a loop.
 */
const COOLDOWN_KEY = "perse:chunk-reload-at";
const COOLDOWN_MS = 15_000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk\s+[\w-]+\s+failed|Loading CSS chunk|(?:error|Failed) loading dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function looksLikeChunkError(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") return CHUNK_ERROR_RE.test(value);
  if (value instanceof Error) {
    return CHUNK_ERROR_RE.test(value.name) || CHUNK_ERROR_RE.test(value.message);
  }
  return false;
}

/**
 * If `value` is a stale-chunk failure, trigger a one-time reload to pull
 * the current build and return true. Returns false (no reload) otherwise,
 * or if the cooldown is still active.
 */
export function maybeReloadForChunkError(value: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!looksLikeChunkError(value)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(COOLDOWN_KEY) ?? "0");
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return false;
    window.sessionStorage.setItem(COOLDOWN_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked (rare) — fall through and reload anyway.
  }
  window.location.reload();
  return true;
}

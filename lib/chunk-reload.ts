/**
 * Auto-recovery for two client-side failure modes that "freeze" the app
 * but are usually transient on a fresh load:
 *
 *  1. Stale code-split chunks after a deploy. Next.js emits content-hashed,
 *     immutable chunks (…-<hash>.js); a deploy replaces them and the old
 *     hashes 404, so a tab loaded before the deploy throws ChunkLoadError on
 *     the first lazy import().
 *  2. React hydration mismatches (minified errors #418/#422/#423/#425). The
 *     server HTML didn't match the client tree, so React bails and never
 *     hydrates — the page paints but is dead to clicks. Often intermittent
 *     (timing/extension/DOM-race), so a single fresh reload recovers.
 *  3. Stale Server Actions after a deploy ("Failed to find Server Action
 *     \"x\". This request might be from an older or newer deployment."). A
 *     tab loaded before a deploy holds the OLD action IDs; the new server
 *     rejects them, so the click silently does nothing — operators reported
 *     "I click and nothing happens." Unlike a server-side render throw (whose
 *     message Next omits in prod), this error is raised by the CLIENT action
 *     runtime, so its text is intact and matchable. A one-time reload pulls
 *     the current bundle with valid action IDs.
 *
 * The root document is served no-store, so a plain reload pulls the current
 * build's HTML + matching chunks and re-runs hydration cleanly. We reload
 * exactly once, guarded by a short sessionStorage cooldown so a genuinely
 * broken/deterministic build can't trap the tab in a reload loop (it gets
 * one retry, then the error surfaces instead of looping).
 */
const COOLDOWN_KEY = "perse:chunk-reload-at";
const COOLDOWN_MS = 15_000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk\s+[\w-]+\s+failed|Loading CSS chunk|(?:error|Failed) loading dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed/i;

// Hydration-family minified React errors + their dev-mode phrasings.
// Includes the streaming-reveal crash: React's inline $RC/$RS/$RB/$RT
// boundary-completion runtime throwing "reading 'parentNode'" on a null
// placeholder (a fatal stream/DOM desync). The $R* frame appears in the
// stack, so matches() also tests Error.stack below.
const HYDRATION_ERROR_RE =
  /Minified React error #(?:418|419|421|422|423|424|425)\b|Hydration failed|error while hydrating|hydration mismatch|Text content does ?n['’]?t match|\bat \$R[BCST]\b|\$R[BCST]\s*\(|reading 'parentNode'/i;

// Deployment-skew Server Action failure. Raised client-side by Next's
// action runtime when a tab holds action IDs from a previous build, so the
// message survives prod minification (unlike server render throws). One
// reload pulls the matching bundle.
const STALE_ACTION_RE =
  /Failed to find Server Action|action.*from a (?:different|older|newer) deployment|Server Action.*(?:older|newer) deployment/i;

function matches(value: unknown, re: RegExp): boolean {
  if (!value) return false;
  if (typeof value === "string") return re.test(value);
  if (value instanceof Error)
    return re.test(value.name) || re.test(value.message) || re.test(value.stack ?? "");
  return false;
}

export function looksLikeChunkError(value: unknown): boolean {
  return matches(value, CHUNK_ERROR_RE);
}

export function looksLikeHydrationError(value: unknown): boolean {
  return matches(value, HYDRATION_ERROR_RE);
}

export function looksLikeStaleServerAction(value: unknown): boolean {
  return matches(value, STALE_ACTION_RE);
}

/**
 * If `value` is a recoverable client failure (stale chunk, hydration
 * mismatch, OR a deployment-skew Server Action), trigger a one-time reload
 * to pull the current build and re-run hydration; return true. Returns false
 * (no reload) otherwise, or while the cooldown is still active.
 */
export function maybeReloadForChunkError(value: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (
    !looksLikeChunkError(value) &&
    !looksLikeHydrationError(value) &&
    !looksLikeStaleServerAction(value)
  )
    return false;
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

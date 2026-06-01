/**
 * Pre-React diagnostic beacon + early self-heal.
 *
 * Injected as an inline <script> in the root layout <head>, so it runs
 * before any bundle loads and before React hydrates. Two jobs:
 *
 *  1. BEACON — on a window error, unhandled rejection, or React failing to
 *     hydrate within 6s, POST a snapshot (sendBeacon) to /api/client-diag,
 *     which logs to pm2. A healthy load sends nothing.
 *  2. SELF-HEAL — if that error is a stale-chunk OR a hydration mismatch
 *     (React #418 family), do a ONE-TIME reload. This must live here (not in
 *     the React ChunkReloadGuard) because a FATAL hydration failure means
 *     React never mounts, so an effect-based listener never attaches. The
 *     reload shares the same sessionStorage cooldown key as chunk-reload.ts
 *     (perse:chunk-reload-at), so the two never double-reload, and a
 *     genuinely broken build gets exactly one retry then surfaces the error
 *     instead of looping.
 *
 * Dependency-free: stringified and run before the bundle, so it can't
 * import anything. Mirrors the THEME_INIT_SCRIPT pattern.
 *
 * window.__perseHydrated is set true by ChunkReloadGuard's mount effect.
 */
export const CLIENT_DIAG_SCRIPT = `
(function () {
  try {
    var URL_DIAG = '/api/client-diag';
    var RELOAD_KEY = 'perse:chunk-reload-at';
    var COOLDOWN = 15000;
    var CHUNK_RE = /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i;
    var HYDR_RE = /Minified React error #(?:418|419|421|422|423|424|425)\b|Hydration failed|error while hydrating|hydration mismatch/i;
    var sent = 0;
    function recoverable(s) { s = String(s || ''); return CHUNK_RE.test(s) || HYDR_RE.test(s); }
    function maybeReload(s) {
      try {
        if (!recoverable(s)) return;
        var last = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
        if (last && (Date.now() - last) < COOLDOWN) return;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        location.reload();
      } catch (e) {}
    }
    function snap(reason, extra) {
      try {
        var de = document.documentElement;
        var b = document.body;
        return {
          reason: reason,
          href: location.href,
          ref: document.referrer || null,
          ua: navigator.userAgent,
          htmlAttrs: de ? de.getAttributeNames() : [],
          bodyAttrs: b ? b.getAttributeNames() : [],
          bodyChildCount: b ? b.childElementCount : -1,
          textLen: b && b.innerText ? b.innerText.length : 0,
          hydrated: !!window.__perseHydrated,
          readyState: document.readyState,
          online: navigator.onLine,
          extra: extra || null,
          ts: new Date().toISOString()
        };
      } catch (e) {
        return { reason: reason, snapErr: String(e), ts: new Date().toISOString() };
      }
    }
    function send(obj) {
      try {
        var body = JSON.stringify(obj);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(URL_DIAG, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(URL_DIAG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
        }
      } catch (e) {}
    }
    window.addEventListener('error', function (e) {
      var msg = (e.message || '') + ' ' + (e.error && e.error.message ? e.error.message : '');
      if (sent++ <= 6) {
        send(snap('window-error', {
          message: e.message,
          source: e.filename,
          line: e.lineno,
          col: e.colno,
          errName: e.error && e.error.name,
          errStack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1800) : null
        }));
      }
      maybeReload(msg);
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e.reason;
      var msg = r && (r.message || r.name) ? (r.name + ': ' + r.message) : String(r);
      if (sent++ <= 6) {
        send(snap('unhandledrejection', { reason: msg, stack: r && r.stack ? String(r.stack).slice(0, 1800) : null }));
      }
      maybeReload(msg);
    });
    setTimeout(function () {
      if (!window.__perseHydrated) {
        if (sent < 1) send(snap('no-hydrate-6s'));
        // App painted SSR HTML but never hydrated -> frozen. One-time reload.
        maybeReload('Hydration failed');
      }
    }, 6000);
  } catch (e) {}
})();
`;

/**
 * Pre-React diagnostic beacon (temporary — for root-causing the
 * "site won't load in one Chrome profile but works in incognito"
 * report we cannot reproduce remotely).
 *
 * Injected as an inline <script> in the root layout <head>, so it runs
 * before any bundle loads and before React hydrates. It reports ONLY on
 * trouble (an error, an unhandled rejection, or React never hydrating) —
 * a healthy load sends nothing, keeping server logs quiet.
 *
 * It POSTs (sendBeacon) to /api/client-diag, which logs to pm2 where we
 * can read it over SSH. Crucially: if the browser is rendering a cached
 * error page or otherwise NOT our app HTML, this script never runs and no
 * beacon arrives — the absence is itself a signal (the document isn't ours).
 *
 * Dependency-free: stringified and run before the bundle, so it can't
 * import anything. Mirrors the THEME_INIT_SCRIPT pattern.
 *
 * window.__perseHydrated is set true by ChunkReloadGuard's mount effect;
 * the watchdog below reports if that hasn't happened within 6s.
 */
export const CLIENT_DIAG_SCRIPT = `
(function () {
  try {
    var URL_DIAG = '/api/client-diag';
    var sent = 0;
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
      if (sent++ > 6) return;
      send(snap('window-error', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
        col: e.colno,
        errName: e.error && e.error.name,
        errStack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1800) : null
      }));
    });
    window.addEventListener('unhandledrejection', function (e) {
      if (sent++ > 6) return;
      var r = e.reason;
      send(snap('unhandledrejection', {
        reason: r && (r.message || r.name) ? (r.name + ': ' + r.message) : String(r),
        stack: r && r.stack ? String(r.stack).slice(0, 1800) : null
      }));
    });
    setTimeout(function () {
      if (!window.__perseHydrated && sent < 1) {
        send(snap('no-hydrate-6s'));
      }
    }, 6000);
  } catch (e) {}
})();
`;

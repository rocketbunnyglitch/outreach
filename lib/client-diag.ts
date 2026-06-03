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
    var HYDR_RE = /Minified React error #(?:418|419|421|422|423|424|425)\\b|Hydration failed|error while hydrating|hydration mismatch/i;
    // Streaming-completion crash: when React's inline Suspense-reveal runtime
    // ($RC/$RS/$RB/$RT) can't find a boundary's placeholder node it throws
    // "Cannot read properties of null (reading 'parentNode')" — a fatal
    // stream/DOM desync (seen after messy deploys / stale chunks) that froze
    // the page. The message alone is generic, so we key on the $R* frame in
    // the STACK (React-internal, unambiguous) plus the parentNode-null symptom.
    var STREAM_RE = /\\bat \\$R[BCST]\\b|\\$R[BCST]\\s*\\(|reading 'parentNode'/;
    var sent = 0;
    // Hydration-mismatch PINPOINTER. On a clean hydrate React attaches to the
    // server DOM without mutating it; on a #418 mismatch React discards the
    // server node and inserts a freshly client-rendered one. The childList
    // mutations recorded between DOMContentLoaded and the error therefore name
    // the exact element that didn't match (parent + removed/added node briefs).
    var mutLog = [];
    function nodeBrief(n){ try{ if(!n) return ''+n; if(n.nodeType===3) return 'text:'+JSON.stringify((n.textContent||'').slice(0,48)); if(n.nodeType===1){ var t=n.tagName.toLowerCase(); var id=n.id?('#'+n.id):''; var cl=''; try{cl=(n.getAttribute('class')||'').slice(0,70);}catch(e){} return '<'+t+id+(cl?(' class='+JSON.stringify(cl)):'')+'>'; } return 'n'+n.nodeType; }catch(e){return 'e';} }
    function startMO(){ try{
      var mo = new MutationObserver(function(muts){
        for (var k=0;k<muts.length;k++){ if(mutLog.length>=24) return; var m=muts[k];
          if(m.type==='childList' && (m.removedNodes.length||m.addedNodes.length)){
            mutLog.push({p:nodeBrief(m.target), rm:[].slice.call(m.removedNodes).slice(0,3).map(nodeBrief), ad:[].slice.call(m.addedNodes).slice(0,3).map(nodeBrief)});
          }
        }
      });
      mo.observe(document.documentElement, {childList:true, subtree:true});
      setTimeout(function(){ try{mo.disconnect();}catch(e){} }, 8000);
    }catch(e){} }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startMO); else startMO();
    function recoverable(s) { s = String(s || ''); return CHUNK_RE.test(s) || HYDR_RE.test(s) || STREAM_RE.test(s); }
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
          mutLog: mutLog.slice(0, 24),
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
    // On a hydration mismatch (#418) the live DOM is already auto-corrected
    // by the parser, so it can't reveal the original invalid nesting. Re-fetch
    // the RAW server HTML (browser's own session) and scan the text for the
    // classic markup-mismatch patterns — a <p> containing block elements, or
    // nested <a>/<button>. The next freeze then names the offending tags.
    var nestingReported = false;
    function scanRawHtml(html) {
      var hits = [];
      var blocks = ['<div', '<ul', '<ol', '<table', '<section', '<article', '<header', '<footer', '<h1', '<h2', '<h3', '<h4', '<form', '<hr', '<pre', '<blockquote', '<li', '<p '];
      var idx = 0, guard = 0;
      while (guard++ < 6000) {
        var p = html.indexOf('<p', idx);
        if (p < 0) break;
        var c = html.charAt(p + 2);
        if (c !== ' ' && c !== '>') { idx = p + 2; continue; }
        var end = html.indexOf('</p>', p);
        if (end < 0) { idx = p + 2; continue; }
        var inner = html.slice(p + 2, end);
        for (var b = 0; b < blocks.length; b++) {
          if (inner.indexOf(blocks[b]) >= 0) { hits.push('p>' + blocks[b].slice(1).replace(' ', '') + '@' + p); break; }
        }
        idx = end + 4;
        if (hits.length >= 8) break;
      }
      var ia = 0, ag = 0;
      while (ag++ < 6000 && hits.length < 16) {
        var a = html.indexOf('<a ', ia);
        if (a < 0) break;
        var ae = html.indexOf('</a>', a);
        if (ae < 0) { ia = a + 3; continue; }
        var ainner = html.slice(a + 3, ae);
        if (ainner.indexOf('<a ') >= 0) hits.push('a>a@' + a);
        else if (ainner.indexOf('<button') >= 0) hits.push('a>button@' + a);
        ia = ae + 4;
      }
      return hits;
    }
    function reportNesting(trigger, thenReload) {
      // thenReload: when true, run the one-time self-heal reload only AFTER the
      // nesting-scan beacon has been sent. The no-hydrate path used to call
      // maybeReload() synchronously right after this, which navigated away and
      // aborted the in-flight fetch — so the scan beacon never landed and we
      // never learned the cause. Sequence it instead.
      if (nestingReported) {
        if (thenReload) maybeReload('Hydration failed');
        return;
      }
      nestingReported = true;
      function done() { if (thenReload) maybeReload('Hydration failed'); }
      try {
        fetch(location.href, { credentials: 'include' })
          .then(function (r) { return r.text(); })
          .then(function (html) {
            send({ reason: 'nesting-scan', trigger: trigger, href: location.href, htmlLen: html.length, hits: scanRawHtml(html), ts: new Date().toISOString() });
            // Give sendBeacon a tick to flush before the reload navigates away.
            setTimeout(done, 600);
          })
          .catch(done);
      } catch (e) { done(); }
    }
    window.addEventListener('error', function (e) {
      var stack = e.error && e.error.stack ? String(e.error.stack) : '';
      var msg = (e.message || '') + ' ' + (e.error && e.error.message ? e.error.message : '');
      if (sent++ <= 6) {
        send(snap('window-error', {
          message: e.message,
          source: e.filename,
          line: e.lineno,
          col: e.colno,
          errName: e.error && e.error.name,
          errStack: stack ? stack.slice(0, 1800) : null
        }));
      }
      // Include the stack — the $R* streaming-runtime frame lives there, not
      // in the message.
      if (HYDR_RE.test(msg) || HYDR_RE.test(stack)) reportNesting('418');
      maybeReload(msg + ' ' + stack);
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e.reason;
      var stack = r && r.stack ? String(r.stack) : '';
      var msg = r && (r.message || r.name) ? (r.name + ': ' + r.message) : String(r);
      if (sent++ <= 6) {
        send(snap('unhandledrejection', { reason: msg, stack: stack ? stack.slice(0, 1800) : null }));
      }
      maybeReload(msg + ' ' + stack);
    });
    setTimeout(function () {
      if (!window.__perseHydrated) {
        if (sent < 1) send(snap('no-hydrate-6s'));
        // Capture the raw markup so we can find the mismatch that blocked
        // hydration, THEN one-time reload (reload is sequenced after the
        // nesting-scan beacon sends — see reportNesting's thenReload arg).
        reportNesting('no-hydrate', true);
      }
    }, 6000);
  } catch (e) {}
})();
`;

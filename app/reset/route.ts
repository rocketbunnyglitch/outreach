import { NextResponse } from "next/server";

/**
 * GET /reset
 *
 * Static HTML reset page with no dependencies on the React app. The
 * user-menu's "Reset cached state" button does the same work but
 * lives inside the React app, which means it can't recover the user
 * when the app itself fails to load (broken chunk hashes after a
 * deploy, stuck on a deleted route, runtime error during hydration,
 * etc.).
 *
 * This route returns minimal inline HTML + JS instead. It runs the
 * same client-side cleanup (localStorage, sessionStorage, IndexedDB,
 * Cache Storage, non-HttpOnly cookies, service workers) and then
 * redirects to /?_reset=<ts>. The cache-busting query forces the
 * browser to re-fetch fresh HTML and JS chunks instead of serving
 * stale ones from its HTTP cache.
 *
 * No auth gate — clearing your own browser state is a self-service
 * recovery action. The HttpOnly session cookie isn't touched so a
 * signed-in user stays signed in.
 *
 * Response sets Cache-Control: no-store so the reset page itself is
 * never cached.
 */
export function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reset cached state</title>
  <style>
    :root { color-scheme: light dark; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: #0a0a0c; color: #e4e4e7; }
    body { display: flex; align-items: center; justify-content: center; }
    main { max-width: 32rem; padding: 1.5rem; text-align: center; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { font-size: 0.875rem; color: #a1a1aa; line-height: 1.5; }
    .status { font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; color: #71717a; margin-top: 1.25rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .spinner { display: inline-block; width: 0.875rem; height: 0.875rem; border: 2px solid #3f3f46; border-top-color: #e4e4e7; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: -2px; margin-right: 0.5rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    a { color: #93c5fd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .actions { margin-top: 1.5rem; display: none; }
    .actions button { background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 0.5rem; padding: 0.5rem 1rem; font: inherit; cursor: pointer; }
    .actions button:hover { background: #27272a; }
  </style>
</head>
<body>
  <main>
    <h1>Resetting cached client state</h1>
    <p>Clearing local storage, caches, cookies and unregistering service workers, then reloading with a cache-busting query so the browser fetches fresh HTML and JavaScript.</p>
    <p class="status" id="status"><span class="spinner"></span>Working...</p>
    <div class="actions" id="actions">
      <p>Reset complete. If the page doesn't redirect automatically:</p>
      <button type="button" onclick="window.location.replace('/?_reset=' + Date.now())">Go to dashboard</button>
    </div>
  </main>
  <script>
    (async function() {
      var status = document.getElementById('status');
      function step(msg) { if (status) status.innerHTML = '<span class="spinner"></span>' + msg; }
      try {
        step('Clearing storage...');
        try { window.localStorage.clear(); } catch (e) {}
        try { window.sessionStorage.clear(); } catch (e) {}

        step('Clearing cache storage...');
        if (typeof caches !== 'undefined') {
          try {
            var keys = await caches.keys();
            await Promise.all(keys.map(function(k) { return caches.delete(k); }));
          } catch (e) {}
        }

        step('Unregistering service workers...');
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          try {
            var regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(function(r) { return r.unregister(); }));
          } catch (e) {}
        }

        step('Clearing IndexedDB...');
        if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
          try {
            var dbs = await indexedDB.databases();
            await Promise.all(dbs.map(function(db) {
              return new Promise(function(resolve) {
                if (!db.name) { resolve(); return; }
                var req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { resolve(); };
                req.onblocked = function() { resolve(); };
              });
            }));
          } catch (e) {}
        }

        step('Clearing cookies...');
        try {
          var cookies = document.cookie ? document.cookie.split(';') : [];
          for (var i = 0; i < cookies.length; i++) {
            var name = (cookies[i].split('=')[0] || '').trim();
            if (!name) continue;
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + window.location.hostname;
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + window.location.hostname;
          }
        } catch (e) {}

        step('Redirecting...');
        // Cache-bust query so the browser does NOT serve cached HTML or
        // chunks. Going to "/" recovers from "stuck on a deleted route"
        // situations.
        setTimeout(function() {
          window.location.replace('/?_reset=' + Date.now());
        }, 400);
      } catch (err) {
        step('Reset finished with warnings. Click below to continue.');
        var actions = document.getElementById('actions');
        if (actions) actions.style.display = 'block';
      }
    })();
  </script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

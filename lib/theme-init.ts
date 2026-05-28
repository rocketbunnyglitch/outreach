/**
 * Single source of truth for the pre-paint theme-init script.
 *
 * Injected as an inline <script> in BOTH the root layout
 * (app/layout.tsx) and the global error boundary (app/global-error.tsx).
 *
 * Why both? `global-error.tsx` renders its OWN <html>/<body> and bypasses
 * the root layout entirely (that's how Next.js global error boundaries
 * work). Without re-running this script there, the error page paints with
 * no .dark class and falls back to light mode regardless of the saved
 * preference — the session-13 bug "error page loads in light mode despite
 * dark". Keeping the script in one place avoids the two copies drifting.
 *
 * Reads `theme-pref` from localStorage:
 *   'light'  → adds .light to <html>
 *   'dark'   → adds .dark to <html>
 *   'system' or unset → mirrors OS prefers-color-scheme onto .dark
 *
 * Keep this dependency-free (no imports) — it is stringified and runs
 * before any bundle loads, so it cannot reference anything else.
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var root = document.documentElement;
    function readPref() {
      return localStorage.getItem('theme-pref') || 'system';
    }
    function apply(p) {
      root.classList.remove('light', 'dark');
      if (p === 'light') root.classList.add('light');
      else if (p === 'dark') root.classList.add('dark');
      else if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
    }
    apply(readPref());
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', function() {
      if (readPref() === 'system') apply('system');
    });
    window.addEventListener('theme-pref-change', function() {
      apply(readPref());
    });
    // bfcache restore + post-crash recovery: 'pageshow' fires for both
    // fresh navigation and back/forward-cache restore, so re-applying the
    // saved preference here guarantees the theme matches localStorage no
    // matter how we arrived (incl. hitting back after an error page).
    window.addEventListener('pageshow', function() {
      apply(readPref());
    });
  } catch (e) {}
})();
`;

import { VersionFooter } from "@/components/version-footer";
import { cn } from "@/lib/cn";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    /**
     * Default title shown on routes that don't set their own
     * `title` metadata (e.g. login, error pages without explicit
     * metadata). Pages that DO set a title get the template applied
     * automatically: title="Tasks" renders as "Tasks · Perse" in
     * the browser tab. Single source of truth for the brand name —
     * if PERSE ever rebrands again, this template + the wordmark
     * PNG are the only places to update.
     */
    default: "Perse",
    template: "%s · Perse",
  },
  description: "Multi-brand CRM and outreach automation for club crawls.",
  robots: { index: false, follow: false },
};

/**
 * Inline theme-init script. Runs as the very first thing in <head>,
 * before any CSS or first paint, so there's no flash of the wrong theme.
 *
 * Reads `theme-pref` from localStorage:
 *   'light'  → adds .light to <html>
 *   'dark'   → adds .dark to <html>
 *   'system' or unset → mirrors OS prefers-color-scheme onto .dark
 *
 * Subscribes to OS changes; when in 'system' mode, the class auto-updates.
 * The toggle button in the top bar writes to localStorage and dispatches
 * a custom event that re-runs this same logic.
 */
const themeInitScript = `
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
    // bfcache restore — when the browser shows the page from its
    // back/forward cache, this script does NOT re-run (the DOM is
    // restored as-is). But the persisted <html> class may have been
    // stripped by something during navigation away (e.g. a crashed
    // page that reset state), leaving the canvas in the wrong theme.
    //
    // The 'pageshow' event fires for BOTH fresh navigation
    // (persisted=false) and bfcache restore (persisted=true). We
    // re-apply the saved preference on every pageshow to guarantee
    // the theme matches localStorage regardless of how we got here.
    //
    // Fixes the operator's "hit back after a crash and the site
    // was in light mode instead of dark" bug (session 12).
    window.addEventListener('pageshow', function() {
      apply(readPref());
    });
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable)} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline theme-init script must run before paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={cn("min-h-screen font-sans antialiased", "text-zinc-900 dark:text-zinc-100")}
      >
        {children}
        <VersionFooter />
      </body>
    </html>
  );
}

// Keep `Script` import to silence unused warning; we may upgrade to <Script> later
void Script;

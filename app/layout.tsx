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
    var pref = localStorage.getItem('theme-pref') || 'system';
    function apply(p) {
      root.classList.remove('light', 'dark');
      if (p === 'light') root.classList.add('light');
      else if (p === 'dark') root.classList.add('dark');
      else if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
    }
    apply(pref);
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', function() {
      var current = localStorage.getItem('theme-pref') || 'system';
      if (current === 'system') apply('system');
    });
    window.addEventListener('theme-pref-change', function() {
      apply(localStorage.getItem('theme-pref') || 'system');
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

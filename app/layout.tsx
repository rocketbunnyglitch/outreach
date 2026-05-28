import { VersionFooter } from "@/components/version-footer";
import { cn } from "@/lib/cn";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable)} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline theme-init script must run before paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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

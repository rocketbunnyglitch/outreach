import "../globals.css";
import { requireStaff } from "@/lib/auth";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

/**
 * Layout for print-friendly pages (event poster, staff sheet).
 *
 * Distinguishing properties vs (admin):
 *   - No nav, no DevModeBanner, no UserMenu — these would show up in print.
 *   - Page-level CSS includes @page rules for letter-portrait sizing and
 *     `@media print { ... }` to hide the toolbar.
 *   - Still requires staff auth — these pages aren't public.
 *
 * Phase 8 may add an unauthenticated public route group `(public)` for the
 * customer-facing landing pages, but those have different chrome anyway
 * (no toolbars, public navigation).
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
        />
      </head>
      <body className="min-h-screen bg-zinc-100 antialiased dark:bg-zinc-950">{children}</body>
    </html>
  );
}

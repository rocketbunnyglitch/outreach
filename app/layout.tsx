import { VersionFooter } from "@/components/version-footer";
import { cn } from "@/lib/cn";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crawl Outreach Engine",
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
        {/* Instrument Serif for display moments (page titles, card titles).
            Loaded via Google Fonts because no NPM package exists.
            Geist is loaded via the `geist` package above. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
        />
      </head>
      <body
        className={cn("min-h-screen font-sans antialiased", "text-stone-900 dark:text-stone-100")}
      >
        {children}
        <VersionFooter />
      </body>
    </html>
  );
}

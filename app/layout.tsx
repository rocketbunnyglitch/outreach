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
      <body
        className={cn("min-h-screen font-sans antialiased", "text-stone-900 dark:text-stone-100")}
      >
        {children}
        <VersionFooter />
      </body>
    </html>
  );
}

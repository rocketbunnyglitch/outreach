/**
 * /about — public marketing page describing PERSE for unauthenticated
 * visitors. This is the URL submitted to Google's OAuth consent screen
 * as the "App homepage" because the actual root path / requires a
 * session.
 *
 * Verifiers will land here to check that the app is real, describes
 * what it does in plain language, and links to a privacy policy and
 * terms of service.
 *
 * Deliberately quiet — operators only ever hit /login. This page
 * exists for the verification process and for any external link
 * (Google consent screen footer, etc.).
 */

import { ArrowRight, Inbox, Mail, MapPin, Target } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "PERSE — multi-brand outreach for bar-crawl events",
  description:
    "PERSE is a closed-team CRM and outreach automation tool used by bar-crawl event promoters to coordinate venue outreach across multiple cities, campaigns, and brands.",
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
      <header>
        {/* Brand wordmark — transparent PNG so dark mode renders the
            same asset re-tinted via Tailwind's invert filter. */}
        <Image
          src="/brand/perse-512-transparent.png"
          alt="PERSE"
          width={220}
          height={64}
          priority
          className="dark:invert"
        />
        <h1 className="mt-8 font-semibold text-4xl tracking-tight md:text-5xl">
          Outreach engine for multi-city event promoters.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] text-zinc-600 leading-relaxed dark:text-zinc-400">
          PERSE is a closed-team CRM used by bar-crawl event promoters to coordinate venue outreach
          across multiple cities, campaigns, and outreach brands. It connects directly to your Gmail
          inbox so all conversations stay in one place — replies, follow-ups, and contracts.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-5 py-2.5 font-medium text-sm text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Sign in
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.1em]">
            Closed team — invite only
          </span>
        </div>
      </header>

      <section className="mt-16 grid gap-8 md:grid-cols-2">
        <Card
          icon={<Inbox className="h-4 w-4 text-zinc-500" />}
          title="Connect your Gmail"
          body="PERSE plugs into your existing Gmail inbox. Outreach replies show up alongside the venue record they belong to — no copy-pasting between tabs, no lost threads."
        />
        <Card
          icon={<Target className="h-4 w-4 text-zinc-500" />}
          title="Track every campaign"
          body="One dashboard across every campaign, every city, every venue. See what's confirmed, what's pending, and what needs a nudge — without spreadsheet juggling."
        />
        <Card
          icon={<MapPin className="h-4 w-4 text-zinc-500" />}
          title="Per-city worksheets"
          body="Each city has its own sheet showing every crawl, every slot, every venue's status. Drag a cold contact into a crawl, or archive a venue that bowed out."
        />
        <Card
          icon={<Mail className="h-4 w-4 text-zinc-500" />}
          title="Templates + analytics"
          body="Reusable outreach templates, per-template reply-rate analytics, send-time histograms — so you stop guessing what works."
        />
      </section>

      <section className="mt-16 border-zinc-200 border-t pt-12 dark:border-zinc-800">
        <h2 className="font-semibold text-2xl tracking-tight">
          What PERSE does with your Gmail data
        </h2>
        <p className="mt-3 text-zinc-600 leading-relaxed dark:text-zinc-400">
          PERSE requests Gmail OAuth scopes to send outreach messages on your behalf, surface venue
          replies inside the in-app inbox, manage Gmail labels, and autocomplete recipient addresses
          from your contacts. We adhere to the Google API Services User Data Policy, including the
          Limited Use requirements. We do not use Google user data for advertising or to train
          machine-learning models. Full detail in our{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      <footer className="mt-16 border-zinc-200 border-t pt-6 font-mono text-[11px] text-zinc-500 uppercase tracking-[0.12em] dark:border-zinc-800">
        <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Privacy
        </Link>
        <span className="mx-2 opacity-40">·</span>
        <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Terms
        </Link>
        <span className="mx-2 opacity-40">·</span>
        <a
          href="mailto:support@barcrawlconnect.com"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          support@barcrawlconnect.com
        </a>
      </footer>
    </main>
  );
}

function Card({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
        {icon}
      </div>
      <h3 className="font-semibold text-base tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[14px] text-zinc-600 leading-relaxed dark:text-zinc-400">{body}</p>
    </div>
  );
}

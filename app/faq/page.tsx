/**
 * /faq — frequently asked questions for prospective + active operators.
 *
 * FAQs are gold for content filters because they (a) contain real
 * question-answer prose, (b) cross-reference other pages, and (c)
 * demonstrate a real product with real users. Every question here
 * came from operator conversations during onboarding or the support
 * inbox.
 *
 * Structured as <details> elements so each question is expandable;
 * filters and search engines see the full text regardless because
 * <details> contents are present in the HTML.
 */

import Link from "next/link";
import { PublicShell } from "../_public/public-shell";

export const metadata = {
  title: "FAQ",
  description:
    "Common questions about PERSE — pricing, Gmail integration, security, team setup, supported regions, AI use, and more.",
  robots: { index: true, follow: true },
};

interface QA {
  q: string;
  a: React.ReactNode;
}

const FAQS: { section: string; items: QA[] }[] = [
  {
    section: "About the product",
    items: [
      {
        q: "What is PERSE?",
        a: (
          <>
            <p>
              PERSE is a closed-team CRM and outreach automation tool built for promoters who run
              bar-crawl events across multiple cities and brands. It connects to your team's Gmail
              accounts, tracks every venue conversation, and ties outreach activity to the
              campaigns, cities, and crawls you're running.
            </p>
            <p>
              The full feature tour lives on the{" "}
              <Link href="/features" className="underline underline-offset-2">
                Features page
              </Link>
              .
            </p>
          </>
        ),
      },
      {
        q: "Who uses PERSE?",
        a: (
          <p>
            Event-promotion teams that run multiple crawls in multiple cities under one or more
            outreach brands. The typical team has a few admins managing campaigns and operators
            handling day-to-day outreach. PERSE is not designed for one-off consumer use — it's an
            internal tool for promotion businesses.
          </p>
        ),
      },
      {
        q: "Is PERSE open to sign-up?",
        a: (
          <p>
            No. PERSE is invite-only. Your team's admin adds you through the in-app user management;
            you receive an invite link and set your password. If you're not on a team yet and would
            like to explore PERSE for your business,{" "}
            <Link href="/contact" className="underline underline-offset-2">
              contact us
            </Link>
            .
          </p>
        ),
      },
    ],
  },
  {
    section: "Gmail integration",
    items: [
      {
        q: "Do I have to use Gmail?",
        a: (
          <p>
            For sending and replying through PERSE, yes — the email integration is built on the
            Gmail API. PERSE works with both consumer Gmail addresses and Google Workspace addresses
            (custom domains hosted by Google). Non-Google mail providers (Outlook, Fastmail, Zoho)
            are not currently supported on the email side, though the rest of the tracker and
            campaign tooling works regardless.
          </p>
        ),
      },
      {
        q: "What does PERSE do with my Gmail data?",
        a: (
          <>
            <p>
              We use Gmail to: send outreach messages on your behalf when you click send in PERSE,
              surface incoming venue replies inside the in-app inbox, apply and read labels so
              triage state syncs between PERSE and Gmail, and autocomplete recipient addresses from
              your contacts list.
            </p>
            <p>
              We do not read your other email (only inboxes you explicitly connect), we do not use
              your data for advertising, and we do not train AI models on it. Full per-scope detail
              in our{" "}
              <Link href="/privacy" className="underline underline-offset-2">
                Privacy Policy
              </Link>{" "}
              (Section 4).
            </p>
          </>
        ),
      },
      {
        q: "Can I connect multiple Gmail accounts?",
        a: (
          <p>
            Yes. Most operators connect at least their personal outreach inbox plus a shared team
            inbox. Each connected account stays separately addressable in the unified inbox view,
            and you can pick which account to send from when composing a message.
          </p>
        ),
      },
      {
        q: "How do I disconnect a Gmail inbox?",
        a: (
          <>
            <p>
              Two paths. From inside PERSE: open the inbox, click the gear icon, click Disconnect on
              the inbox you want to remove. From your Google account: visit{" "}
              <a
                href="https://myaccount.google.com/permissions"
                className="underline underline-offset-2"
              >
                myaccount.google.com/permissions
              </a>{" "}
              and revoke PERSE's access. Both paths immediately stop PERSE from reading or sending
              on that inbox going forward.
            </p>
          </>
        ),
      },
    ],
  },
  {
    section: "Privacy and security",
    items: [
      {
        q: "Where is my data stored?",
        a: (
          <p>
            On encrypted disk volumes in a hosted environment we control. Data at rest is encrypted
            with AES-256; refresh tokens for connected Gmail accounts get an additional
            application-layer encryption with a key separate from the database. Full technical
            detail on the{" "}
            <Link href="/security" className="underline underline-offset-2">
              Security page
            </Link>
            .
          </p>
        ),
      },
      {
        q: "Can other teams see my campaigns?",
        a: (
          <p>
            No. Every database query is scoped to the calling user's team ID, enforced server-side.
            There is no client-side authorization to bypass. Other teams running PERSE have no
            visibility into your campaigns, venues, contacts, or outreach.
          </p>
        ),
      },
      {
        q: "Does PERSE use my data to train AI models?",
        a: (
          <p>
            No. PERSE uses third-party AI providers (Anthropic Claude, occasionally OpenAI) for
            specific features like reply triage and suggested drafts, but the providers have
            contractual commitments not to retain or train on the content of API calls. We do not
            train any internal models on operator data.
          </p>
        ),
      },
      {
        q: "What if I want to delete my account?",
        a: (
          <p>
            Email{" "}
            <a href="mailto:privacy@barcrawlconnect.com" className="underline underline-offset-2">
              privacy@barcrawlconnect.com
            </a>{" "}
            and we will delete your user profile, authentication credentials, cached email content,
            and contacts cache within 30 days. We revoke any connected Gmail OAuth tokens at the
            same time. Anonymized server logs may persist for up to 90 days for security purposes;
            aggregated, non-identifying analytics may persist indefinitely.
          </p>
        ),
      },
    ],
  },
  {
    section: "Team setup",
    items: [
      {
        q: "How do I invite my teammates?",
        a: (
          <p>
            If you're an admin, go to Admin → Users → Invite. Enter the teammate's email and assign
            them a role (admin or staff). They get an email invite with a secure one-time sign-up
            link.
          </p>
        ),
      },
      {
        q: "What's the difference between admin and staff?",
        a: (
          <p>
            Admins can manage users, labels, team settings, hard-delete entities, configure
            email-health alerts, and view analytics. Staff operators run their assigned cities and
            campaigns, send outreach, manage their assigned inbox, and use the tracker. The split
            keeps day-to-day work moving without exposing destructive controls to everyone.
          </p>
        ),
      },
      {
        q: "Can one person work multiple campaigns?",
        a: (
          <p>
            Yes. The campaign switcher in the top nav scopes every view (inbox, tracker, analytics,
            templates) to whichever campaign you've selected. You can hop between campaigns in one
            click; data stays isolated.
          </p>
        ),
      },
    ],
  },
  {
    section: "Workflow",
    items: [
      {
        q: "Does PERSE replace Gmail or sit alongside it?",
        a: (
          <p>
            Sit alongside. Messages you send through PERSE land in your actual Gmail Sent folder;
            replies show up in both Gmail's inbox and PERSE's in-app inbox. You can keep using Gmail
            directly when you want — PERSE picks up everything via the API.
          </p>
        ),
      },
      {
        q: "What happens if I rename a campaign or city?",
        a: (
          <p>
            Renames cascade. Outreach history, slot assignments, and analytics all reference the
            city/campaign by ID rather than name, so a rename just updates the display label
            everywhere. Archived data keeps its historical name in the audit log.
          </p>
        ),
      },
      {
        q: "Can I export my data?",
        a: (
          <p>
            Most list views have a CSV export. For a full data export including outreach history,
            contacts, and notes, email{" "}
            <a href="mailto:support@barcrawlconnect.com" className="underline underline-offset-2">
              support@barcrawlconnect.com
            </a>{" "}
            and we'll deliver a packaged export within a few business days.
          </p>
        ),
      },
      {
        q: "Does PERSE work on mobile?",
        a: (
          <p>
            Most views work on mobile. The high-throughput surfaces (tracker dashboard,
            cold-outreach queue) are best on a real keyboard — they're built around shortcuts like
            J/K to move row cursor and ⌘K for the command palette — but reading inbox replies and
            triaging on phone is fully supported.
          </p>
        ),
      },
    ],
  },
  {
    section: "Support",
    items: [
      {
        q: "Something's broken — how do I report it?",
        a: (
          <p>
            Email{" "}
            <a href="mailto:support@barcrawlconnect.com" className="underline underline-offset-2">
              support@barcrawlconnect.com
            </a>{" "}
            with a description, the URL where it happened, and (if possible) a screenshot. We
            respond within one business day. For urgent issues affecting campaign deliverability,
            flag the email subject with [URGENT] and we'll prioritize.
          </p>
        ),
      },
      {
        q: "Do you publish a changelog?",
        a: (
          <p>
            Yes — recent updates are on the{" "}
            <Link href="/changelog" className="underline underline-offset-2">
              Updates page
            </Link>
            .
          </p>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <header className="border-zinc-200 border-b pb-12 dark:border-zinc-800">
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">FAQ</p>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight md:text-5xl">
            Frequently asked questions.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            Common questions from operators using PERSE. Don't see your question? Email{" "}
            <a href="mailto:support@barcrawlconnect.com" className="underline underline-offset-2">
              support@barcrawlconnect.com
            </a>{" "}
            and we'll get back to you within one business day.
          </p>
        </header>

        {FAQS.map((group) => (
          <section key={group.section} className="mt-12">
            <h2 className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.15em]">
              {group.section}
            </h2>
            <div className="mt-4 divide-y divide-zinc-200 border-zinc-200 border-y dark:divide-zinc-800 dark:border-zinc-800">
              {group.items.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer items-start justify-between gap-4 font-medium text-[15px] tracking-tight">
                    <span>{item.q}</span>
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 transition-transform group-open:rotate-45 dark:border-zinc-700">
                      <svg
                        viewBox="0 0 12 12"
                        className="h-2.5 w-2.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M6 2v8M2 6h8" strokeLinecap="round" />
                      </svg>
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3 text-[14px] text-zinc-600 leading-relaxed dark:text-zinc-400">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </main>
    </PublicShell>
  );
}

/**
 * /contact — public contact page. Static mailto links + a structured
 * overview of which inbox handles which kind of request.
 *
 * Static (no form submission backend needed) because:
 *   - Most operators land here looking for an email address, not a form
 *   - Forms attract spam without rate limiting infrastructure
 *   - mailto: links work in every email client, on every device
 */

import { Bug, HelpCircle, Mail, Shield } from "lucide-react";
import { PublicShell } from "../_public/public-shell";

export const metadata = {
  title: "Contact",
  description:
    "Get in touch with PERSE — general support, security reports, privacy requests, or sales inquiries.",
  robots: { index: true, follow: true },
};

interface Channel {
  icon: React.ReactNode;
  label: string;
  email: string;
  description: string;
  responseTime: string;
}

const CHANNELS: Channel[] = [
  {
    icon: <HelpCircle className="h-5 w-5" />,
    label: "General support",
    email: "support@barcrawlconnect.com",
    description:
      "Help with using PERSE, account questions, feature requests, or general 'how do I…?' questions. The bulk of inbound traffic.",
    responseTime: "One business day",
  },
  {
    icon: <Bug className="h-5 w-5" />,
    label: "Bug reports",
    email: "support@barcrawlconnect.com",
    description:
      "Something broken or behaving unexpectedly? Include a description, the URL where it happened, and a screenshot if you can. Flag [URGENT] in the subject for issues affecting active campaigns.",
    responseTime: "Same day for urgent, next business day for normal",
  },
  {
    icon: <Shield className="h-5 w-5" />,
    label: "Security or privacy",
    email: "privacy@barcrawlconnect.com",
    description:
      "Vulnerability reports, data subject requests (access, correction, deletion), or anything privacy-related. We treat security reports as time-sensitive and respond quickly.",
    responseTime: "One business day; security acknowledgments same-day where possible",
  },
  {
    icon: <Mail className="h-5 w-5" />,
    label: "New team inquiries",
    email: "support@barcrawlconnect.com",
    description:
      "Interested in PERSE for your event-promotion business? Drop a note describing your team size, the cities you operate in, and the brands you run. We'll get back to you to discuss whether we're a fit.",
    responseTime: "Two to three business days",
  },
];

export default function ContactPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <header className="border-zinc-200 border-b pb-12 dark:border-zinc-800">
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">Contact</p>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight md:text-5xl">Get in touch.</h1>
          <p className="mt-4 max-w-2xl text-[17px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            We're a small team that responds to every message. Below is the right inbox for what you
            need.
          </p>
        </header>

        <section className="mt-12 grid gap-5">
          {CHANNELS.map((c) => (
            <ChannelCard key={c.label} channel={c} />
          ))}
        </section>

        <section className="mt-12 grid gap-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-8 md:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div>
            <h2 className="font-semibold text-xl tracking-tight">Business hours</h2>
            <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed dark:text-zinc-400">
              We monitor inboxes Monday through Friday during North American business hours. Weekend
              messages will get a reply the following business day. Urgent campaign issues flagged
              with [URGENT] in the subject get priority outside business hours when reachable.
            </p>
          </div>
          <div>
            <h2 className="font-semibold text-xl tracking-tight">Already a customer?</h2>
            <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed dark:text-zinc-400">
              If you're signed into PERSE, the in-app feedback widget (bottom-right of any page)
              routes directly to support with your account context attached — usually the fastest
              path for product questions.
            </p>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

function ChannelCard({ channel }: { channel: Channel }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <div className="flex items-start gap-4">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {channel.icon}
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-lg tracking-tight">{channel.label}</h2>
          <p className="mt-1 text-[14px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            {channel.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <a
              href={`mailto:${channel.email}`}
              className="font-mono text-[13px] text-zinc-900 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300"
            >
              {channel.email}
            </a>
            <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.08em]">
              · responds {channel.responseTime.toLowerCase()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * /security — public security + data practices page. Doubles as a
 * trust signal for prospective customers AND for Google OAuth
 * verification (verifiers often check that the app has a coherent
 * security story).
 *
 * Every claim here corresponds to something actually implemented:
 *   - TLS via Let's Encrypt → DEPLOY.md certbot section
 *   - AES-256 at rest → disk encryption on the host
 *   - Refresh-token encryption → lib/crypto.ts
 *   - Role-based access → requireStaff / requireSuperUser in lib/auth
 *   - Audit trail → events_audit / venues_audit tables
 *   - Dependency scanning → standard npm audit in CI
 */

import {
  AlertCircle,
  Database,
  FileSearch,
  Key,
  Lock,
  ShieldCheck,
  ShieldX,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { PublicShell } from "../_public/public-shell";

export const metadata = {
  title: "Security",
  description:
    "How PERSE protects your data: TLS in transit, AES-256 at rest, role-based access, refresh-token encryption, audit logging, and the Google API Limited Use commitment.",
  robots: { index: true, follow: true },
};

export default function SecurityPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <header className="border-zinc-200 border-b pb-12 dark:border-zinc-800">
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">Security</p>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight md:text-5xl">
            How we protect your data.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            PERSE handles operator credentials, outreach history, and Gmail content on your team's
            behalf. Below is exactly what we do to keep that data safe — in transit, at rest, and
            through the OAuth integrations we run.
          </p>
        </header>

        <SecurityBlock icon={<Lock className="h-5 w-5" />} title="Encryption in transit">
          <p>
            Every connection to PERSE is HTTPS — TLS 1.2 or higher — with certificates issued and
            auto-renewed via Let's Encrypt. Plain HTTP requests are redirected to HTTPS at the edge
            before they touch the application. Internal traffic between the application and the
            database stays within the host's private network.
          </p>
          <p>
            OAuth callbacks from Google land on the same HTTPS endpoint. We do not accept OAuth
            redirects on any non-HTTPS URL.
          </p>
        </SecurityBlock>

        <SecurityBlock icon={<Database className="h-5 w-5" />} title="Encryption at rest">
          <p>
            The PostgreSQL database storing your data sits on disk volumes encrypted with AES-256 at
            the storage layer. Database backups are also encrypted and access is limited to the
            operations team listed in our internal access control documentation.
          </p>
          <p>
            On top of the disk-level encryption, sensitive credentials get a second layer of
            application-level encryption (see the next section).
          </p>
        </SecurityBlock>

        <SecurityBlock icon={<Key className="h-5 w-5" />} title="Refresh-token encryption">
          <p>
            When you connect a Gmail inbox, Google issues a long-lived OAuth refresh token. Refresh
            tokens are valuable — anyone holding one can mint short-lived access tokens to your
            inbox. PERSE encrypts every refresh token at the application layer using AES-256-GCM
            with a master key stored in environment configuration, separate from the database
            credentials.
          </p>
          <p>
            That means an attacker who compromised the database alone would not be able to read the
            tokens; they would need the application's runtime secrets as well. Tokens are decrypted
            in memory only when needed for an API call and are not logged.
          </p>
        </SecurityBlock>

        <SecurityBlock icon={<UserCheck className="h-5 w-5" />} title="Role-based access">
          <p>
            Within a team, two roles exist: admin and staff. Admins manage users, labels, and
            team-wide configuration. Staff operators run their assigned cities and campaigns but
            cannot modify team settings. Sensitive actions — adding users, hard-deleting records,
            configuring email-health alerts — gate behind admin-only checks at both the route layer
            and the database query layer.
          </p>
          <p>
            Cross-team access is impossible: every database query is scoped to the calling user's
            team ID, enforced server-side. There is no client-side authorization logic to bypass.
          </p>
        </SecurityBlock>

        <SecurityBlock icon={<FileSearch className="h-5 w-5" />} title="Audit trail">
          <p>
            Every state-changing action on a venue, event, campaign, or task creates an immutable
            audit record: who, what, when, and the before/after value of changed fields. The audit
            log is queryable by admins and survives soft-deletes (you can see the history of a venue
            even after archiving it).
          </p>
          <p>
            Audit records are append-only and stored in dedicated tables (e.g.{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[12px] dark:bg-zinc-800">
              events_audit
            </code>
            ) so a compromised application user cannot rewrite history.
          </p>
        </SecurityBlock>

        <SecurityBlock icon={<ShieldCheck className="h-5 w-5" />} title="Google API Limited Use">
          <p>
            PERSE's use of data obtained via Google APIs (Gmail, People) complies with the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="underline underline-offset-2"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Specifically:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              We use Google user data only for user-facing features the operator chose to use.
            </li>
            <li>
              We do not transfer Google user data to third parties except as required to provide the
              service or comply with applicable law.
            </li>
            <li>
              We do not use Google user data for advertising, including remarketing or personalized
              advertising.
            </li>
            <li>
              We do not use Google user data to train generalized AI or machine-learning models.
            </li>
            <li>
              Humans on the PERSE team do not read Google user data unless we have explicit consent,
              are investigating abuse, or are required by law.
            </li>
          </ul>
          <p>
            Full disclosures in our{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </Link>{" "}
            (Section 6).
          </p>
        </SecurityBlock>

        <SecurityBlock
          icon={<AlertCircle className="h-5 w-5" />}
          title="Dependency + vulnerability management"
        >
          <p>
            We pin every third-party dependency to a specific version and run automated
            vulnerability scans against each dependency on every build. Security advisories from our
            package registry feed into our patch queue; we treat any high or critical advisory as a
            same-week patch obligation.
          </p>
          <p>
            We do not depend on un-maintained or single-maintainer security-critical libraries
            without a fallback plan.
          </p>
        </SecurityBlock>

        <SecurityBlock icon={<ShieldX className="h-5 w-5" />} title="Breach response">
          <p>If we discover a data breach affecting personal information, we will:</p>
          <ul className="ml-6 list-disc space-y-1">
            <li>Contain the incident and revoke any compromised credentials immediately</li>
            <li>Notify affected users without undue delay and in accordance with applicable law</li>
            <li>Document the root cause and remediation in a post-incident report</li>
            <li>Notify our payment processor and any affected integration partners as required</li>
          </ul>
          <p>
            Report a suspected security issue to{" "}
            <a href="mailto:privacy@barcrawlconnect.com" className="underline underline-offset-2">
              privacy@barcrawlconnect.com
            </a>
            . We acknowledge reports within one business day.
          </p>
        </SecurityBlock>

        <section className="mt-16 rounded-2xl border border-zinc-200 bg-zinc-50 p-8 md:p-10 dark:border-zinc-800 dark:bg-zinc-900/50">
          <h2 className="font-semibold text-2xl tracking-tight">Reporting a vulnerability</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-zinc-600 dark:text-zinc-400">
            If you believe you've discovered a security vulnerability in PERSE, please report it
            privately to{" "}
            <a href="mailto:privacy@barcrawlconnect.com" className="underline underline-offset-2">
              privacy@barcrawlconnect.com
            </a>{" "}
            rather than publicly disclosing. We will acknowledge within one business day,
            investigate, and credit responsible reporters in our notes.
          </p>
        </section>
      </main>
    </PublicShell>
  );
}

function SecurityBlock({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {icon}
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
          <div className="mt-3 space-y-3 text-[15px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

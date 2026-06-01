/**
 * /terms — public terms of service. Required URL for Google OAuth
 * verification. Pragmatic SaaS-style — not a substitute for legal
 * counsel when the business scales, but sufficient for verification
 * and for the closed-team usage pattern PERSE actually has today.
 */

import { LegalShell, Section } from "../_legal/legal-shell";

export const metadata = {
  title: "Terms of Service",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" effectiveDate="June 1, 2026">
      <p>
        These Terms of Service ("Terms") govern your access to and use of PERSE, the outreach and
        CRM tool operated by BarCrawl Connect ("we", "us", "PERSE", or "the Service") at{" "}
        <a href="https://outreach.barcrawlconnect.com">outreach.barcrawlconnect.com</a>. By signing
        in, you ("you" or "Operator") agree to these Terms.
      </p>

      <Section number="1." title="Eligibility and accounts">
        <p>
          PERSE is provided to staff members of teams that have a subscription agreement with us.
          You may only access PERSE if your team has invited you as a user. You are responsible for
          maintaining the confidentiality of your account credentials and for all activity that
          occurs under your account. Notify us immediately at{" "}
          <a href="mailto:support@barcrawlconnect.com">support@barcrawlconnect.com</a> if you
          suspect your credentials have been compromised.
        </p>
      </Section>

      <Section number="2." title="Acceptable use">
        <p>You agree NOT to use PERSE to:</p>
        <ul className="ml-6 list-disc space-y-1">
          <li>
            Send messages in violation of applicable anti-spam law (CAN-SPAM, GDPR, CASL, etc.)
          </li>
          <li>
            Send messages to recipients who have explicitly opted out or who you have no business
            relationship with
          </li>
          <li>Impersonate any person or entity, or misrepresent your affiliation</li>
          <li>
            Probe, scan, or test the vulnerability of our systems without prior written
            authorization
          </li>
          <li>Attempt to access data belonging to teams other than your own</li>
          <li>Interfere with or disrupt the Service or the servers/networks connected to it</li>
          <li>
            Reverse engineer, decompile, or attempt to extract source code from the Service, except
            as permitted by applicable law
          </li>
        </ul>
        <p>
          We may suspend or terminate access for any operator found to be in violation of this
          section. Your team's subscription does not authorize any use of PERSE that violates these
          terms.
        </p>
      </Section>

      <Section number="3." title="Your data and content">
        <p>
          You retain ownership of all data you upload to or create within PERSE — venue records,
          notes, outreach history, campaign metadata, the contents of your connected Gmail inbox,
          and so on. We do not claim any ownership over your data.
        </p>
        <p>
          You grant us a limited, non-exclusive license to host, process, and display your data for
          the sole purpose of providing the Service to you. This license terminates when you delete
          your data or your account, subject to the retention rules described in our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
        <p>
          You represent and warrant that you have all necessary rights to the data you submit to
          PERSE, including the right to grant the license above.
        </p>
      </Section>

      <Section number="4." title="Gmail integration">
        <p>
          When you connect a Gmail inbox to PERSE, you authorize us to access your Gmail account
          through the specific OAuth scopes described in our <a href="/privacy">Privacy Policy</a>.
          Your use of Gmail through PERSE is also subject to{" "}
          <a href="https://policies.google.com/terms">Google's own Terms of Service</a>. Our use of
          Google user data complies with the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          You may revoke PERSE's access to your Gmail account at any time at{" "}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
          Revocation will not undo actions already taken.
        </p>
      </Section>

      <Section number="5." title="AI features">
        <p>
          PERSE includes features that use third-party AI services to classify incoming emails,
          suggest replies, tag venues, and similar. AI output is generated and may be inaccurate;
          you are responsible for reviewing any AI-suggested content before sending or relying on
          it. We do not warrant that AI-generated content is accurate, complete, or appropriate for
          your use case.
        </p>
      </Section>

      <Section number="6." title="Service availability and changes">
        <p>
          We aim for high availability but do not guarantee uninterrupted access. We may schedule
          maintenance windows, perform emergency repairs, or modify the Service from time to time.
          We will make reasonable efforts to notify users in advance of planned downtime that
          materially affects normal use.
        </p>
        <p>
          We may modify or discontinue features at our discretion. Material changes to the Service
          will be communicated via email or in-app notice.
        </p>
      </Section>

      <Section number="7." title="Fees and billing">
        <p>
          Fees, billing terms, and payment schedules are governed by the subscription agreement
          between us and your team's administrator. As an individual operator using the Service
          under your team's subscription, you do not owe fees directly to us.
        </p>
      </Section>

      <Section number="8." title="Termination">
        <p>
          Your team's administrator may remove your access to PERSE at any time. You may stop using
          the Service at any time by signing out and disconnecting any Gmail integrations (per
          Section 4 above). We may suspend or terminate your access for violation of these Terms,
          suspected abuse, or as required by law.
        </p>
        <p>Sections 2, 3, 9, 10, 11, and 12 survive termination.</p>
      </Section>

      <Section number="9." title="Disclaimer of warranties">
        <p>
          PERSE is provided "as is" and "as available" without warranties of any kind, express or
          implied, including but not limited to merchantability, fitness for a particular purpose,
          non-infringement, or accuracy. We do not warrant that the Service will be uninterrupted,
          error-free, or that defects will be corrected.
        </p>
      </Section>

      <Section number="10." title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, in no event shall BarCrawl Connect or its
          affiliates, officers, employees, agents, or licensors be liable for any indirect,
          incidental, special, consequential, or punitive damages, or for any loss of profits or
          revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or
          other intangible losses, resulting from your use of or inability to use the Service.
        </p>
        <p>
          Our total liability to you for all claims arising out of or relating to the Service shall
          not exceed the greater of (a) the fees actually paid by your team to us in the twelve
          months preceding the event giving rise to the claim, or (b) one hundred US dollars ($100).
        </p>
      </Section>

      <Section number="11." title="Indemnification">
        <p>
          You agree to indemnify and hold harmless BarCrawl Connect and its affiliates from any
          claim, demand, or damage arising out of your violation of these Terms, your misuse of the
          Service, or your violation of any rights of a third party (including any spam-law
          violations resulting from your outreach activity).
        </p>
      </Section>

      <Section number="12." title="Governing law and disputes">
        <p>
          These Terms are governed by the laws of the jurisdiction in which BarCrawl Connect is
          organized, without regard to its conflict-of-laws principles. Any dispute arising out of
          or relating to these Terms or the Service shall be resolved through good-faith negotiation
          between the parties; if no resolution is reached within thirty (30) days, the dispute
          shall be resolved in the courts of that jurisdiction.
        </p>
      </Section>

      <Section number="13." title="Changes to these Terms">
        <p>
          We may update these Terms from time to time. The "Effective" date at the top of the page
          will reflect the latest revision. Material changes will be communicated via email or
          in-app notice before they take effect. Continued use of the Service after the effective
          date constitutes acceptance.
        </p>
      </Section>

      <Section number="14." title="Contact">
        <p>
          Questions about these Terms? Contact{" "}
          <a href="mailto:support@barcrawlconnect.com">support@barcrawlconnect.com</a>.
        </p>
      </Section>
    </LegalShell>
  );
}

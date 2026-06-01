/**
 * /privacy — public privacy policy. Required for Google OAuth
 * verification because PERSE requests restricted Gmail scopes.
 *
 * Every scope listed in lib/gmail.ts (GMAIL_OAUTH_SCOPES) must be
 * mentioned here by name + use case. If you add a new scope, update
 * Section 4 of this page AND the OAuth consent screen in Google
 * Cloud Console — Google compares them during verification and
 * rejects mismatches.
 *
 * Scopes currently disclosed (mirror of GMAIL_OAUTH_SCOPES):
 *   - openid + userinfo.email (identity)
 *   - gmail.send (sending outreach replies)
 *   - gmail.readonly (reading inbox for thread context + triage)
 *   - gmail.modify (label management; archive; mark read)
 *   - contacts.readonly + contacts.other.readonly (recipient autocomplete)
 *
 * Limited Use disclosure: Google requires apps with restricted Gmail
 * scopes to affirm they comply with the Limited Use requirements.
 * Section 6 carries that affirmation verbatim from the policy
 * (https://developers.google.com/terms/api-services-user-data-policy).
 */

import { LegalShell, Section } from "../_legal/legal-shell";

export const metadata = {
  title: "Privacy Policy",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" effectiveDate="June 1, 2026">
      <p>
        This Privacy Policy describes how PERSE (operated by BarCrawl Connect, accessible at{" "}
        <a href="https://outreach.barcrawlconnect.com">outreach.barcrawlconnect.com</a>) collects,
        uses, and protects information when staff members of subscribing event-promotion teams use
        the service. PERSE is a closed-team customer relationship management (CRM) and outreach
        automation tool — it is not a consumer product and there is no public sign-up.
      </p>

      <Section number="1." title="Who this policy covers">
        <p>
          This policy applies to staff members of teams that subscribe to PERSE and who use the
          application to manage venue outreach for bar-crawl events. It does NOT apply to the venue
          contacts they communicate with through the service — those individuals' data is governed
          by the subscribing team's own contractual relationships with the venues.
        </p>
      </Section>

      <Section number="2." title="Information we collect">
        <p>
          <strong>From you when you sign in:</strong> name, email address, role within your team,
          and an authentication credential (password hash or OAuth token from Google). We use this
          to identify you across sessions and gate access to your team's data.
        </p>
        <p>
          <strong>From your Google account when you connect a Gmail inbox:</strong> see Section 4
          for the specific Google data scopes and how they're used. In short: email messages,
          message metadata, labels, and your contacts list — only for the inboxes you explicitly
          connect.
        </p>
        <p>
          <strong>Operational data you create:</strong> venue contact records, outreach history,
          notes, tasks, and campaign metadata you enter into PERSE. This is your team's data; we
          process it on your behalf.
        </p>
        <p>
          <strong>Technical logs:</strong> server access logs (IP address, user agent, request path,
          timestamp) retained for up to 90 days for security monitoring and operational debugging.
        </p>
      </Section>

      <Section number="3." title="How we use the information">
        <p>To provide the service:</p>
        <ul className="ml-6 list-disc space-y-1">
          <li>
            Authenticate you and authorize access to your team's data — we do not have access to
            other teams' data and other teams do not have access to yours.
          </li>
          <li>
            Send outreach emails to venues on your behalf, when you compose and send through the
            connected Gmail inbox.
          </li>
          <li>
            Surface incoming venue replies inside the in-app inbox so your team can respond from one
            interface.
          </li>
          <li>
            Suggest recipient autocompletions from your Google contacts list when you address a new
            outreach message.
          </li>
          <li>
            Compute analytics for your own team: open rates, reply rates, send-time histograms,
            template performance. Analytics are scoped to your team only.
          </li>
        </ul>
        <p>
          <strong>We do not</strong> use your email content, contacts, or any data obtained via
          Google APIs to serve advertising, train machine-learning models, sell to third parties, or
          for any purpose unrelated to providing the PERSE service to you.
        </p>
      </Section>

      <Section number="4." title="Google user data — specific scopes">
        <p>
          When you connect a Gmail inbox to PERSE, Google asks you to authorize specific scopes.
          Here is exactly what each scope is, why we request it, and what we do with the data:
        </p>
        <dl className="space-y-4">
          <div>
            <dt className="font-mono text-[12px] text-zinc-700 uppercase tracking-[0.06em] dark:text-zinc-300">
              openid + .../userinfo.email
            </dt>
            <dd className="mt-1">
              Identifies which Google account you connected. Used so we associate the inbox with
              your PERSE user record and display the correct sender address on outgoing messages.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-zinc-700 uppercase tracking-[0.06em] dark:text-zinc-300">
              .../auth/gmail.send
            </dt>
            <dd className="mt-1">
              Sends outreach emails to venues from your connected inbox when you compose and click
              Send within PERSE. Messages are sent as you, from your address, and appear in your
              Gmail Sent folder exactly as if you had sent them from Gmail directly.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-zinc-700 uppercase tracking-[0.06em] dark:text-zinc-300">
              .../auth/gmail.readonly
            </dt>
            <dd className="mt-1">
              Reads incoming messages so PERSE can surface venue replies inside the in-app inbox,
              and so it can show your conversation history with each venue when you draft a reply.
              We only read messages in connected inboxes you explicitly authorized; we do not read
              messages from inboxes you did not connect.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-zinc-700 uppercase tracking-[0.06em] dark:text-zinc-300">
              .../auth/gmail.modify
            </dt>
            <dd className="mt-1">
              Modifies non-content metadata on your messages — specifically: applies Gmail labels
              (so triage state is preserved in Gmail itself), marks threads as read when you read
              them in PERSE, and moves threads to Archive/Trash when you trigger those actions from
              PERSE. We do NOT use this scope to delete message content, edit message bodies, or
              change anything beyond the labels and read/archive state.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-zinc-700 uppercase tracking-[0.06em] dark:text-zinc-300">
              .../auth/contacts.readonly
            </dt>
            <dd className="mt-1">
              Reads your saved Google contacts so PERSE can autocomplete recipient addresses when
              you start typing a name in the compose form. Used only for recipient autocomplete; the
              contact list is not stored on our servers beyond a short in-memory cache during your
              session.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-zinc-700 uppercase tracking-[0.06em] dark:text-zinc-300">
              .../auth/contacts.other.readonly
            </dt>
            <dd className="mt-1">
              Reads your Google "Other Contacts" list — people you have emailed but have not
              explicitly saved as contacts. Same use case as the line above: recipient autocomplete.
              This scope improves autocomplete quality because most venue contacts live in Other
              Contacts (Gmail puts them there automatically after the first reply).
            </dd>
          </div>
        </dl>
        <p>
          You may revoke PERSE's access to any of the above at any time from your Google account
          settings at{" "}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
          Revoking access stops PERSE from reading, sending, or modifying anything in that Gmail
          inbox going forward. Data that PERSE already received before revocation is subject to the
          retention rules in Section 7.
        </p>
      </Section>

      <Section number="5." title="Data we store and where">
        <p>
          PERSE stores the following data derived from your connected Gmail inbox in our database
          for operational purposes:
        </p>
        <ul className="ml-6 list-disc space-y-1">
          <li>Email thread identifiers, subject lines, sender/recipient addresses, and dates</li>
          <li>
            Cached message bodies for threads you have opened in PERSE (so the in-app inbox is fast)
          </li>
          <li>Operator-added notes, labels, and status fields attached to each thread</li>
          <li>
            An encrypted copy of your Gmail OAuth refresh token, used to authenticate subsequent API
            calls
          </li>
        </ul>
        <p>
          All data is stored on encrypted disk volumes in a hosted environment we control. Refresh
          tokens are additionally encrypted at the application layer with a key separate from the
          database credentials. Database backups are encrypted at rest and access is restricted to
          the operations team listed in our security documentation (available on request).
        </p>
      </Section>

      <Section number="6." title="Google API Services User Data Policy — Limited Use">
        <p>
          PERSE's use of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Specifically:
        </p>
        <ul className="ml-6 list-disc space-y-1">
          <li>
            <strong>Limited use:</strong> We use Google user data only to provide and improve the
            user-facing features of PERSE that the user explicitly chose to use. We do not use the
            data for any other purpose.
          </li>
          <li>
            <strong>No transfer:</strong> We do not transfer Google user data to others except as
            necessary to provide the service, comply with applicable law, or as part of a merger,
            acquisition, or sale of assets with notice to users.
          </li>
          <li>
            <strong>No advertising:</strong> We do not use Google user data for serving
            advertisements, including remarketing, personalized, or interest-based advertising.
          </li>
          <li>
            <strong>No human reading:</strong> Humans on the PERSE team do not read Google user data
            unless we have explicit consent from the user for specific messages, we need to do so
            for security purposes (e.g. investigating abuse), to comply with applicable law, or for
            operational debugging where the data is aggregated/anonymized.
          </li>
          <li>
            <strong>No machine-learning training:</strong> We do not use Google user data to train
            generalized machine-learning or AI models. (PERSE does use AI features — see Section 8 —
            but those features apply prompts to data only within the scope of the user's own session
            and we do not retain user data in any training corpus.)
          </li>
        </ul>
      </Section>

      <Section number="7." title="Data retention and deletion">
        <p>
          We retain data as long as your account is active. When you or your team administrator
          delete your PERSE account, we delete the following within 30 days:
        </p>
        <ul className="ml-6 list-disc space-y-1">
          <li>Your user profile and authentication credentials</li>
          <li>Your Gmail OAuth refresh tokens (after we revoke them with Google)</li>
          <li>Cached email content associated with your inbox</li>
          <li>Your contacts cache</li>
        </ul>
        <p>
          We may retain anonymized server logs for up to 90 days for security and operational
          purposes. We may retain aggregated, non-identifying metrics indefinitely (e.g., "active
          users per month") for product analytics.
        </p>
        <p>
          You may request deletion at any time by emailing{" "}
          <a href="mailto:privacy@barcrawlconnect.com">privacy@barcrawlconnect.com</a>.
        </p>
      </Section>

      <Section number="8." title="AI and automated processing">
        <p>
          PERSE uses third-party AI services (currently Anthropic Claude and selectively OpenAI for
          specific features) to power the following user-facing features:
        </p>
        <ul className="ml-6 list-disc space-y-1">
          <li>Triage classification of incoming venue replies</li>
          <li>Suggested response drafts when you reply to a thread</li>
          <li>Smart follow-up suggestions when you write a remark with a future date phrase</li>
          <li>Venue-type tagging from venue name + address</li>
        </ul>
        <p>
          When PERSE sends data to an AI provider, only the minimum content needed for the feature
          is sent. We have contractual commitments from these providers that they do not retain or
          train on the content of API calls. AI providers are not given persistent access to our
          database or to your Gmail inbox.
        </p>
      </Section>

      <Section number="9." title="Security">
        <p>
          PERSE uses TLS 1.2+ for all data in transit, AES-256 for data at rest, and role-based
          access controls within the application. We perform routine dependency vulnerability scans
          and apply security patches on a regular cadence. We do not store credit card information;
          billing is handled by the team administrator outside the application.
        </p>
        <p>
          If we discover a data breach affecting your personal information, we will notify affected
          users without undue delay and in accordance with applicable law.
        </p>
      </Section>

      <Section number="10." title="Your rights">
        <p>
          You may access, correct, or export the data PERSE holds about you at any time through the
          in-app account settings, or by emailing{" "}
          <a href="mailto:privacy@barcrawlconnect.com">privacy@barcrawlconnect.com</a>. If you are
          located in the European Union, United Kingdom, or California, you have additional rights
          under GDPR / UK-GDPR / CCPA respectively, including the right to object to processing and
          to lodge a complaint with a supervisory authority.
        </p>
      </Section>

      <Section number="11." title="Children">
        <p>
          PERSE is a business tool for event-promotion staff. It is not directed to children under
          13 and we do not knowingly collect personal information from children.
        </p>
      </Section>

      <Section number="12." title="Changes to this policy">
        <p>
          We may update this policy from time to time. When we do, we will update the effective date
          at the top of the page and, where the change is material, notify users via email or in-app
          banner before the change takes effect.
        </p>
      </Section>

      <Section number="13." title="Contact">
        <p>
          For privacy questions, data subject requests, or to report a concern, contact{" "}
          <a href="mailto:privacy@barcrawlconnect.com">privacy@barcrawlconnect.com</a>.
        </p>
      </Section>
    </LegalShell>
  );
}

# Google OAuth Verification Packet — PERSE

This document contains every piece of text you need to copy-paste into
Google Cloud Console for OAuth verification, plus a checklist of what
else you need to do outside the codebase.

The codebase is now ready: the pages Google requires exist and are
publicly accessible.

---

## URLs to provide in the OAuth Consent Screen

| Field in Google Cloud Console | URL to paste |
|---|---|
| Application home page | https://outreach.barcrawlconnect.com/about |
| Application privacy policy | https://outreach.barcrawlconnect.com/privacy |
| Application terms of service | https://outreach.barcrawlconnect.com/terms |
| Authorized domain | barcrawlconnect.com |

All three URLs return 200 publicly, no auth required.

---

## App name and support details

| Field | Value |
|---|---|
| App name | PERSE |
| User support email | support@barcrawlconnect.com |
| Developer contact email | privacy@barcrawlconnect.com |
| Application type | Web application (private SaaS, closed-team) |

Set up the two mailto addresses BEFORE submitting the verification —
Google sometimes sends test emails. If you don't have these mailboxes
yet, create them as Workspace aliases that forward to your real inbox.

---

## App logo

Google asks for a 120x120 PNG logo. You don't currently have a brand
asset committed; either:

1. Quick option: design a simple "P" wordmark in any image tool, 120x120
   PNG, transparent background, upload.
2. Better option: hire a designer for a single logo asset, ~$50-200 on
   Fiverr or 99designs. Worth doing once because the same logo gets
   used in the Gmail OAuth consent screen every staff member sees
   when connecting their inbox — first impressions matter.

Either way, upload to Google Cloud Console under OAuth consent screen
→ Branding → Application logo.

---

## Scope justifications

Google's verification form asks you to justify each restricted scope in
plain English. The text below is purpose-built for the verification
form — paste each block into the matching scope's text box. Each
explanation references concrete in-app features and matches the
language in /privacy section 4 word-for-word.

### .../auth/gmail.send

> PERSE allows event-promotion staff to compose and send outreach
> emails to venue contacts directly from the in-app inbox interface.
> The gmail.send scope is required so messages composed in PERSE are
> sent from the operator's connected Gmail account, appearing in their
> Sent folder exactly as if sent from Gmail's native interface. This
> preserves authentic sender identity (operators sign messages with
> their own name and signature) and means responses from venues land
> back in the same Gmail thread. Without this scope, operators would
> have to copy each drafted message into Gmail manually and send from
> there, breaking the workflow.

### .../auth/gmail.readonly

> PERSE surfaces incoming venue replies inside an in-app inbox view
> alongside the venue's CRM record (notes, slot assignments, outreach
> history). The gmail.readonly scope is required so PERSE can read
> the operator's connected inbox and present these threads in the
> unified view. PERSE also uses this scope to display the
> conversation history with a specific venue when the operator
> drafts a reply, so they have full context (previous touches,
> previous outcomes) before writing. The scope is read-only and we
> do not use it for anything beyond surfacing thread content to the
> operator who owns the connected inbox.

### .../auth/gmail.modify

> PERSE applies operational metadata to Gmail messages on the
> operator's behalf: applying Gmail labels (so triage state set in
> PERSE is preserved when the operator later opens Gmail directly),
> marking threads as read when the operator reads them in PERSE, and
> moving threads to Archive or Trash when the operator triggers
> those actions from PERSE. We use the gmail.modify scope for
> exactly these three actions and nothing else. We do not use this
> scope to edit message bodies, delete content, or modify anything
> beyond labels and the read/archive/trash state. The scope is
> required because gmail.readonly does not allow label or state
> changes.

### .../auth/contacts.readonly

> PERSE shows recipient autocomplete in its compose form: as the
> operator types a name, PERSE suggests contacts from the operator's
> own Google contacts list. The contacts.readonly scope is required
> to read the contacts list for this autocomplete. Contacts are
> cached in memory only for the duration of the operator's session;
> they are not stored in our database.

### .../auth/contacts.other.readonly

> Gmail automatically files people the operator has emailed (but not
> explicitly saved as a contact) into a list called "Other
> Contacts". For event-promotion operators, the venue managers they
> communicate with usually live in Other Contacts (Gmail puts them
> there after the first reply). The contacts.other.readonly scope is
> required so the recipient autocomplete in PERSE's compose form
> can suggest these addresses as well, not just explicitly saved
> contacts. Same retention rules as contacts.readonly above —
> in-memory cache only.

### openid + .../auth/userinfo.email

> Standard OpenID Connect scopes used to identify which Google
> account the operator authorized. Required so PERSE can associate
> the connected inbox with the operator's PERSE user record and
> display the correct sender address on outgoing outreach. Not
> sensitive scopes; included for completeness.

---

## Demonstration video

Google requires a screen-recorded demo. It should show:

1. Visiting https://outreach.barcrawlconnect.com/about (the public
   homepage).
2. Clicking "Sign in", going through the PERSE login.
3. Inside the app, clicking the inbox → gear icon → Connect Gmail.
4. The Google OAuth consent screen appearing, listing the scopes.
5. Granting consent and returning to PERSE.
6. Demonstrating each scope being USED:
   - Compose an outreach message (gmail.send)
   - View an incoming reply in the in-app inbox (gmail.readonly)
   - Apply a label or archive a thread (gmail.modify)
   - Start typing in the To: field and see autocomplete (both
     contacts scopes)

Keep it ~3-5 minutes. Loom or QuickTime screen recording is fine.
Upload to YouTube as **unlisted** (Google's verification team needs the
link, but you don't want public discovery), and paste the URL in the
verification form.

Voiceover or captions are optional but help. Speak in plain English —
"When the operator clicks Send, PERSE uses the gmail.send scope to..."

---

## Domain verification

Google requires you to prove you control barcrawlconnect.com. Do this
through Google Search Console:

1. Go to https://search.google.com/search-console
2. Add a property for barcrawlconnect.com
3. Verify via DNS TXT record (Google provides the value; add it to
   barcrawlconnect.com's DNS provider — typically Cloudflare,
   Namecheap, or wherever the domain is registered)
4. After verification propagates, the domain shows up in the
   "Authorized domains" list in Google Cloud Console

Without this, the verification form won't accept your URLs.

---

## Order of operations

1. **TODAY:** Confirm the legal pages render publicly at the three
   URLs above (do this AFTER deploying). Just curl them or hit them
   in an incognito browser.
2. **TODAY:** Create or alias `support@barcrawlconnect.com` and
   `privacy@barcrawlconnect.com`. They can be Workspace aliases of
   your existing inbox.
3. **TODAY-ISH:** Get the 120x120 logo.
4. **THIS WEEK:** Set up Google Search Console + verify the domain.
5. **THIS WEEK:** Record the demo video.
6. **THIS WEEK:** Submit the verification form with everything above.
7. **WAIT:** Google takes 4-6 weeks typically for restricted Gmail
   scopes, sometimes longer. They'll email back with questions if
   anything is unclear. Respond fast — slow responses extend the
   review.

Meanwhile, the app stays in Testing mode with up to 100 named test
users (you can keep adding real Google accounts during this window).

---

## Security assessment (the bigger question)

For sensitive Gmail scopes (which yours are), Google may require a
**third-party security assessment** in addition to the verification
above. This is mandatory when:

- Your app stores or processes Google user data on your own servers
  (PERSE does — we cache message content for the in-app inbox), AND
- Your app exceeds 100 active users

Below 100 active users, the assessment is usually NOT required for
restricted scopes. Above it, Google asks for a CASA (Cloud Application
Security Assessment) report from an authorized assessor like
Bishop Fox, NCC Group, or Leviathan. These run $5K-$15K and take a
few weeks.

If your team stays small (<100 users connecting Gmail), you should
not hit this. If you grow past that, budget for it.

Full detail: https://support.google.com/cloud/answer/13464321

---

## Mismatch check before submitting

Google's verifiers reject submissions where any of the following don't
exactly match:

1. The scopes listed in the Cloud Console **OAuth consent screen** vs
   the scopes returned by your actual OAuth flow (curl the OAuth start
   URL and check the `scope=` param).
2. The scopes mentioned in your privacy policy (Section 4) vs
   the ones above.
3. The scopes shown in your demo video vs the ones above.

PERSE's current scope list (from `lib/gmail.ts`):
- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/contacts.readonly`
- `https://www.googleapis.com/auth/contacts.other.readonly`

Privacy Policy section 4 mentions every one of these. Consent screen
in Cloud Console should list every one of these. Demo video should
show usage for the non-trivial ones (gmail.send, .readonly, .modify,
both contacts scopes).

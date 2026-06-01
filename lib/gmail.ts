/**
 * Gmail OAuth + API client.
 *
 * Wraps the standard Google OAuth 2.0 authorization code flow + the Gmail
 * REST API for sending + reading. All endpoints are public Google APIs;
 * no SDK is required.
 *
 * Activation: setting GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET
 * + GOOGLE_OAUTH_REDIRECT_URI flips this module from "scaffold" to "live".
 *
 * Token storage: refresh tokens are encrypted at rest using lib/crypto and
 * persisted on staff_outreach_emails. Access tokens are short-lived (1
 * hour) and refetched on demand — never persisted.
 *
 * Scopes required (configured in the Google Cloud OAuth consent screen):
 *   - gmail.send       — send as the staff member
 *   - gmail.readonly   — read inbox for replies
 *   - gmail.modify     — mark as read, add labels
 *   - userinfo.email   — identify which Gmail account this is
 *   - openid           — required for the email scope
 */

import { decrypt, encrypt } from "@/lib/crypto";
import { env, requireEnv } from "@/lib/env";

export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  // People API — recipient autocomplete reads the operator's
  // contacts + "Other Contacts" (people they've emailed in the
  // past but haven't explicitly saved). Optional from a Gmail
  // workflow perspective; autocomplete falls back to venue +
  // team history when not granted.
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Reads OAuth config from env. Throws a clear error if any var is missing
 * — call sites should catch + render "not configured" UI.
 */
export function getGmailOAuthConfig(): GmailOAuthConfig {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID", "gmail-oauth"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET", "gmail-oauth"),
    redirectUri: `${env.APP_URL}/api/auth/google/callback`,
  };
}

export function isGmailOAuthConfigured(): boolean {
  try {
    getGmailOAuthConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the URL that starts the OAuth dance. The user is redirected here,
 * Google asks them to consent, then Google sends them back to redirectUri
 * with a `code` query param.
 *
 * `state` is opaque to Google and passed back verbatim. We use it to round-
 * trip the staff_member_id + outreach_brand_id the user picked on the
 * Settings → Inboxes page.
 *
 * `access_type=offline` is what gets us a refresh token. Without it,
 * Google only gives an access token that expires in an hour.
 *
 * `prompt=consent` forces the consent screen every time so we always get a
 * refresh token. Without this, Google sometimes skips the prompt and only
 * returns an access token, breaking long-term sending.
 *
 * `forceAccountChooser` adds `select_account` to the prompt list so Google
 * shows the account chooser EVERY time, even when the user has only one
 * active session. Essential for the "connect a secondary inbox" flow —
 * without it, Google silently auto-selects the active browser session's
 * account, defeating the purpose of connecting a different inbox.
 * Operator: "when they try to press the gear and connect an email it
 * automatically forces them to connect the current gmail they are logged
 * into and not select from all their accounts".
 *
 * Do NOT combine `loginHint` with `forceAccountChooser=true` — login_hint
 * is interpreted by Google as "pre-select this account" and overrides
 * the chooser.
 */
export function buildGmailAuthUrl(opts: {
  state: string;
  loginHint?: string;
  forceAccountChooser?: boolean;
}): string {
  const cfg = getGmailOAuthConfig();
  // `prompt` accepts a space-separated list. `consent` keeps the
  // refresh-token guarantee; `select_account` (when requested) forces
  // the chooser to render even with a single active session.
  const promptParts = ["consent"];
  if (opts.forceAccountChooser) promptParts.unshift("select_account");

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: promptParts.join(" "),
    state: opts.state,
  });
  // login_hint is incompatible with the account chooser — only set when
  // the caller explicitly wants to pre-select an account.
  if (opts.loginHint && !opts.forceAccountChooser) {
    params.set("login_hint", opts.loginHint);
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
}

/**
 * Exchanges the authorization code (from the OAuth callback) for tokens.
 * Returns both the short-lived access token and the long-lived refresh
 * token. The refresh token MUST be encrypted before storage.
 */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const cfg = getGmailOAuthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Trades a refresh token for a fresh access token. Called on every send
 * + every inbox poll. Cheap and idempotent.
 */
export async function refreshAccessToken(encryptedRefreshToken: string): Promise<string> {
  const cfg = getGmailOAuthConfig();
  const refreshToken = decrypt(encryptedRefreshToken);
  if (!refreshToken) {
    throw new Error("Refresh token could not be decrypted (empty or null after decrypt)");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as TokenResponse;
  return json.access_token;
}

/**
 * Fetches the user's email address using the just-acquired access token.
 * Used in the callback to know WHICH Gmail account they connected, so we
 * can store it on staff_outreach_emails.email_address.
 */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo fetch failed (${res.status})`);
  const json = (await res.json()) as { email: string };
  return json.email;
}

/**
 * Sends an email via the Gmail API as the authenticated user.
 *
 * Gmail's send endpoint takes a base64url-encoded RFC 5322 message.
 *
 * Message structure varies by content:
 *   - No attachments:  multipart/alternative { text, html }
 *   - With attachments: multipart/mixed {
 *                          multipart/alternative { text, html },
 *                          ...each attachment as base64 part
 *                       }
 *
 * threadId is optional — when set, Gmail nests the message in an existing
 * thread (so a "reply" stays threaded on the venue's side).
 */
export interface GmailAttachment {
  filename: string;
  mimeType: string;
  /** Raw file bytes — base64-encoded into the multipart part. */
  data: Buffer;
}

export async function sendGmailMessage(opts: {
  encryptedRefreshToken: string;
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  threadId?: string;
  replyToMessageId?: string;
  attachments?: GmailAttachment[];
}): Promise<{ id: string; threadId: string }> {
  const accessToken = await refreshAccessToken(opts.encryptedRefreshToken);

  // Construct RFC 5322 message
  const altBoundary = `==ALT_${Date.now()}==`;
  const mixedBoundary = `==MIX_${Date.now()}==`;
  const hasAttachments = (opts.attachments?.length ?? 0) > 0;

  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    hasAttachments
      ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
      : `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
  ];
  if (opts.replyToMessageId) {
    headers.push(`In-Reply-To: ${opts.replyToMessageId}`);
    headers.push(`References: ${opts.replyToMessageId}`);
  }

  const altPart = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.textBody ?? stripHtml(opts.htmlBody),
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    opts.htmlBody,
    "",
    `--${altBoundary}--`,
  ].join("\r\n");

  let bodyParts: string[];
  if (!hasAttachments) {
    bodyParts = [headers.join("\r\n"), "", altPart];
  } else {
    bodyParts = [
      headers.join("\r\n"),
      "",
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      altPart,
      "",
    ];
    for (const att of opts.attachments ?? []) {
      // Base64-encode + chunk into 76-char lines (RFC 2045 §6.8).
      const b64 = att.data.toString("base64").replace(/(.{76})/g, "$1\r\n");
      bodyParts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${quoteHeaderValue(att.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${quoteHeaderValue(att.filename)}"`,
        "",
        b64,
        "",
      );
    }
    bodyParts.push(`--${mixedBoundary}--`);
  }

  const message = bodyParts.join("\r\n");

  const raw = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw,
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${text}`);
  }
  return (await res.json()) as { id: string; threadId: string };
}

/** Escape backslash + quote for the filename in a header parameter. */
function quoteHeaderValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Re-export the encrypt helper so action code can encrypt refresh tokens
 * without importing lib/crypto directly. Keeps the boundary clean.
 */
export { encrypt as encryptRefreshToken };

// =========================================================================
// Label helpers — users.labels and users.threads.modify
// =========================================================================
//
// All three helpers take an encryptedRefreshToken so callers don't have
// to know about the access-token refresh flow. They use the standard
// Gmail REST endpoints (no SDK).
//
// Label scoping note:
//   Gmail labels live per-account. The dashboard's team_labels are
//   logical labels shared across the team; we map them to per-account
//   Gmail label ids via the team_label_gmail_links table.

export interface GmailLabel {
  id: string;
  name: string;
  type: "user" | "system";
  /** Tailwind-friendly hex from Gmail's color config, if set. */
  backgroundColor?: string;
  textColor?: string;
}

/** List every label on a Gmail account. Used for reconciliation when
 *  a team_label needs to be linked to a Gmail label by name match. */
export async function listGmailLabels(encryptedRefreshToken: string): Promise<GmailLabel[]> {
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail labels.list failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    labels?: Array<{
      id: string;
      name: string;
      type: "user" | "system";
      color?: { backgroundColor?: string; textColor?: string };
    }>;
  };
  return (data.labels ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    backgroundColor: l.color?.backgroundColor,
    textColor: l.color?.textColor,
  }));
}

/** Create a label on a Gmail account. Returns the new label id.
 *  Idempotent-ish: if a label with the same name already exists Gmail
 *  returns 409; we catch it and re-fetch the existing id. */
/**
 * Gmail's fixed label-color palette. Any color outside this set is
 * rejected by the API with HTTP 400. Source:
 * https://developers.google.com/gmail/api/reference/rest/v1/users.labels#color
 *
 * Pairs are (backgroundColor, textColor) — Gmail requires both
 * together; sending one without the other fails.
 *
 * Sticking to the ~25 most-commonly-used Gmail palette colors here.
 * The label color picker in the engine will offer the same set so
 * operators can't ask for something Gmail will reject.
 */
export const GMAIL_LABEL_COLOR_PAIRS: ReadonlyArray<{
  background: string;
  text: string;
}> = [
  // Greens
  { background: "#16a766", text: "#ffffff" },
  { background: "#43d692", text: "#ffffff" },
  { background: "#b3efd3", text: "#094228" },
  // Blues
  { background: "#3c78d8", text: "#ffffff" },
  { background: "#4a86e8", text: "#ffffff" },
  { background: "#a4c2f4", text: "#0b2954" },
  // Purples
  { background: "#8e63ce", text: "#ffffff" },
  { background: "#b694e8", text: "#ffffff" },
  { background: "#d0bcf1", text: "#3d188e" },
  // Reds
  { background: "#cc3a21", text: "#ffffff" },
  { background: "#e66550", text: "#ffffff" },
  { background: "#f6c5be", text: "#7a2e0b" },
  // Oranges / Yellows
  { background: "#ffad47", text: "#ffffff" },
  { background: "#ffd6a2", text: "#7a4706" },
  { background: "#fbe983", text: "#684e07" },
  // Neutrals
  { background: "#666666", text: "#ffffff" },
  { background: "#999999", text: "#ffffff" },
  { background: "#cccccc", text: "#1c1c1c" },
];

export function isValidGmailLabelColor(opts: {
  backgroundColor?: string | null;
  textColor?: string | null;
}): boolean {
  if (!opts.backgroundColor && !opts.textColor) return true; // no color = ok
  if (!opts.backgroundColor || !opts.textColor) return false; // half-set is not
  return GMAIL_LABEL_COLOR_PAIRS.some(
    (p) =>
      p.background.toLowerCase() === opts.backgroundColor?.toLowerCase() &&
      p.text.toLowerCase() === opts.textColor?.toLowerCase(),
  );
}

export async function createGmailLabel(opts: {
  encryptedRefreshToken: string;
  name: string;
  /** Optional Gmail-supported color pair. Both must be present
   *  together; either both null or both set. Validated against
   *  GMAIL_LABEL_COLOR_PAIRS — non-matching pairs throw before
   *  the Gmail call. */
  backgroundColor?: string | null;
  textColor?: string | null;
}): Promise<{ id: string; existed: boolean }> {
  // Validate before the network call. Surface a clear error so the
  // UI's color picker can highlight the invalid choice.
  if (
    !isValidGmailLabelColor({ backgroundColor: opts.backgroundColor, textColor: opts.textColor })
  ) {
    throw new Error(
      "Gmail rejected color. Pick from the supported palette (background + text together).",
    );
  }

  const accessToken = await refreshAccessToken(opts.encryptedRefreshToken);
  const body: Record<string, unknown> = {
    name: opts.name,
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
  };
  if (opts.backgroundColor && opts.textColor) {
    body.color = {
      backgroundColor: opts.backgroundColor,
      textColor: opts.textColor,
    };
  }

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const data = (await res.json()) as { id: string };
    return { id: data.id, existed: false };
  }
  if (res.status === 409 || res.status === 400) {
    // Already exists — look it up. Gmail returns 409 with "Label name
    // exists or conflicts" but some workspaces return 400. Both cases
    // mean "look up the existing one by name."
    const list = await listGmailLabels(opts.encryptedRefreshToken);
    const existing = list.find((l) => l.name.toLowerCase() === opts.name.toLowerCase());
    if (existing) return { id: existing.id, existed: true };
  }
  const text = await res.text();
  throw new Error(`Gmail labels.create failed: ${res.status} ${text}`);
}

/** Apply / remove labels on a thread. Either array can be empty. */
export async function modifyGmailThreadLabels(opts: {
  encryptedRefreshToken: string;
  gmailThreadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<void> {
  const accessToken = await refreshAccessToken(opts.encryptedRefreshToken);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${opts.gmailThreadId}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLabelIds: opts.addLabelIds ?? [],
        removeLabelIds: opts.removeLabelIds ?? [],
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail threads.modify failed: ${res.status} ${text}`);
  }
}

/**
 * Search the operator's Gmail contacts + recent senders via the
 * People API's `otherContacts.search` + `people.searchContacts`
 * endpoints. Returns up to `limit` results matching the query.
 *
 * Why People API rather than Gmail's own contact suggestions: the
 * Gmail API itself doesn't expose contact search; People is the
 * official path. Requires the contacts.readonly + contacts.other.readonly
 * scopes (granted on the existing OAuth consent if the operator
 * accepted the full scope set during connection).
 *
 * Falls back to an empty list on any error — autocomplete is a
 * convenience surface, not a correctness one.
 */
export interface GmailContactSuggestion {
  email: string;
  /** Display name from the Person resource (if any). */
  displayName: string | null;
}

export async function searchGmailContacts(opts: {
  encryptedRefreshToken: string;
  query: string;
  limit?: number;
}): Promise<GmailContactSuggestion[]> {
  if (!opts.query.trim()) return [];
  const accessToken = await refreshAccessToken(opts.encryptedRefreshToken);
  const limit = Math.min(opts.limit ?? 15, 30);

  // People API's contacts.search endpoint. readMask gives us just
  // the address + name fields we need.
  const url = new URL("https://people.googleapis.com/v1/people:searchContacts");
  url.searchParams.set("query", opts.query);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("readMask", "names,emailAddresses");

  const seen = new Set<string>();
  const results: GmailContactSuggestion[] = [];

  async function pull(endpoint: URL) {
    try {
      const res = await fetch(endpoint.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        results?: Array<{
          person?: {
            names?: Array<{ displayName?: string }>;
            emailAddresses?: Array<{ value?: string }>;
          };
        }>;
      };
      for (const r of data.results ?? []) {
        const name = r.person?.names?.[0]?.displayName ?? null;
        for (const e of r.person?.emailAddresses ?? []) {
          const email = e.value?.trim();
          if (!email) continue;
          const key = email.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ email, displayName: name });
          if (results.length >= limit) return;
        }
      }
    } catch {
      // Best-effort — autocomplete failures don't surface.
    }
  }

  await pull(url);

  // Also search the operator's "Other Contacts" — addresses they've
  // emailed in the past but haven't explicitly added to contacts.
  // This is where most of the useful suggestions live.
  if (results.length < limit) {
    const otherUrl = new URL("https://people.googleapis.com/v1/otherContacts:search");
    otherUrl.searchParams.set("query", opts.query);
    otherUrl.searchParams.set("pageSize", String(limit - results.length));
    otherUrl.searchParams.set("readMask", "names,emailAddresses");
    await pull(otherUrl);
  }

  return results;
}

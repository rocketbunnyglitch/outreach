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
 */
export function buildGmailAuthUrl(opts: {
  state: string;
  loginHint?: string;
}): string {
  const cfg = getGmailOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: opts.state,
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
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
 * Gmail's send endpoint takes a base64url-encoded RFC 5322 message. We
 * construct a minimal multipart/alternative message with HTML + plain
 * text fallbacks.
 *
 * threadId is optional — when set, Gmail nests the message in an existing
 * thread (so a "reply" stays threaded on the venue's side).
 */
export async function sendGmailMessage(opts: {
  encryptedRefreshToken: string;
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  threadId?: string;
  replyToMessageId?: string;
}): Promise<{ id: string; threadId: string }> {
  const accessToken = await refreshAccessToken(opts.encryptedRefreshToken);

  // Construct RFC 5322 message
  const boundary = `==BOUNDARY_${Date.now()}==`;
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (opts.replyToMessageId) {
    headers.push(`In-Reply-To: ${opts.replyToMessageId}`);
    headers.push(`References: ${opts.replyToMessageId}`);
  }
  const message = [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.textBody ?? stripHtml(opts.htmlBody),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    opts.htmlBody,
    "",
    `--${boundary}--`,
  ].join("\r\n");

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
export async function createGmailLabel(opts: {
  encryptedRefreshToken: string;
  name: string;
}): Promise<{ id: string; existed: boolean }> {
  const accessToken = await refreshAccessToken(opts.encryptedRefreshToken);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
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

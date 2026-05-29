import { requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { isGmailOAuthConfigured } from "@/lib/gmail";
import { NextResponse } from "next/server";

/**
 * GET /api/auth/google/debug
 *
 * Diagnostic endpoint for the Gmail OAuth setup. Returns the exact
 * URL the server is putting in the `redirect_uri` parameter when
 * starting the OAuth flow. Use this when "Error 400:
 * redirect_uri_mismatch" comes back from Google — the URL in the
 * response below is the EXACT string Google compares against the
 * "Authorized redirect URIs" list on the OAuth client. If they don't
 * match character-for-character (no trailing slash, http vs https,
 * exact case), Google rejects the request.
 *
 * Staff-only. Doesn't expose secrets — just the public URL + the
 * presence-check on the OAuth credentials.
 */
export async function GET() {
  await requireStaff();
  const origin = env.APP_URL;
  return NextResponse.json({
    appUrl: origin,
    redirectUri: `${origin}/api/auth/google/callback`,
    javascriptOrigin: origin,
    oauthConfigured: isGmailOAuthConfigured(),
    note: "Both fields must be added to your OAuth client in Google Cloud Console: the redirectUri under 'Authorized redirect URIs', and the javascriptOrigin under 'Authorized JavaScript origins'. Verbatim, no trailing slash.",
  });
}

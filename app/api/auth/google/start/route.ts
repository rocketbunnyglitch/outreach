import { randomBytes } from "node:crypto";
import { requireStaff } from "@/lib/auth";
import { buildGmailAuthUrl, isGmailOAuthConfigured } from "@/lib/gmail";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/auth/google/start
 *
 * Kicks off the Gmail OAuth flow for connecting an inbox to the
 * signed-in user. No query params — brand scoping was removed in
 * the send-queue decommission, so the only thing the state needs
 * to carry is the user's identity (so we can verify on callback
 * that the same user completes the flow) and a CSRF token.
 *
 * Generates a random CSRF token, sets it in a short-lived cookie,
 * and embeds it in the OAuth state alongside the user_id + team_id.
 * The callback validates the cookie matches the state to prevent
 * CSRF.
 *
 * If GOOGLE_OAUTH_CLIENT_ID isn't configured, returns 503 — the
 * page that links here should already be guarded with
 * isGmailOAuthConfigured.
 */
export async function GET(_req: NextRequest) {
  const { staff } = await requireStaff();

  if (!isGmailOAuthConfigured()) {
    return NextResponse.json(
      { error: "Gmail OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID + _SECRET." },
      { status: 503 },
    );
  }

  const csrf = randomBytes(16).toString("hex");
  const state = JSON.stringify({
    csrf,
    ownerUserId: staff.id,
    teamId: staff.teamId,
  });

  const cookieJar = await cookies();
  cookieJar.set("gmail_oauth_csrf", csrf, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const authUrl = buildGmailAuthUrl({
    state: Buffer.from(state).toString("base64"),
    loginHint: staff.primaryEmail,
  });

  return NextResponse.redirect(authUrl);
}

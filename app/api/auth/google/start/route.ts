import { randomBytes } from "node:crypto";
import { requireStaff } from "@/lib/auth";
import { buildGmailAuthUrl, isGmailOAuthConfigured } from "@/lib/gmail";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/auth/google/start
 *
 * Kicks off the Gmail OAuth flow. Required query param:
 *   outreachBrandId — which OutreachBrand this inbox is for
 *
 * Generates a random CSRF token, sets it in a short-lived cookie, and
 * embeds it in the OAuth state alongside the staff_member_id + brand_id.
 * The callback validates the cookie matches the state to prevent CSRF.
 *
 * If GOOGLE_OAUTH_CLIENT_ID isn't configured, returns 503 — the page that
 * links here should already be guarded with isGmailOAuthConfigured.
 */
export async function GET(req: NextRequest) {
  const { staff } = await requireStaff();

  if (!isGmailOAuthConfigured()) {
    return NextResponse.json(
      { error: "Gmail OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID + _SECRET." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const outreachBrandId = url.searchParams.get("outreachBrandId");
  if (!outreachBrandId) {
    return NextResponse.json({ error: "Missing outreachBrandId" }, { status: 400 });
  }

  // CSRF token: random, set as httpOnly cookie + embedded in state
  const csrf = randomBytes(16).toString("hex");
  const state = JSON.stringify({
    csrf,
    staffMemberId: staff.id,
    outreachBrandId,
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

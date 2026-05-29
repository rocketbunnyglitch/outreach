import { connectedAccounts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { withAuditContext } from "@/lib/db";
import { exchangeCodeForTokens, fetchUserEmail, isGmailOAuthConfigured } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/auth/google/callback
 *
 * Google redirects here after the user consents. Query params:
 *   code  — the authorization code (use once)
 *   state — opaque round-trip value containing CSRF + ownerUserId +
 *           teamId (base64 JSON built in /start)
 *   error — present if the user denied
 *
 * On success:
 *   1. Validate CSRF cookie matches state.csrf
 *   2. Validate ownerUserId in state matches the signed-in user
 *   3. Exchange code for tokens
 *   4. Fetch the connected Gmail address
 *   5. Encrypt refresh token and upsert into connected_accounts
 *      keyed on (owner_user_id, email_address)
 *   6. Redirect back to /settings/inboxes with ?connected=email
 *
 * Brand scoping was removed in the send-queue decommission — a
 * connected Gmail is no longer pinned to a specific outreach brand.
 * The user can connect any number of Gmail addresses; each becomes
 * one connected_accounts row.
 *
 * Audit trail: the upsert uses withAuditContext so the connection
 * event is logged.
 */
export async function GET(req: NextRequest) {
  const { staff } = await requireStaff();

  if (!isGmailOAuthConfigured()) {
    return NextResponse.redirect(new URL("/settings/inboxes?error=not_configured", req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateB64 = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    logger.warn({ errorParam }, "gmail oauth user denied");
    return NextResponse.redirect(new URL(`/settings/inboxes?error=${errorParam}`, req.url));
  }

  if (!code || !stateB64) {
    return NextResponse.redirect(new URL("/settings/inboxes?error=missing_params", req.url));
  }

  // Validate CSRF
  let state: { csrf: string; ownerUserId: string; teamId: string };
  try {
    state = JSON.parse(Buffer.from(stateB64, "base64").toString("utf8"));
  } catch {
    return NextResponse.redirect(new URL("/settings/inboxes?error=bad_state", req.url));
  }

  const cookieJar = await cookies();
  const csrfCookie = cookieJar.get("gmail_oauth_csrf")?.value;
  if (!csrfCookie || csrfCookie !== state.csrf) {
    return NextResponse.redirect(new URL("/settings/inboxes?error=csrf", req.url));
  }
  cookieJar.delete("gmail_oauth_csrf");

  if (state.ownerUserId !== staff.id) {
    // The user who started the flow must be the user who completes it.
    return NextResponse.redirect(new URL("/settings/inboxes?error=staff_mismatch", req.url));
  }

  // Defensive: the team_id encoded in state must match the user's
  // current team. (Today everyone is on one team so this is always
  // true; once invites + multiple teams land, this guards against
  // a stale OAuth flow.)
  if (state.teamId !== staff.teamId) {
    return NextResponse.redirect(new URL("/settings/inboxes?error=staff_mismatch", req.url));
  }

  // Exchange code -> tokens
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    logger.error({ err }, "gmail token exchange failed");
    return NextResponse.redirect(new URL("/settings/inboxes?error=token_exchange", req.url));
  }

  if (!tokens.refresh_token) {
    // Google sometimes withholds a refresh token if the user previously
    // granted access. Force re-consent by setting prompt=consent (done in
    // buildGmailAuthUrl). If we still didn't get one, something's wrong.
    return NextResponse.redirect(new URL("/settings/inboxes?error=no_refresh_token", req.url));
  }

  // Identify the connected Gmail account
  let connectedEmail: string;
  try {
    connectedEmail = await fetchUserEmail(tokens.access_token);
  } catch (err) {
    logger.error({ err }, "gmail userinfo fetch failed");
    return NextResponse.redirect(new URL("/settings/inboxes?error=userinfo", req.url));
  }

  const encryptedRefresh = encrypt(tokens.refresh_token);
  const scopesGranted = tokens.scope.split(" ").filter(Boolean);

  try {
    await withAuditContext(staff.id, async (tx) => {
      // Upsert keyed on (owner_user_id, email_address): reconnecting
      // the SAME Gmail refreshes the existing row's token; a NEW
      // address inserts a fresh row that coexists with the user's
      // other connected accounts. Email address is globally unique
      // (see schema) so reconnecting an address that belongs to
      // ANOTHER user is blocked by the unique index — that's the
      // intended behaviour.
      const existing = await tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.ownerUserId, staff.id),
            eq(connectedAccounts.emailAddress, connectedEmail),
          ),
        )
        .limit(1);

      if (existing[0]) {
        await tx
          .update(connectedAccounts)
          .set({
            emailAddress: connectedEmail,
            gmailOauthRefreshToken: encryptedRefresh,
            gmailOauthScopes: scopesGranted,
            status: "connected",
            lastSyncedAt: new Date(),
            updatedBy: staff.id,
          })
          .where(eq(connectedAccounts.id, existing[0].id));
      } else {
        await tx.insert(connectedAccounts).values({
          teamId: staff.teamId,
          ownerUserId: staff.id,
          emailAddress: connectedEmail,
          gmailOauthRefreshToken: encryptedRefresh,
          gmailOauthScopes: scopesGranted,
          status: "connected",
          lastSyncedAt: new Date(),
          createdBy: staff.id,
          updatedBy: staff.id,
        });
      }
    });
  } catch (err) {
    logger.error({ err }, "gmail connect persist failed");
    return NextResponse.redirect(new URL("/settings/inboxes?error=persist", req.url));
  }

  return NextResponse.redirect(
    new URL(`/settings/inboxes?connected=${encodeURIComponent(connectedEmail)}`, req.url),
  );
}

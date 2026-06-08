import { connectedAccounts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { withAuditContext } from "@/lib/db";
import { env } from "@/lib/env";
import { exchangeCodeForTokens, fetchGoogleProfile, isGmailOAuthConfigured } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Build a redirect URL that always lands on the PUBLIC origin, not on
 * the upstream-only host the Node process sees. `req.url` in a Next
 * standalone route handler behind nginx/Caddy resolves to whatever the
 * Node server binds to (HOSTNAME env var + PORT — for us, localhost:3001),
 * so `publicUrl(path)` produces a redirect that the browser can't
 * actually reach. env.APP_URL is the canonical public origin and is the
 * same value /start uses to construct Google's redirect_uri.
 */
function publicUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}

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
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=not_configured"));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateB64 = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    logger.warn({ errorParam }, "gmail oauth user denied");
    return NextResponse.redirect(publicUrl(`/settings/inboxes?error=${errorParam}`));
  }

  if (!code || !stateB64) {
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=missing_params"));
  }

  // Validate CSRF
  let state: { csrf: string; ownerUserId: string; teamId: string };
  try {
    state = JSON.parse(Buffer.from(stateB64, "base64").toString("utf8"));
  } catch {
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=bad_state"));
  }

  const cookieJar = await cookies();
  const csrfCookie = cookieJar.get("gmail_oauth_csrf")?.value;
  if (!csrfCookie || csrfCookie !== state.csrf) {
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=csrf"));
  }
  cookieJar.delete("gmail_oauth_csrf");

  if (state.ownerUserId !== staff.id) {
    // The user who started the flow must be the user who completes it.
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=staff_mismatch"));
  }

  // Defensive: the team_id encoded in state must match the user's
  // current team. (Today everyone is on one team so this is always
  // true; once invites + multiple teams land, this guards against
  // a stale OAuth flow.)
  if (state.teamId !== staff.teamId) {
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=staff_mismatch"));
  }

  // Exchange code -> tokens
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    logger.error({ err }, "gmail token exchange failed");
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=token_exchange"));
  }

  if (!tokens.refresh_token) {
    // Google sometimes withholds a refresh token if the user previously
    // granted access. Force re-consent by setting prompt=consent (done in
    // buildGmailAuthUrl). If we still didn't get one, something's wrong.
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=no_refresh_token"));
  }

  // Identify the connected Gmail account (+ name/picture when the profile
  // scope was granted; null otherwise).
  let connectedEmail: string;
  let avatarUrl: string | null = null;
  try {
    const profile = await fetchGoogleProfile(tokens.access_token);
    connectedEmail = profile.email;
    avatarUrl = profile.picture;
  } catch (err) {
    logger.error({ err }, "gmail userinfo fetch failed");
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=userinfo"));
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
            // Only overwrite the avatar when this connect actually returned one
            // (profile scope granted) -- don't wipe a stored avatar otherwise.
            ...(avatarUrl ? { avatarUrl } : {}),
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
          avatarUrl,
          // Start the warm-up ramp on a freshly-connected inbox so its cold cap
          // climbs gradually over ~3 weeks instead of blasting day one.
          warmupStartedAt: new Date(),
          createdBy: staff.id,
          updatedBy: staff.id,
        });
      }
    });
  } catch (err) {
    logger.error({ err }, "gmail connect persist failed");
    return NextResponse.redirect(publicUrl("/settings/inboxes?error=persist"));
  }

  return NextResponse.redirect(
    publicUrl(`/settings/inboxes?connected=${encodeURIComponent(connectedEmail)}`),
  );
}

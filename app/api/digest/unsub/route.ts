/**
 * GET /api/digest/unsub?token=<hmac-token>
 *
 * One-click unsubscribe from the daily digest. The token is signed
 * by lib/digest-unsub-token.ts (HMAC-SHA256 over the userId +
 * issuedAt using NEXTAUTH_SECRET). Validates the token, sets
 * user_preferences.daily_digest_enabled = false for the user, and
 * returns a simple HTML confirmation page.
 *
 * Why HTML (not JSON or a redirect):
 *
 *   - Email clients (Gmail / Apple Mail / Outlook) preview links
 *     differently. A bare HTTP-200 with a plain confirmation page
 *     renders inline in the preview. A redirect to /me/preferences
 *     would require a logged-in session, which defeats the point
 *     of the one-click unsub.
 *
 *   - The confirmation page lets us mention the re-subscribe path
 *     in case the operator changes their mind.
 *
 * Status codes:
 *   200 -- token verified, unsubscribed. Idempotent: re-clicking
 *          the same URL is fine, it just no-ops the second time.
 *   400 -- token missing, malformed, or expired. Body explains.
 *
 * No CSRF / auth check beyond the token signature -- the whole
 * point is "this works from a stale email without a session." The
 * HMAC IS the auth.
 */

import { users } from "@/db/schema";
import { userPreferences } from "@/db/schema/user-preferences";
import { db } from "@/lib/db";
import { verifyUnsubToken } from "@/lib/digest-unsub-token";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";

  const verified = verifyUnsubToken(token);
  if (!verified) {
    return new NextResponse(renderErrorPage("Link is invalid or has expired."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Sanity check: the user still exists. If they were deleted we
  // can't (and don't need to) flip their preference -- return the
  // same success page so a curious attacker probing tokens can't
  // tell the difference between "valid user" and "stale token for
  // a deleted user."
  const existing = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);
  if (!existing[0]) {
    logger.info(
      { userId: verified.userId },
      "digest unsub for non-existent user (already deleted?)",
    );
    return new NextResponse(renderSuccessPage(null), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Upsert: if the row exists, flip the flag. If it doesn't (new
  // operator who's never set a preference), insert one with the
  // flag off and default everything else. Mirrors the upsert
  // pattern in app/(admin)/me/preferences/_actions.ts.
  await db
    .insert(userPreferences)
    .values({ userId: verified.userId, dailyDigestEnabled: false })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { dailyDigestEnabled: false, updatedAt: new Date() },
    });

  logger.info({ userId: verified.userId }, "digest one-click unsub succeeded");

  return new NextResponse(renderSuccessPage(existing[0].displayName), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 4rem auto; padding: 0 1.5rem; color: #18181b; line-height: 1.5; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { margin: 0.5rem 0; color: #3f3f46; }
  .muted { color: #71717a; font-size: 0.875rem; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #f4f4f5; }
    p { color: #d4d4d8; }
    .muted { color: #a1a1aa; }
    a { color: #93c5fd; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderSuccessPage(displayName: string | null): string {
  const greeting = displayName ? `, ${escapeHtml(displayName.split(/\s+/)[0] ?? displayName)}` : "";
  return htmlShell(
    "Unsubscribed",
    `<h1>You've been unsubscribed${greeting}.</h1>
<p>You won't receive any more daily digest emails. Replies, mentions, and other notifications are unaffected.</p>
<p class="muted">Changed your mind? You can re-enable the digest any time from <a href="https://outreach.barcrawlconnect.com/me/preferences">/me/preferences</a>.</p>`,
  );
}

function renderErrorPage(message: string): string {
  return htmlShell(
    "Unsubscribe link",
    `<h1>Couldn't process this link</h1>
<p>${escapeHtml(message)}</p>
<p class="muted">You can manage email preferences directly from <a href="https://outreach.barcrawlconnect.com/me/preferences">/me/preferences</a> after signing in.</p>`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

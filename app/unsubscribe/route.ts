/**
 * One-click unsubscribe endpoint.
 *
 * GET /unsubscribe?token=<base64url>
 *
 * Used in follow-up emails. The token resolves to an outreach_sequence_state
 * row; on hit we:
 *   1. Mark the venue as globally unsubscribed (sets venues.unsubscribed_at
 *      AND venues.do_not_contact, so all future cadence sends across
 *      brands are blocked)
 *   2. Stop every active sequence for that venue with reason='unsubscribed'
 *   3. Show a confirmation page
 *
 * This route is public — no auth required. The token is the secret.
 *
 * Per RFC 8058 (one-click unsubscribe), the most aggressive deliverability
 * tactic is supporting BOTH GET (link in email body) and POST (HTTP
 * one-click header). For now we support GET; POST is identical wiring.
 */

import { logger } from "@/lib/logger";
import { markUnsubscribed } from "@/lib/outreach-sequences";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new NextResponse(unsubscribePage("Missing token. Use the link in your email."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  try {
    const result = await markUnsubscribed(token);
    if (!result) {
      return new NextResponse(
        unsubscribePage("Link expired or already used. No action needed — you're not on the list."),
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    logger.info({ venueId: result.venueId }, "unsubscribed via one-click link");
    return new NextResponse(
      unsubscribePage(
        "Done. You've been removed from our outreach list. You won't receive further emails from any of our brands.",
      ),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    logger.error({ err }, "unsubscribe failed");
    return new NextResponse(
      unsubscribePage("Something went wrong. Please email us directly to unsubscribe."),
      { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

// RFC 8058 one-click POST
export async function POST(request: Request) {
  return GET(request);
}

function unsubscribePage(message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unsubscribe</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, system-ui, sans-serif;
        margin: 0;
        padding: 0;
        background: #fafafa;
        color: #18181b;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #09090b; color: #fafafa; }
      }
      main {
        max-width: 480px;
        padding: 48px 32px;
        text-align: center;
      }
      h1 {
        font-size: 32px;
        font-weight: 600;
        margin: 0 0 16px;
        letter-spacing: -0.02em;
      }
      p {
        font-size: 16px;
        line-height: 1.5;
        color: #52525b;
        margin: 0;
      }
      @media (prefers-color-scheme: dark) {
        p { color: #a1a1aa; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Unsubscribed</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

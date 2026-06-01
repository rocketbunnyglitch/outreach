import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side session clear + recovery redirect.
 *
 * When requireStaff() finds the JWT references a user that no longer exists
 * (a stale session after a schema change), it redirects here. A Server
 * Component cannot reliably persist a cookie clear, and the session cookie is
 * HttpOnly (so the client-side /reset page cannot touch it) AND chunked when
 * large (authjs.session-token.0/.1/...). This route handler CAN Set-Cookie, so
 * it expires every variant + chunk, then sends the browser to a fresh /login.
 * Breaks the "edge says authenticated / page says not" redirect loop
 * (ERR_TOO_MANY_REDIRECTS) without the user resetting their browser.
 *
 * Use req.nextUrl (NOT req.url) for the redirect target: behind the nginx
 * proxy req.url is the internal http://localhost:3001 origin, whereas nextUrl
 * resolves to the public host from the forwarded Host header.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login?recovered=1", req.nextUrl));
  const bases = ["authjs.session-token", "__Secure-authjs.session-token"];
  const names: string[] = [];
  for (const b of bases) {
    names.push(b);
    for (let i = 0; i < 10; i++) names.push(`${b}.${i}`);
  }
  names.push("crawl_engine_current_campaign", "perse_redir_guard");
  for (const name of names) {
    res.cookies.set(name, "", { path: "/", maxAge: 0, secure: name.startsWith("__Secure-") });
  }
  return res;
}

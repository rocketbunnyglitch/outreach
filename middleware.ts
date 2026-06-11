/**
 * Next.js Middleware. Runs on the Edge runtime for every request matching
 * the config below.
 *
 * The middleware uses the edge-safe `auth.config.ts` — no DB queries, just
 * the cookie/JWT check via NextAuth's `authorized` callback. Routes
 * authorized() returns false for redirect to /login.
 *
 * Actual access control (does this staff member exist + is active) happens
 * in the Node-runtime `signIn` callback in `auth.ts`. The middleware's
 * job is just to enforce "is there a valid session cookie?"
 */

import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "./auth.config";
import { isMachineRoute } from "./lib/public-routes";

const { auth } = NextAuth(authConfig);

const CAMPAIGN_COOKIE = "crawl_engine_current_campaign";

// Redirect-loop breaker. The edge middleware authorizes on JWT validity only
// (no DB), but a page's requireStaff() does a DB check and redirects to /login
// when the JWT's staffId no longer resolves to an active staff row (e.g. a
// stale session from before a schema change). The middleware then bounces
// /login → / because the JWT still "authenticates" at the edge — an infinite
// loop ("Safari can't open the page because too many redirects"). We count the
// /login → / bounces in a short-lived cookie; after a few, we clear the stale
// session so /login can finally render. Auto-heals the user's browser without
// them having to reset it. Session cookie names are NextAuth v5 (authjs.*);
// __Secure- prefix is used over HTTPS.
const REDIR_GUARD = "perse_redir_guard";
const REDIR_GUARD_LIMIT = 3;
// NextAuth chunks the session cookie when the JWT is large
// (authjs.session-token.0/.1/...). Clearing only the base name leaves the
// chunks, so the edge re-assembles a "valid" token and the loop persists —
// we must expire every chunk variant too.
const STALE_SESSION_COOKIES = (() => {
  const names: string[] = [CAMPAIGN_COOKIE];
  for (const base of ["__Secure-authjs.session-token", "authjs.session-token"]) {
    names.push(base);
    for (let i = 0; i < 10; i++) names.push(`${base}.${i}`);
  }
  return names;
})();

// Paths that require a campaign to be scoped. These are the "Current
// Crawl" + "Operate" groups in the side nav. Without a campaign, the
// nav hides them and the middleware redirects direct URL access to
// /admin so the operator picks a campaign first.
const CAMPAIGN_GATED_PREFIXES = [
  "/tracker",
  "/inbox",
  "/tasks",
  "/all-crawls",
  "/crawl-support",
  "/crawl-matrix",
  "/calendar",
  "/send-queue",
  "/wristbands",
  "/support-hours",
  "/event-submission",
  "/maps",
];

function requiresCampaign(pathname: string): boolean {
  // Root (the dashboard) is also campaign-scoped but matched as an
  // exact path so we don't accidentally redirect every URL.
  if (pathname === "/") return true;
  return CAMPAIGN_GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((req) => {
  const isAuthenticated = !!req.auth;
  const { pathname, search } = req.nextUrl;
  const redirGuard = Number(req.cookies.get(REDIR_GUARD)?.value ?? "0") || 0;

  // Loop breaker: we've bounced /login → / too many times (the JWT looks
  // authenticated at the edge but the page keeps redirecting back to /login).
  // Clear the stale session + guard so /login renders, breaking the loop.
  if (redirGuard >= REDIR_GUARD_LIMIT) {
    const res = NextResponse.redirect(new URL("/login?recovered=1", req.nextUrl));
    for (const name of STALE_SESSION_COOKIES) {
      res.cookies.set(name, "", { path: "/", maxAge: 0, secure: name.startsWith("__Secure-") });
    }
    res.cookies.set(REDIR_GUARD, "", { path: "/", maxAge: 0 });
    return res;
  }

  // Public surfaces (mirror what auth.config.ts authorized() considers public)
  const isPublic =
    pathname.startsWith("/api/auth") ||
    // Machine endpoints (cron/engine/webhooks/sms/track) — no browser
    // session, each enforces its own secret/signature/token. Shared
    // allowlist so this list and auth.config.ts can't drift (the drift
    // 307-bounced Quo webhooks + open pixels to /login; 2026-06-11).
    isMachineRoute(pathname) ||
    pathname === "/api/health" ||
    // Temporary public diagnostic beacon (lib/client-diag.ts) — must be
    // reachable pre-auth since the load failure can happen before login.
    pathname === "/api/client-diag" ||
    // Stale-session self-heal route — clears the (HttpOnly, chunked) session
    // cookie server-side and redirects to /login. Must be reachable always.
    pathname === "/api/session/clear" ||
    pathname === "/login" ||
    // Public legal + marketing pages. Required for Google OAuth
    // verification (consent screen links to these) and reachable
    // to anyone visiting the app's homepage URL pre-auth. Also
    // gives work content filters enough cross-linked substance
    // to recognize this as a real product site, not a thin shell.
    pathname === "/about" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/features" ||
    pathname === "/security" ||
    pathname === "/faq" ||
    pathname === "/contact" ||
    pathname === "/changelog" ||
    // Static client-state reset page. Must be reachable even when the
    // user is signed out or the main app is broken — that's the whole
    // point. Clearing your own browser storage is a self-service
    // recovery action and not a security risk.
    pathname === "/reset" ||
    // SEO/crawler files — must be reachable by content-filter + search
    // crawlers (not redirected to /login) so the domain can be categorized.
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  // If signed in and on /login, bounce to home. Count the bounce — if the
  // page keeps sending us back here (stale session), the guard above breaks
  // the loop after REDIR_GUARD_LIMIT hops.
  if (isAuthenticated && pathname === "/login") {
    const res = NextResponse.redirect(new URL("/", req.nextUrl));
    res.cookies.set(REDIR_GUARD, String(redirGuard + 1), { path: "/", maxAge: 10 });
    return res;
  }

  if (isPublic) {
    const res = NextResponse.next();
    // Reached a public page (e.g. /login rendered) — no loop in progress.
    if (redirGuard) res.cookies.set(REDIR_GUARD, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", req.nextUrl);
    // Preserve the original destination so we can bounce back after sign-in.
    loginUrl.searchParams.set("from", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated. If the route requires a campaign and none is set,
  // bounce to a safe landing route. Branch by role: admins land on
  // /admin (they manage the campaigns + master data); everyone else
  // lands on /pick-campaign so they can one-click into the campaign
  // they're working on without going through the full /campaigns
  // management surface. Per operator: "If a non admin logins and
  // doesn't select a campaign they have a loading screen with
  // active campaigns to click to automatically load it".
  // The cookie presence is a proxy for "operator has picked a
  // campaign"; a stale UUID gets caught at page-level
  // (getCurrentCampaign returns null and the page can re-redirect).
  if (requiresCampaign(pathname) && !req.cookies.get(CAMPAIGN_COOKIE)?.value) {
    const role = req.auth?.user?.role;
    const landing = role === "admin" ? "/admin" : "/pick-campaign";
    return NextResponse.redirect(new URL(landing, req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next.js static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

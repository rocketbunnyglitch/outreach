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

const { auth } = NextAuth(authConfig);

const CAMPAIGN_COOKIE = "crawl_engine_current_campaign";

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
  "/discover",
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

  // Public surfaces (mirror what auth.config.ts authorized() considers public)
  const isPublic =
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname === "/api/health" ||
    pathname === "/login" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  // If signed in and on /login, bounce to home.
  if (isAuthenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (isPublic) {
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", req.nextUrl);
    // Preserve the original destination so we can bounce back after sign-in.
    loginUrl.searchParams.set("from", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated. If the route requires a campaign and none is set,
  // bounce to /admin (the safe landing without campaign context). The
  // cookie presence is a proxy for "operator has picked a campaign";
  // a stale UUID gets caught at page-level (getCurrentCampaign returns
  // null and the page can re-redirect).
  if (requiresCampaign(pathname) && !req.cookies.get(CAMPAIGN_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next.js static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

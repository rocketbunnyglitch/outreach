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

export default auth((req) => {
  const isAuthenticated = !!req.auth;
  const { pathname, search } = req.nextUrl;

  // Public surfaces (mirror what auth.config.ts authorized() considers public)
  const isPublic =
    pathname.startsWith("/api/auth") ||
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

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next.js static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

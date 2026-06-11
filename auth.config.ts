/**
 * Edge-safe NextAuth config.
 *
 * NextAuth v5 splits config into two layers so the middleware can run on the
 * Edge runtime (which can't import Node-only modules like `pg`):
 *
 *   - `auth.config.ts` (this file) — providers as an empty array, just the
 *     callbacks and pages config that the middleware needs to decide which
 *     routes are protected.
 *
 *   - `auth.ts` — re-imports this, adds the actual Google + Credentials
 *     providers plus DB-querying callbacks. Used by API routes and Server
 *     Components / Server Actions.
 *
 * This pattern is the official recommendation in the NextAuth v5 docs.
 */

import type { NextAuthConfig } from "next-auth";
import { isMachineRoute } from "./lib/public-routes";

const config: NextAuthConfig = {
  // Providers are added in auth.ts; the middleware doesn't need them.
  providers: [],

  // We deploy behind a Caddy reverse proxy that normalizes the Host header,
  // and in dev we hit 127.0.0.1 directly. Either way, NextAuth's default
  // host-pinning (only trust the host from AUTH_URL) doesn't fit. trustHost
  // tells NextAuth to use the incoming request's host for redirects and
  // cookie domains. Safe here because Caddy is the only ingress in prod.
  trustHost: true,

  pages: {
    signIn: "/login",
  },

  callbacks: {
    /**
     * `authorized` runs in middleware (edge). Keep it cheap — no DB lookups.
     * Real authorization (does this staff member exist + is active) happens
     * inside the `signIn` callback in auth.ts, which runs in Node at the
     * route-handler level.
     */
    authorized({ auth, request }) {
      // Gate on staffId specifically, NOT just auth.user. Default
      // NextAuth populates auth.user with email/name from the JWT,
      // so a token whose staffId has been cleared (by the self-heal
      // in auth.ts when the underlying users row is gone) STILL
      // makes !!auth.user truthy here. That leaves the middleware
      // believing the session is valid while requireStaff() on the
      // Node side disagrees — every page redirects to /login, /login
      // redirects back to /, ERR_TOO_MANY_REDIRECTS.
      //
      // Treating "no staffId" as unauthenticated makes /login serve
      // its form instead of bouncing, and the affected browser
      // recovers on a single fresh sign-in.
      const isAuthenticated =
        !!auth?.user && typeof (auth.user as { staffId?: unknown }).staffId === "string";
      const { pathname } = request.nextUrl;

      // Public surfaces — always allowed
      if (
        pathname.startsWith("/api/auth") ||
        // Machine endpoints — session-public, each route enforces its
        // own secret/signature/token. Shared with middleware.ts via
        // lib/public-routes so the two layers can't drift (2026-06-11).
        isMachineRoute(pathname) ||
        pathname === "/api/health" ||
        // Stale-session self-heal route — must be reachable so a broken
        // (valid-at-edge, dead-in-DB) session can clear itself instead of
        // looping. The handler only expires session cookies + → /login.
        pathname === "/api/session/clear" ||
        pathname === "/login" ||
        // Invite + password-reset landing page. Carries a one-shot
        // signed token in the URL, so it's safe to expose without a
        // session — the token IS the authentication.
        pathname.startsWith("/set-password/") ||
        // Public legal + marketing pages — required for Google OAuth
        // verification (the consent screen links to these). The
        // extended set (features/security/faq/contact/changelog)
        // gives work content filters enough substance to recognize
        // this as a real product site.
        pathname === "/about" ||
        pathname === "/privacy" ||
        pathname === "/terms" ||
        pathname === "/features" ||
        pathname === "/security" ||
        pathname === "/faq" ||
        pathname === "/contact" ||
        pathname === "/changelog" ||
        // Client-state reset page — reachable without a session so
        // a user with a broken auth cookie can still recover.
        pathname === "/reset" ||
        // SEO/crawler files — reachable for domain categorization.
        pathname === "/robots.txt" ||
        pathname === "/sitemap.xml" ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico"
      ) {
        return true;
      }

      // Everything else requires a session
      return isAuthenticated;
    },
  },

  session: {
    strategy: "jwt",
  },
};

export default config;

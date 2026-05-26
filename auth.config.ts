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
      const isAuthenticated = !!auth?.user;
      const { pathname } = request.nextUrl;

      // Public surfaces — always allowed
      if (
        pathname.startsWith("/api/auth") ||
        pathname === "/api/health" ||
        pathname === "/login" ||
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

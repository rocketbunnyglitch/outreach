/**
 * Module augmentation for NextAuth v5.
 *
 * NextAuth's default Session type has user.{name,email,image} but no concept
 * of a domain-specific user id. We attach `staffId` (the users.id uuid;
 * kept as `staffId` for back-compat) so server actions can pass it
 * directly to `withAuditContext` without re-querying the DB.
 *
 * Also exposes:
 *   - `teamId` so the inbox + future team-scoped queries can filter
 *     without an extra DB hop
 *   - `role` so the middleware + UI can branch by role
 *   - `passwordMustChange` so the middleware can force a redirect to
 *     /set-password on next request
 *   - `provider` on the session to surface "admin-impersonate"
 *     somewhere visible (commit 5 will add the banner)
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      staffId?: string;
      teamId?: string;
      role?: "admin" | "lead" | "outreach" | "readonly";
      passwordMustChange?: boolean;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    /** Which provider issued this session: "password" | "admin-impersonate". */
    provider?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    staffId?: string;
    teamId?: string;
    role?: "admin" | "lead" | "outreach" | "readonly";
    provider?: string;
    passwordMustChange?: boolean;
  }
}

/**
 * Module augmentation for NextAuth v5.
 *
 * NextAuth's default Session type has user.{name,email,image} but no concept
 * of a domain-specific user id. We attach `staffId` (the staff_members.id
 * uuid) so server actions can pass it directly to `withAuditContext`
 * without re-querying the DB.
 *
 * We also expose `provider` on the session so the demo-mode banner can
 * detect when someone is signed in via the dev impersonation route.
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      staffId?: string;
      /** Role from staff_members.role — used by the middleware to
       *  pick the right landing route when no campaign is scoped. */
      role?: "admin" | "lead" | "outreach" | "readonly";
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    /** Which provider issued this session: "google" | "dev-staff-impersonate". */
    provider?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    staffId?: string;
    role?: "admin" | "lead" | "outreach" | "readonly";
    provider?: string;
  }
}

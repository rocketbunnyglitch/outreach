/**
 * Full NextAuth v5 configuration. Used by API routes and Server Components.
 *
 * Auth model (post commit 3):
 *   - Email + password authentication. The "users" table holds primary_email
 *     and password_hash (bcrypt); the Credentials provider in this file
 *     verifies the hash on every sign-in.
 *   - Passwords are provisioned by admins via /admin/users (commit 5):
 *     either set inline at user-creation time, or via a magic-link invite
 *     email that lands the invitee on /set-password/[token].
 *   - Admin-only impersonation survives but is gated by a short-lived
 *     signed cookie (impersonate_grant) issued by the /admin/users
 *     impersonate action. The env var ENABLE_DEV_IMPERSONATION is
 *     deprecated and ignored.
 *   - Session strategy is JWT (no DB session table). users.id is persisted
 *     on the JWT as token.staffId (kept for back-compat with the existing
 *     codebase; a future cleanup PR can rename to userId). teamId is also
 *     stashed on the token so the inbox surface can scope without an
 *     extra DB hop.
 *   - Google OAuth login is GONE. The /api/auth/google/* routes still
 *     exist but only for CONNECTING Gmail inboxes (read/send mail), not
 *     for signing in.
 */

import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import authConfig from "./auth.config";
import { users } from "./db/schema";
import { db } from "./lib/db";
import { env } from "./lib/env";
import { verifyImpersonationGrant } from "./lib/impersonation-cookie";
import { logger } from "./lib/logger";

// =========================================================================
// Provider list — password + admin-issued impersonation.
// =========================================================================

const providers: NonNullable<typeof authConfig.providers> = [];

/**
 * Password provider — the primary login flow.
 *
 * Looks up users by primary_email, verifies the supplied password against
 * the stored bcrypt hash, and rejects if:
 *   - the user doesn't exist
 *   - status !== 'active'
 *   - password_hash is NULL (invited but not yet set — they should hit
 *     /set-password/[token] from their invite email instead)
 *   - password_must_change is true (we still let them sign in but the
 *     middleware will redirect to /set-password)
 *   - the supplied password doesn't match
 *
 * Bcrypt compare is constant-time-ish; never log the supplied password.
 */
providers.push(
  Credentials({
    id: "password",
    name: "Email + password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = typeof credentials?.email === "string" ? credentials.email.trim() : "";
      const password = typeof credentials?.password === "string" ? credentials.password : "";
      if (!email || !password) return null;

      const rows = await db.select().from(users).where(eq(users.primaryEmail, email)).limit(1);
      const user = rows[0];

      if (!user) {
        logger.warn({ email }, "password login rejected: no user with this email");
        return null;
      }
      if (user.status !== "active") {
        logger.warn({ email, userId: user.id }, "password login rejected: user is not active");
        return null;
      }
      if (!user.passwordHash) {
        logger.warn(
          { email, userId: user.id },
          "password login rejected: user has no password set (invite pending)",
        );
        return null;
      }

      let ok = false;
      try {
        ok = await compare(password, user.passwordHash);
      } catch (err) {
        logger.error({ err, userId: user.id }, "bcrypt compare threw");
        return null;
      }
      if (!ok) {
        logger.warn({ email, userId: user.id }, "password login rejected: wrong password");
        return null;
      }

      logger.info({ userId: user.id, email }, "password login accepted");

      // Returning a User object signals success. NextAuth then runs the
      // jwt callback below with this user, which is where we persist
      // staffId/teamId/role onto the session token.
      return {
        id: user.id,
        email: user.primaryEmail,
        name: user.displayName,
        // Stash role + teamId so the jwt callback can copy onto the token
        // without a second DB hit. NextAuth passes arbitrary fields
        // through the User object.
        role: user.role,
        teamId: user.teamId,
        passwordMustChange: user.passwordMustChange,
      } as {
        id: string;
        email: string;
        name: string;
        role: string;
        teamId: string;
        passwordMustChange: boolean;
      };
    },
  }),
);

/**
 * Admin impersonation provider — replaces ENABLE_DEV_IMPERSONATION.
 *
 * The /admin/users UI (commit 5) sets a short-lived, signed
 * `impersonate_grant` cookie that names the target userId. This
 * provider reads + verifies that cookie and signs in as the named
 * user. The cookie is HMACed with NEXTAUTH_SECRET so it can't be
 * forged client-side.
 *
 * `authorize()` only succeeds when:
 *   - the cookie is present AND signed correctly
 *   - the target user is active
 *
 * After a successful impersonation the cookie is single-use: the
 * /admin/users action sets it with maxAge=60s and the consumer of
 * the resulting session is expected to clear it.
 */
providers.push(
  Credentials({
    id: "admin-impersonate",
    name: "Admin impersonation",
    credentials: {
      // No credential fields — the grant cookie carries the targetUserId.
    },
    async authorize() {
      const grant = await verifyImpersonationGrant();
      if (!grant) return null;

      const rows = await db.select().from(users).where(eq(users.id, grant.targetUserId)).limit(1);
      const target = rows[0];
      if (!target || target.status !== "active") {
        logger.warn(
          { targetUserId: grant.targetUserId, grantedBy: grant.grantedByUserId },
          "admin impersonation rejected: target user not active",
        );
        return null;
      }
      logger.warn(
        { targetUserId: target.id, grantedBy: grant.grantedByUserId },
        "admin impersonation accepted",
      );
      return {
        id: target.id,
        email: target.primaryEmail,
        name: target.displayName,
        role: target.role,
        teamId: target.teamId,
        passwordMustChange: false,
      } as {
        id: string;
        email: string;
        name: string;
        role: string;
        teamId: string;
        passwordMustChange: boolean;
      };
    },
  }),
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  secret: env.NEXTAUTH_SECRET,
  providers,

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Runs after a provider authenticates a user but before a session is
     * created. The Credentials providers above already validated, so we
     * just let them through. If a different provider is ever added, this
     * is where global access-control would live.
     */
    async signIn({ user, account }) {
      // Both our providers populate user.id with the users row id.
      if (account?.provider === "password" || account?.provider === "admin-impersonate") {
        return true;
      }
      // Defensive: any unknown provider is rejected. (Should never fire
      // unless someone adds a provider above without updating this
      // callback.)
      logger.warn({ provider: account?.provider, userId: user.id }, "unknown provider in signIn");
      return false;
    },

    /**
     * Persist user identity on the JWT. Runs on every sign-in and on
     * every subsequent token refresh. Also verifies the user row still
     * exists; if not, clears identity from the token so the middleware
     * redirects to /login cleanly instead of looping.
     */
    async jwt({ token, user, account }) {
      if (user) {
        // First sign-in: persist staffId + teamId + role + provider on token.
        token.staffId = user.id;
        token.provider = account?.provider ?? "unknown";
        const fromUser = user as {
          role?: string;
          teamId?: string;
          passwordMustChange?: boolean;
        };
        if (
          fromUser.role === "admin" ||
          fromUser.role === "lead" ||
          fromUser.role === "outreach" ||
          fromUser.role === "readonly"
        ) {
          token.role = fromUser.role;
        }
        if (typeof fromUser.teamId === "string") {
          token.teamId = fromUser.teamId;
        }
        if (typeof fromUser.passwordMustChange === "boolean") {
          token.passwordMustChange = fromUser.passwordMustChange;
        }
      }
      // Verify the user referenced by this token still exists. Without
      // this check a stale JWT after a user delete would loop the
      // middleware (see fix 595c937 from the schema-rename rollout).
      // Also lazily backfills teamId for tokens issued before this
      // commit.
      if (token.staffId && typeof token.staffId === "string") {
        try {
          const rows = await db
            .select({ role: users.role, teamId: users.teamId, status: users.status })
            .from(users)
            .where(eq(users.id, token.staffId))
            .limit(1);
          if (rows.length === 0 || rows[0]?.status !== "active") {
            logger.warn(
              { staffId: token.staffId },
              "jwt: token references a user that no longer exists / is not active; clearing session identity",
            );
            token.staffId = undefined;
            token.role = undefined;
            token.teamId = undefined;
            return token;
          }
          if (!token.role && rows[0]?.role) {
            token.role = rows[0].role;
          }
          if (!token.teamId && rows[0]?.teamId) {
            token.teamId = rows[0].teamId;
          }
        } catch (err) {
          // Don't take down logins on a transient DB blip. Keep the
          // token as-is and let the next refresh re-verify.
          logger.warn({ err, staffId: token.staffId }, "jwt: user lookup failed");
        }
      }
      return token;
    },

    /**
     * Expose identity on the session object available in Server
     * Components / Server Actions via `await auth()`.
     *
     * If the jwt callback above cleared staffId (because the user row
     * was deleted), nuke session.user too so the middleware's
     * `!!auth?.user` check redirects cleanly.
     */
    async session({ session, token }) {
      if (!token.staffId || typeof token.staffId !== "string") {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      session.user = {
        ...session.user,
        staffId: token.staffId,
      };
      if (token.role) {
        session.user = { ...session.user, role: token.role };
      }
      if (token.teamId && typeof token.teamId === "string") {
        session.user = { ...session.user, teamId: token.teamId };
      }
      if (token.provider && typeof token.provider === "string") {
        session.provider = token.provider;
      }
      if (typeof token.passwordMustChange === "boolean") {
        session.user = {
          ...session.user,
          passwordMustChange: token.passwordMustChange,
        };
      }
      return session;
    },
  },
});

// Expose flags so the login UI knows which providers to render.
// Google login is GONE; this is retained as an empty object for
// import-compat with the existing login page until commit 3's UI
// rewrite lands.
export const authProviderStatus = {
  googleEnabled: false,
  devCredentialsEnabled: false,
};

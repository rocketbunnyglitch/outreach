/**
 * Full NextAuth v5 configuration. Used by API routes and Server Components.
 *
 * Auth model:
 *   - Google OAuth is the canonical sign-in path. Restricted to the operator's
 *     Google Workspace domain via the `hd` parameter.
 *   - In non-production environments, a Credentials provider is also enabled
 *     so the engine can be demoed without OAuth credentials — pick a seeded
 *     staff member by email to "sign in as" them.
 *   - On every sign-in attempt, we look up `staff_members` by primary_email.
 *     If no active row matches, sign-in is rejected. This is the canonical
 *     access-control gate: a Google Workspace account alone is not enough,
 *     the user must be pre-provisioned as staff.
 *   - Session strategy is JWT (no DB session table). The staff_member.id is
 *     persisted on the JWT so server actions can pass it to
 *     `withAuditContext()` without an extra DB round-trip.
 *
 * The Google account + OAuth refresh token are NOT stored here. That's a
 * separate connection per (staff × OutreachBrand) for sending cold outreach,
 * managed via `staff_outreach_emails` (Phase 6).
 */

import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import authConfig from "./auth.config";
import { staffMembers } from "./db/schema";
import { db } from "./lib/db";
import { env } from "./lib/env";
import { logger } from "./lib/logger";

// =========================================================================
// Provider list — built dynamically so we don't register Google in dev
// without credentials, and we don't register Credentials in production.
// =========================================================================

const googleEnabled =
  Boolean(env.GOOGLE_OAUTH_CLIENT_ID) && Boolean(env.GOOGLE_OAUTH_CLIENT_SECRET);

// Explicit opt-in for the dev impersonation Credentials provider.
//
// We cannot use `NODE_ENV !== "production"` here: Next.js standalone hard-
// codes NODE_ENV=production at server.js startup, so a `pnpm build && pnpm
// start` flow would always have NODE_ENV=production regardless of the
// underlying environment. The explicit env var means the operator must
// make a deliberate choice to enable impersonation.
//
// Historically we also required `!googleEnabled` as belt-and-suspenders.
// That was removed when an operator got locked out of Google OAuth
// (redirect_uri_mismatch) and needed dev impersonation as an emergency
// fallback — gating on Google's presence made recovery impossible from
// inside the app. The single env var is now the only gate. We surface a
// loud warning banner on the login page (and in server logs) whenever
// dev impersonation is active so it can't quietly stay on.
const devCredentialsEnabled = env.ENABLE_DEV_IMPERSONATION === "1";

// Log loudly at startup when dev impersonation is active. Helps catch
// "oops, that env var was supposed to come off after recovery" cases.
if (devCredentialsEnabled) {
  logger.warn(
    { googleEnabled },
    "⚠️  DEV IMPERSONATION IS ENABLED. Anyone with access to /login can sign in as any active staff member without OAuth. Set ENABLE_DEV_IMPERSONATION=0 (or unset it) and redeploy to disable.",
  );
}

const providers: NonNullable<typeof authConfig.providers> = [];

if (googleEnabled) {
  providers.push(
    Google({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: {
        params: {
          // Restrict to the operator's Google Workspace domain.
          // If GOOGLE_WORKSPACE_DOMAIN is unset, Google won't restrict, but
          // our `signIn` callback still rejects non-staff emails.
          ...(env.GOOGLE_WORKSPACE_DOMAIN && { hd: env.GOOGLE_WORKSPACE_DOMAIN }),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  );
}

if (devCredentialsEnabled) {
  providers.push(
    Credentials({
      id: "dev-staff-impersonate",
      name: "Dev impersonation",
      credentials: {
        email: { label: "Staff primary email", type: "text" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim() : "";
        if (!email) return null;

        const rows = await db
          .select()
          .from(staffMembers)
          .where(eq(staffMembers.primaryEmail, email))
          .limit(1);
        const staff = rows[0];

        if (!staff || staff.status !== "active") {
          logger.warn({ email }, "dev impersonation rejected: no active staff_member match");
          return null;
        }

        logger.info({ staffId: staff.id, email }, "dev impersonation accepted");

        // Returning a User object signals success. NextAuth then runs the
        // jwt callback below with this user, which is where we persist
        // staffId onto the session token.
        return {
          id: staff.id,
          email: staff.primaryEmail,
          name: staff.displayName,
          // Stash role so jwt callback can copy onto token without a
          // second DB hit. NextAuth ignores fields it doesn't know
          // about so this is safe.
          role: staff.role,
        } as { id: string; email: string; name: string; role: string };
      },
    }),
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  secret: env.NEXTAUTH_SECRET,
  providers,

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Runs after a provider authenticates a user but before a session is
     * created. The canonical access-control gate: a sign-in is only allowed
     * if there's an active staff_member with this primary_email.
     *
     * For the Credentials provider, the authorize() above already did this
     * lookup, so user.id is already a staff_member uuid. For Google, we
     * look up here and rewrite user.id.
     */
    async signIn({ user, account }) {
      if (!user.email) {
        logger.warn({ provider: account?.provider }, "sign-in rejected: no email on user");
        return false;
      }

      // Credentials provider already validated and populated user.id with
      // the staff_member uuid — let it through.
      if (account?.provider === "dev-staff-impersonate") {
        return true;
      }

      // Google (and any future OAuth provider): look up staff by email.
      const rows = await db
        .select()
        .from(staffMembers)
        .where(eq(staffMembers.primaryEmail, user.email))
        .limit(1);
      const staff = rows[0];

      if (!staff || staff.status !== "active") {
        logger.warn(
          { email: user.email, provider: account?.provider },
          "sign-in rejected: email is not an active staff_member",
        );
        return false;
      }

      // Rewrite user.id so the jwt callback below stores the staff uuid,
      // not the OAuth provider's account id.
      user.id = staff.id;
      user.name = staff.displayName;
      // Stash role on the user object so the jwt callback below can copy
      // it onto the token without a second DB hit. NextAuth passes
      // arbitrary fields through this object.
      (user as { role?: string }).role = staff.role;
      return true;
    },

    /**
     * Persist staff fields on the JWT. Runs on every sign-in and on every
     * subsequent token refresh. We also lazily upgrade existing sessions
     * that don't have role yet — a one-shot DB lookup the first time the
     * token is refreshed after this code ships.
     */
    async jwt({ token, user, account }) {
      if (user) {
        // First sign-in: persist staffId + provider on token.
        token.staffId = user.id;
        token.provider = account?.provider ?? "unknown";
        const fromUser = (user as { role?: string }).role;
        if (
          fromUser === "admin" ||
          fromUser === "lead" ||
          fromUser === "outreach" ||
          fromUser === "readonly"
        ) {
          token.role = fromUser;
        }
      }
      // Verify the staff_member referenced by this token still exists,
      // and (lazily) backfill role for sessions issued before role was
      // added. Without the existence check, a JWT that outlives its row
      // (e.g. after the staff_members -> users migration TRUNCATE) lands
      // in a redirect loop: middleware sees "valid token" -> passes
      // through /login -> every page-level requireStaff() throws ->
      // redirects to /login -> loop. Clearing identity here invalidates
      // the session at the source so the middleware redirects cleanly.
      if (token.staffId && typeof token.staffId === "string") {
        try {
          const rows = await db
            .select({ role: staffMembers.role })
            .from(staffMembers)
            .where(eq(staffMembers.id, token.staffId))
            .limit(1);
          if (rows.length === 0) {
            logger.warn(
              { staffId: token.staffId },
              "jwt: token references a staff_member that no longer exists; clearing session identity",
            );
            token.staffId = undefined;
            token.role = undefined;
            return token;
          }
          if (!token.role && rows[0]?.role) {
            token.role = rows[0].role;
          }
        } catch (err) {
          // Don't take down logins on a transient DB blip. Keep the
          // token as-is and let the next refresh re-verify.
          logger.warn({ err, staffId: token.staffId }, "jwt: staff lookup failed");
        }
      }
      return token;
    },

    /**
     * Expose the staffId, role, and provider on the session object
     * available in Server Components / Server Actions via `await auth()`.
     *
     * If the jwt callback above cleared staffId (because the underlying
     * staff_member row was deleted), nuke session.user too. Otherwise the
     * default JWT email/name keeps auth.config's `!!auth?.user` check
     * reading as authenticated, and the redirect loop persists even
     * though the identity is gone.
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
      if (token.provider && typeof token.provider === "string") {
        session.provider = token.provider;
      }
      return session;
    },
  },
});

// Expose flags so the login UI knows which providers to render.
export const authProviderStatus = {
  googleEnabled,
  devCredentialsEnabled,
};

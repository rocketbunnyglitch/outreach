"use server";

/**
 * Admin user management actions.
 *
 * - inviteUser: create a users row (with password OR invite token),
 *   optionally send a magic link via Postmark
 * - resetPassword: issue a reset token for an existing user
 * - deactivateUser / reactivateUser: status flip
 * - impersonate: issue a signed grant cookie + redirect to the
 *   admin-impersonate sign-in route
 *
 * All actions require requireAdmin() — non-admins get 404.
 */

import { inviteTokens, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { IMPERSONATION_COOKIE_NAME, issueImpersonationGrant } from "@/lib/impersonation-cookie";
import { generateToken, inviteExpiresAt, resetExpiresAt } from "@/lib/invite-tokens";
import { logger } from "@/lib/logger";
import { hashPassword, validatePassword } from "@/lib/passwords";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ROLES = ["admin", "lead", "outreach", "readonly"] as const;
type Role = (typeof ROLES)[number];

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invite a new user.
 *
 * Two flows, picked by `mode`:
 *   - "set_now": admin provides a password inline. Creates the users
 *     row with passwordHash set; the user can log in immediately.
 *     No invite token is created.
 *   - "send_link": creates the users row with NULL passwordHash and
 *     an invite_tokens row. The raw token is returned to the caller
 *     so they can build the magic link (the admin UI shows it as a
 *     copyable string — sending the actual email is out of scope
 *     for this commit; commit 6 may wire Postmark).
 *
 * Email collisions: if a user with that email already exists,
 * returns { ok: false } — admins should reset that user's password
 * via resetPassword instead.
 */
export async function inviteUser(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{
    userId: string;
    /** Only set for send_link mode; the raw token (not the hash). */
    inviteLinkPath?: string;
  }>
> {
  const ctx = await requireAdmin();
  const adminId = ctx.staff.id;

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "outreach");
  const mode = String(formData.get("mode") ?? "send_link");
  const password = String(formData.get("password") ?? "");

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "A valid email is required." };
  }
  if (!displayName) {
    return { ok: false, error: "Display name is required." };
  }
  if (!isRole(roleRaw)) {
    return { ok: false, error: "Invalid role." };
  }
  const role: Role = roleRaw;

  if (mode !== "set_now" && mode !== "send_link") {
    return { ok: false, error: "Invalid mode." };
  }

  // Reject duplicate email up-front for a clearer error than the
  // unique-index violation below.
  const existing = await withAuditContext(adminId, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.primaryEmail, email)).limit(1),
  );
  if (existing[0]) {
    return {
      ok: false,
      error: "A user with that email already exists. Use 'Send reset' instead.",
    };
  }

  let passwordHash: string | null = null;
  if (mode === "set_now") {
    const v = validatePassword(password);
    if (!v.ok) return v;
    try {
      passwordHash = await hashPassword(password);
    } catch (err) {
      logger.error({ err }, "inviteUser: hashPassword failed");
      return { ok: false, error: "Could not save password. Try again." };
    }
  }

  let inviteRaw: string | null = null;

  try {
    const result = await withAuditContext(adminId, async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({
          displayName,
          primaryEmail: email,
          role,
          status: "active",
          teamId: ctx.staff.teamId,
          passwordHash,
          passwordSetAt: passwordHash ? new Date() : null,
          // If admin sets password directly, no forced change; if the
          // invitee sets it themselves via the magic link, they're
          // already choosing it freshly.
          passwordMustChange: false,
          timezone: ctx.staff.timezone ?? "America/Toronto",
          createdBy: adminId,
          updatedBy: adminId,
        })
        .returning({ id: users.id });
      const u = inserted[0];
      if (!u) throw new Error("insert returning was empty");

      if (mode === "send_link") {
        const tok = generateToken();
        inviteRaw = tok.raw;
        await tx.insert(inviteTokens).values({
          teamId: ctx.staff.teamId,
          email,
          kind: "invite",
          role,
          targetUserId: u.id,
          tokenHash: tok.hash,
          createdBy: adminId,
          expiresAt: inviteExpiresAt(),
        });
      }
      return u;
    });

    revalidatePath("/admin/users");
    logger.info({ adminId, newUserId: result.id, mode }, "inviteUser: created user");
    return {
      ok: true,
      data: {
        userId: result.id,
        inviteLinkPath: inviteRaw ? `/set-password/${inviteRaw}` : undefined,
      },
    };
  } catch (err) {
    logger.error({ err, email }, "inviteUser failed");
    return { ok: false, error: "Could not create user. See server logs." };
  }
}

/**
 * Issue a password-reset token for an existing user. Returns the raw
 * token in the link path so the admin can copy + paste it (or email
 * it out-of-band).
 */
export async function resetUserPassword(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inviteLinkPath: string }>> {
  const ctx = await requireAdmin();
  const targetUserId = String(formData.get("userId") ?? "");
  if (!UUID_RE.test(targetUserId)) return { ok: false, error: "Invalid user id." };

  // Validate the target user is on the same team — defense in depth.
  const rows = await withAuditContext(ctx.staff.id, (tx) =>
    tx
      .select({ id: users.id, email: users.primaryEmail, teamId: users.teamId })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1),
  );
  const target = rows[0];
  if (!target) return { ok: false, error: "User not found." };
  if (target.teamId !== ctx.staff.teamId) {
    return { ok: false, error: "User is on a different team." };
  }

  const tok = generateToken();
  try {
    await withAuditContext(ctx.staff.id, (tx) =>
      tx.insert(inviteTokens).values({
        teamId: ctx.staff.teamId,
        email: target.email,
        kind: "reset",
        role: null,
        targetUserId: target.id,
        tokenHash: tok.hash,
        createdBy: ctx.staff.id,
        expiresAt: resetExpiresAt(),
      }),
    );
    revalidatePath("/admin/users");
    return { ok: true, data: { inviteLinkPath: `/set-password/${tok.raw}` } };
  } catch (err) {
    logger.error({ err, targetUserId }, "resetUserPassword failed");
    return { ok: false, error: "Could not create reset link. See server logs." };
  }
}

/** Flip a user's status. */
export async function setUserStatus(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id." };
  if (status !== "active" && status !== "inactive") {
    return { ok: false, error: "Invalid status." };
  }
  if (userId === ctx.staff.id) {
    return { ok: false, error: "You can't change your own status." };
  }

  try {
    await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .update(users)
        .set({ status, updatedBy: ctx.staff.id })
        .where(and(eq(users.id, userId), eq(users.teamId, ctx.staff.teamId))),
    );
    revalidatePath("/admin/users");
    return { ok: true, data: { id: userId } };
  } catch (err) {
    logger.error({ err, userId }, "setUserStatus failed");
    return { ok: false, error: "Could not update status." };
  }
}

/**
 * Impersonate a user. Sets a signed grant cookie and redirects to
 * the NextAuth `admin-impersonate` sign-in handler, which reads the
 * cookie and issues a session as the target user.
 *
 * The admin SHOULD finish impersonation by signing out + back in as
 * themselves — there's no built-in "end impersonation" yet.
 */
export async function impersonateUser(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const targetUserId = String(formData.get("userId") ?? "");
  if (!UUID_RE.test(targetUserId)) {
    throw new Error("Invalid target user id");
  }
  if (targetUserId === ctx.staff.id) {
    // Impersonating yourself is a no-op; just return.
    redirect("/admin/users?impersonate=self");
  }

  // Verify target is on the same team + active.
  const rows = await withAuditContext(ctx.staff.id, (tx) =>
    tx
      .select({ id: users.id, status: users.status, teamId: users.teamId })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1),
  );
  const target = rows[0];
  if (!target || target.teamId !== ctx.staff.teamId || target.status !== "active") {
    throw new Error("Target user not impersonable");
  }

  const grant = issueImpersonationGrant({
    targetUserId,
    grantedByUserId: ctx.staff.id,
  });

  const jar = await cookies();
  jar.set(grant.name, grant.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: grant.maxAgeSeconds,
    path: "/",
  });

  logger.warn({ adminId: ctx.staff.id, targetUserId }, "impersonation grant issued");

  // Redirect through NextAuth's sign-in callback which will run the
  // admin-impersonate Credentials provider's authorize(), read the
  // cookie, and create the session.
  redirect("/api/auth/signin/admin-impersonate?callbackUrl=/");
}

/** Convenience export so the page can clear a stale grant cookie if needed. */
export const IMPERSONATE_COOKIE = IMPERSONATION_COOKIE_NAME;

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

import { signIn } from "@/auth";
import { inviteTokens, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { issueImpersonationGrant } from "@/lib/impersonation-cookie";
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

  // Run the admin-impersonate Credentials provider directly via the
  // NextAuth v5 server-side signIn helper. The previous approach
  // redirected to /api/auth/signin/admin-impersonate, but in v5 that
  // route renders the default sign-in *page* (no credential fields
  // for this provider, so it dead-ended on a blank form). Calling
  // signIn() here triggers authorize() which reads the grant cookie
  // we just set, then redirects to callbackUrl on success.
  await signIn("admin-impersonate", { redirectTo: "/" });
}

// =========================================================================
// Inline edit actions — admin updates name, email, role, or password on
// any user in their team. All four enforce:
//   - requireAdmin
//   - target user is on the same team_id as the actor
//   - the actor can't downgrade their OWN role (so an admin can't
//     accidentally lock themselves out of admin)
// =========================================================================

export async function updateUserName(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; displayName: string }>> {
  const ctx = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id." };
  if (!displayName) return { ok: false, error: "Display name can't be empty." };
  if (displayName.length > 200) return { ok: false, error: "Display name is too long." };

  try {
    const updated = await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .update(users)
        .set({ displayName, updatedBy: ctx.staff.id })
        .where(and(eq(users.id, userId), eq(users.teamId, ctx.staff.teamId)))
        .returning({ id: users.id, displayName: users.displayName }),
    );
    if (!updated[0]) return { ok: false, error: "User not found on your team." };
    revalidatePath("/admin/users");
    return { ok: true, data: updated[0] };
  } catch (err) {
    logger.error({ err, userId }, "updateUserName failed");
    return { ok: false, error: "Could not update name." };
  }
}

export async function updateUserEmail(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; primaryEmail: string }>> {
  const ctx = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const email = String(formData.get("primaryEmail") ?? "")
    .trim()
    .toLowerCase();
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email." };
  }

  try {
    // Pre-check duplicate: cleaner error than the unique-index violation.
    const conflict = await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.primaryEmail, email), eq(users.teamId, ctx.staff.teamId)))
        .limit(1),
    );
    if (conflict[0] && conflict[0].id !== userId) {
      return { ok: false, error: "Another user on your team already has that email." };
    }

    const updated = await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .update(users)
        .set({ primaryEmail: email, updatedBy: ctx.staff.id })
        .where(and(eq(users.id, userId), eq(users.teamId, ctx.staff.teamId)))
        .returning({ id: users.id, primaryEmail: users.primaryEmail }),
    );
    if (!updated[0]) return { ok: false, error: "User not found on your team." };
    revalidatePath("/admin/users");
    return { ok: true, data: updated[0] };
  } catch (err) {
    logger.error({ err, userId }, "updateUserEmail failed");
    // If the unique-index slips through the pre-check (race), report it.
    if (err instanceof Error && err.message.includes("primary_email")) {
      return { ok: false, error: "That email is already in use." };
    }
    return { ok: false, error: "Could not update email." };
  }
}

export async function updateUserRole(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; role: Role }>> {
  const ctx = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id." };
  if (!isRole(roleRaw)) return { ok: false, error: "Invalid role." };

  // Guard: admin can't strip their OWN admin role. They can ask
  // another admin to do it, but they can't accidentally lock
  // themselves out.
  if (userId === ctx.staff.id && roleRaw !== "admin") {
    return {
      ok: false,
      error: "You can't change your own role away from admin. Ask another admin.",
    };
  }

  try {
    const updated = await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .update(users)
        .set({ role: roleRaw, updatedBy: ctx.staff.id })
        .where(and(eq(users.id, userId), eq(users.teamId, ctx.staff.teamId)))
        .returning({ id: users.id, role: users.role }),
    );
    if (!updated[0]) return { ok: false, error: "User not found on your team." };
    revalidatePath("/admin/users");
    return { ok: true, data: { id: updated[0].id, role: updated[0].role as Role } };
  } catch (err) {
    logger.error({ err, userId }, "updateUserRole failed");
    return { ok: false, error: "Could not update role." };
  }
}

/**
 * Admin sets a new password DIRECTLY on a user (no invite link
 * round-trip). Used when the operator wants to dictate the password
 * out-of-band ("your password is X, please change it next login").
 *
 * The receiving user keeps using whatever password they had until
 * the admin tells them the new one — there's no notification.
 *
 * Self-edit allowed: admins can rotate their own password from this
 * surface too. Future iteration: surface a separate "change my own
 * password" affordance in the user menu so non-admins aren't stuck.
 */
export async function updateUserPassword(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!UUID_RE.test(userId)) return { ok: false, error: "Invalid user id." };

  const v = validatePassword(password);
  if (!v.ok) return v;

  // Defense in depth: the target must be on the actor's team.
  const target = await withAuditContext(ctx.staff.id, (tx) =>
    tx
      .select({ id: users.id, teamId: users.teamId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  );
  if (!target[0] || target[0].teamId !== ctx.staff.teamId) {
    return { ok: false, error: "User not found on your team." };
  }

  let hashed: string;
  try {
    hashed = await hashPassword(password);
  } catch (err) {
    logger.error({ err, userId }, "updateUserPassword: hashPassword failed");
    return { ok: false, error: "Could not save password." };
  }

  try {
    await withAuditContext(ctx.staff.id, (tx) =>
      tx
        .update(users)
        .set({
          passwordHash: hashed,
          passwordSetAt: new Date(),
          passwordMustChange: false,
          updatedBy: ctx.staff.id,
        })
        .where(eq(users.id, userId)),
    );
    revalidatePath("/admin/users");
    return { ok: true, data: { id: userId } };
  } catch (err) {
    logger.error({ err, userId }, "updateUserPassword failed");
    return { ok: false, error: "Could not save password." };
  }
}

/**
 * Revoke a pending invite. Deletes the invite_tokens row AND, if the
 * row was kind='invite' (i.e. created a placeholder user that hasn't
 * accepted yet), soft-deletes the placeholder user too so the email
 * can be re-invited without "already exists" friction.
 *
 * Auth: admin only. Team-scoped — admins can only revoke invites on
 * their own team.
 *
 * Idempotent: if the invite was already accepted or expired and
 * cleaned up, returns ok=true with a noop status.
 */
export async function revokePendingInvite(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ inviteId: string }>> {
  const ctx = await requireAdmin();
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!inviteId) return { ok: false, error: "Missing invite id." };

  try {
    const result = await withAuditContext(ctx.staff.id, async (tx) => {
      const [row] = await tx
        .select({
          id: inviteTokens.id,
          teamId: inviteTokens.teamId,
          kind: inviteTokens.kind,
          targetUserId: inviteTokens.targetUserId,
          acceptedAt: inviteTokens.acceptedAt,
        })
        .from(inviteTokens)
        .where(eq(inviteTokens.id, inviteId))
        .limit(1);
      if (!row) {
        return { noRow: true } as const;
      }
      if (row.teamId !== ctx.staff.teamId) {
        return { offTeam: true } as const;
      }
      if (row.acceptedAt) {
        return { alreadyAccepted: true } as const;
      }

      // Drop the token row.
      await tx.delete(inviteTokens).where(eq(inviteTokens.id, inviteId));
      // For 'invite' kind, also soft-disable the placeholder user
      // (preserves audit history but allows re-invite of the email).
      // For 'reset' kind we leave the user alone — the existing user
      // just hasn't completed their reset.
      if (row.kind === "invite" && row.targetUserId) {
        await tx
          .update(users)
          .set({ status: "inactive", updatedBy: ctx.staff.id })
          .where(eq(users.id, row.targetUserId));
      }
      return { ok: true, kind: row.kind, targetUserId: row.targetUserId } as const;
    });

    if ("noRow" in result) {
      // Already deleted — idempotent success.
      return { ok: true, data: { inviteId } };
    }
    if ("offTeam" in result) {
      return { ok: false, error: "Invite not on your team." };
    }
    if ("alreadyAccepted" in result) {
      return { ok: false, error: "Invite has already been accepted." };
    }

    revalidatePath("/admin/users");
    logger.info(
      { adminId: ctx.staff.id, inviteId, kind: result.kind, targetUserId: result.targetUserId },
      "revokePendingInvite: revoked",
    );
    return { ok: true, data: { inviteId } };
  } catch (err) {
    logger.error({ err, inviteId }, "revokePendingInvite failed");
    return { ok: false, error: "Could not revoke invite." };
  }
}

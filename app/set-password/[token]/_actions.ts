"use server";

import { signIn } from "@/auth";
import { inviteTokens, users } from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { hashToken } from "@/lib/invite-tokens";
import { logger } from "@/lib/logger";
import { hashPassword, validatePassword } from "@/lib/passwords";
import { and, eq, isNull } from "drizzle-orm";
import { isRedirectError } from "next/dist/client/components/redirect-error";

export interface ConsumeResult {
  ok: boolean;
  error?: string;
}

/**
 * Consume an invite or reset token: validate, set the user's password,
 * mark the token accepted, and sign the user in.
 *
 * Idempotent-on-failure: any step that errors leaves the token in
 * its pre-attempt state so the user can retry without burning their
 * link. Only the final atomic "mark accepted + write hash" commits
 * the consumption.
 */
export async function consumeInvite(
  _prev: unknown,
  formData: FormData,
): Promise<ConsumeResult> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) return { ok: false, error: "Missing token." };
  if (password !== confirm) {
    return { ok: false, error: "Passwords don't match." };
  }
  const validation = validatePassword(password);
  if (!validation.ok) return validation;

  const tokenHash = hashToken(token);

  // 1. Look up the invite row.
  const rows = await db
    .select()
    .from(inviteTokens)
    .where(eq(inviteTokens.tokenHash, tokenHash))
    .limit(1);
  const invite = rows[0];

  if (!invite) return { ok: false, error: "Invalid link." };
  if (invite.acceptedAt) return { ok: false, error: "This link has already been used." };
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: "This link has expired." };
  }

  // 2. Hash the password BEFORE the transaction so the bcrypt cost
  //    isn't held inside a Postgres tx (which would hold a row lock
  //    on invite_tokens for 250ms+).
  let hashed: string;
  try {
    hashed = await hashPassword(password);
  } catch (err) {
    logger.error({ err }, "consumeInvite: bcrypt hash threw");
    return { ok: false, error: "Couldn't save the password. Try again." };
  }

  let signInAs: { id: string; email: string } | null = null;

  try {
    // 3. Atomically: claim the token, then set password on target user.
    //    The UPDATE on invite_tokens has a WHERE accepted_at IS NULL
    //    guard so two concurrent submits race-safe (only one wins).
    const result = await withAuditContext(
      invite.createdBy ?? invite.targetUserId ?? null,
      async (tx) => {
        // Claim the token. If accepted_at was concurrently set by
        // another submit, this returns 0 rows.
        const claimed = await tx
          .update(inviteTokens)
          .set({ acceptedAt: new Date() })
          .where(and(eq(inviteTokens.id, invite.id), isNull(inviteTokens.acceptedAt)))
          .returning({ id: inviteTokens.id });
        if (claimed.length === 0) {
          return { ok: false as const, error: "This link was used by another tab. Try signing in." };
        }

        let userId: string;

        if (invite.kind === "reset") {
          // Reset for an existing user.
          if (!invite.targetUserId) {
            return { ok: false as const, error: "Invalid reset token (no target user)." };
          }
          const updated = await tx
            .update(users)
            .set({
              passwordHash: hashed,
              passwordSetAt: new Date(),
              passwordMustChange: false,
              updatedBy: invite.targetUserId,
            })
            .where(eq(users.id, invite.targetUserId))
            .returning({ id: users.id, primaryEmail: users.primaryEmail });
          const u = updated[0];
          if (!u) return { ok: false as const, error: "Account not found." };
          userId = u.id;
        } else {
          // Invite. Either create a new user (no targetUserId) or
          // attach to an already-created stub (targetUserId set when
          // the admin pre-created the row).
          if (invite.targetUserId) {
            const updated = await tx
              .update(users)
              .set({
                passwordHash: hashed,
                passwordSetAt: new Date(),
                passwordMustChange: false,
                updatedBy: invite.targetUserId,
              })
              .where(eq(users.id, invite.targetUserId))
              .returning({ id: users.id });
            const u = updated[0];
            if (!u) return { ok: false as const, error: "Account not found." };
            userId = u.id;
          } else {
            // Create a fresh user row. Display name defaults to the
            // local-part of the email; admins can rename later.
            const displayName = invite.email.split("@")[0] ?? invite.email;
            const role =
              invite.role === "admin" ||
              invite.role === "lead" ||
              invite.role === "outreach" ||
              invite.role === "readonly"
                ? invite.role
                : "outreach";
            const inserted = await tx
              .insert(users)
              .values({
                displayName,
                primaryEmail: invite.email,
                role,
                teamId: invite.teamId,
                passwordHash: hashed,
                passwordSetAt: new Date(),
                passwordMustChange: false,
              })
              .returning({ id: users.id });
            const u = inserted[0];
            if (!u) return { ok: false as const, error: "Could not create user." };
            userId = u.id;
          }
        }

        // Stamp accepted_by_user_id for audit.
        await tx
          .update(inviteTokens)
          .set({ acceptedByUserId: userId })
          .where(eq(inviteTokens.id, invite.id));

        return { ok: true as const, userId };
      },
    );

    if (!result.ok) return result;
    signInAs = { id: result.userId, email: invite.email };
  } catch (err) {
    logger.error({ err, inviteId: invite.id }, "consumeInvite transaction failed");
    return { ok: false, error: "Couldn't save your password. Try again or contact an admin." };
  }

  // 4. Sign in. signIn throws a redirect on success — let it propagate.
  if (signInAs) {
    try {
      await signIn("password", {
        email: signInAs.email,
        password,
        redirectTo: "/",
      });
      // Unreachable on success.
      return { ok: true };
    } catch (err) {
      if (isRedirectError(err)) throw err;
      // Password set succeeded but sign-in failed. Tell the user to
      // go to /login manually — they have a working password now.
      logger.warn(
        { err, userId: signInAs.id },
        "consumeInvite: password set but auto-sign-in failed",
      );
      return {
        ok: false,
        error: "Password saved, but sign-in failed. Try the login page.",
      };
    }
  }

  return { ok: false, error: "Unknown error." };
}

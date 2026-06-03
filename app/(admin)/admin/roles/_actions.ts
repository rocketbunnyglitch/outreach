"use server";

/**
 * Admin -> Roles tab actions. Assign engine FUNCTION-roles (lifecycle owner,
 * wristband coordinator, etc.) to users. System permission roles
 * (Admin/Lead/Outreach/Read-only) are handled by the existing
 * app/(admin)/admin/users/_actions.ts `updateUserRole` (reused by this page).
 *
 * Admin-only.
 */

import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { isEngineRoleKey, setEngineRoleAssignment } from "@/lib/engine-roles";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setEngineRole(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ roleKey: string; userId: string | null }>> {
  const ctx = await requireAdmin();
  const roleKey = String(formData.get("roleKey") ?? "");
  const rawUser = String(formData.get("userId") ?? "");
  const userId = rawUser === "" ? null : rawUser;

  if (!isEngineRoleKey(roleKey)) {
    return { ok: false, error: "Unknown engine role." };
  }
  if (userId !== null && !UUID_RE.test(userId)) {
    return { ok: false, error: "Invalid user." };
  }

  // The assignee must be a user on the admin's team.
  if (userId !== null) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.teamId, ctx.staff.teamId)))
      .limit(1);
    if (!u) return { ok: false, error: "User not found on your team." };
  }

  try {
    await setEngineRoleAssignment({
      teamId: ctx.staff.teamId,
      roleKey,
      userId,
      updatedBy: ctx.staff.id,
    });
    revalidatePath("/admin/roles");
    return { ok: true, data: { roleKey, userId } };
  } catch (err) {
    logger.error({ err, roleKey, userId }, "setEngineRole failed");
    return { ok: false, error: "Could not update role assignment." };
  }
}

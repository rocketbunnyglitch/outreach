/**
 * Engine function-roles (Admin -> Roles tab).
 *
 * The catalogue of engine functions a user can be assigned to (lifecycle owner,
 * wristband coordinator, etc.) plus the resolver the engine uses to find "who
 * currently owns X" from configuration (engine_role_assignments) rather than a
 * hardcoded user id. Reassign anytime via the Roles tab.
 *
 * Distinct from users.role (the system permission role). See migration 0097.
 */

import "server-only";
import { engineRoleAssignments } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export interface EngineRoleDef {
  key: string;
  label: string;
  description: string;
}

/** The assignable engine functions. Add to this list as phases need new roles. */
export const ENGINE_ROLES: EngineRoleDef[] = [
  {
    key: "lifecycle_owner",
    label: "Lifecycle / post-confirm owner",
    description:
      "Default owner of post-confirm emails (T9-T17) and the confirmation cascade. Falls back to the city lead when unassigned.",
  },
  {
    key: "wristband_coordinator",
    label: "Wristband coordinator",
    description: "Owns wristband shipments to venues.",
  },
  {
    key: "host_payment_coordinator",
    label: "Host payments",
    description: "Owns external-host payments.",
  },
  {
    key: "graphics_designer",
    label: "Graphics designer",
    description: "Owns social graphics + poster delivery (T10).",
  },
  {
    key: "campaign_manager",
    label: "Campaign manager",
    description: "Escalation owner for cancellations + cross-campaign decisions.",
  },
];

export const ENGINE_ROLE_KEYS = ENGINE_ROLES.map((r) => r.key);

export function isEngineRoleKey(key: string): boolean {
  return ENGINE_ROLE_KEYS.includes(key);
}

/** All engine-role assignments for a team: role_key -> userId (or null). */
export async function getEngineRoleAssignments(
  teamId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ roleKey: engineRoleAssignments.roleKey, userId: engineRoleAssignments.userId })
    .from(engineRoleAssignments)
    .where(eq(engineRoleAssignments.teamId, teamId));
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.roleKey, r.userId);
  return map;
}

/** The user currently filling a role, or null when unassigned. */
export async function resolveEngineRole(teamId: string, roleKey: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: engineRoleAssignments.userId })
    .from(engineRoleAssignments)
    .where(
      and(eq(engineRoleAssignments.teamId, teamId), eq(engineRoleAssignments.roleKey, roleKey)),
    )
    .limit(1);
  return row?.userId ?? null;
}

/** Upsert an assignment (one user per team x role). user_id null = unassign. */
export async function setEngineRoleAssignment(opts: {
  teamId: string;
  roleKey: string;
  userId: string | null;
  updatedBy: string;
}): Promise<void> {
  await db
    .insert(engineRoleAssignments)
    .values({
      teamId: opts.teamId,
      roleKey: opts.roleKey,
      userId: opts.userId,
      updatedBy: opts.updatedBy,
    })
    .onConflictDoUpdate({
      target: [engineRoleAssignments.teamId, engineRoleAssignments.roleKey],
      set: { userId: opts.userId, updatedBy: opts.updatedBy, updatedAt: new Date() },
    });
}

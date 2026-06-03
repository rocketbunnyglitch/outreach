/**
 * /admin/roles - one place for everything role-related.
 *
 *   1. Engine function-roles: who owns the lifecycle/post-confirm emails,
 *      wristbands, host payments, graphics, etc. The engine reads these
 *      assignments (lib/engine-roles.ts) instead of hardcoding user IDs.
 *   2. System permission roles (Admin/Lead/Outreach/Read-only) per user --
 *      reuses the same UsersTable + updateUserRole as /admin/users.
 *
 * Admin-only via requireAdmin.
 */

import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENGINE_ROLES, getEngineRoleAssignments } from "@/lib/engine-roles";
import { asc, eq } from "drizzle-orm";
import { UsersTable } from "../users/_components/users-table";
import { EngineRolesSection } from "./_components/engine-roles-section";

export const metadata = { title: "Admin · Roles" };
export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const { staff } = await requireAdmin();

  const userRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      primaryEmail: users.primaryEmail,
      role: users.role,
      status: users.status,
      passwordSetAt: users.passwordSetAt,
      lastSignedIn: users.passwordSetAt, // proxy until we add real lastLoginAt
    })
    .from(users)
    .where(eq(users.teamId, staff.teamId))
    .orderBy(asc(users.displayName));

  const assignments = await getEngineRoleAssignments(staff.teamId);
  const engineRoleRows = ENGINE_ROLES.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    userId: assignments.get(r.key) ?? null,
  }));
  const userOptions = userRows
    .filter((u) => u.status === "active")
    .map((u) => ({ id: u.id, displayName: u.displayName, role: u.role }));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Roles</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Assign engine functions to people and set each member's system permission level. The
          engine reads the function assignments, so you can reassign them anytime without touching
          code.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg tracking-tight">Engine function-roles</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Who owns each automated workflow. Unassigned roles fall back to sensible defaults (the
          lifecycle owner falls back to the city lead).
        </p>
        <EngineRolesSection roles={engineRoleRows} users={userOptions} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg tracking-tight">System permission roles</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Admin can change everything; Lead manages crawls; Outreach sends mail; Read-only views.
          Invite + password management lives on the Users page.
        </p>
        <UsersTable currentUserId={staff.id} rows={userRows} />
      </section>
    </div>
  );
}

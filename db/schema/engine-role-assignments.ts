/**
 * engine_role_assignments - who currently fills each engine FUNCTION-role
 * (lifecycle owner, wristband coordinator, host-payment coordinator, graphics,
 * campaign manager), set via the Admin -> Roles tab. The engine resolves these
 * from config (lib/engine-roles.ts) instead of hardcoding user IDs, so an
 * operator can reassign them anytime.
 *
 * Distinct from users.role (system permission role). One row per
 * (team_id, role_key); user_id NULL = unassigned. See migration 0097.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./users";

export const engineRoleAssignments = pgTable(
  "engine_role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Stable engine function-role key (see ENGINE_ROLES in lib/engine-roles.ts). */
    roleKey: text("role_key").notNull(),
    /** User filling the role; NULL = unassigned. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamRoleUnique: uniqueIndex("engine_role_assignments_team_role_unique").on(t.teamId, t.roleKey),
    userIdx: index("engine_role_assignments_user_idx").on(t.userId),
  }),
);

export type EngineRoleAssignment = typeof engineRoleAssignments.$inferSelect;
export type NewEngineRoleAssignment = typeof engineRoleAssignments.$inferInsert;

import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffMembers } from "./users";

/**
 * Autonomy rails (migration 0135): the trust ladder's evidence + policy
 * stores. action_verdicts records the human verdict on every engine
 * proposal; autonomy_policies holds each action type's current rung.
 * Graduation is human-only (admin UI), and dispatch autonomy is
 * additionally env-gated server-side — today everything behaves
 * exactly as before; only evidence accumulates.
 */

export const actionVerdicts = pgTable(
  "action_verdicts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    actionType: text("action_type").notNull(),
    /** 'accepted' | 'edited' | 'rejected' */
    verdict: text("verdict").notNull(),
    subjectId: uuid("subject_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeTimeIdx: index("action_verdicts_type_time_idx").on(table.actionType, table.createdAt),
  }),
);

export const autonomyPolicies = pgTable("autonomy_policies", {
  actionType: text("action_type").primaryKey(),
  /** 'suggest' | 'review_window' | 'auto' — see lib/autonomy.ts */
  mode: text("mode").notNull().default("suggest"),
  reviewWindowMinutes: integer("review_window_minutes").notNull().default(120),
  notes: text("notes"),
  updatedBy: uuid("updated_by").references(() => staffMembers.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

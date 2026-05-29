/**
 * invite_tokens — single-use tokens for two flows:
 *   - new-user invite (admin invites a user, link in email)
 *   - password reset (admin resets, or future self-service)
 *
 * Added in migration 0044. The raw token is never stored — only its
 * SHA-256 hash. The /set-password page does its own hash + lookup.
 */

import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./users";

export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    kind: text("kind").notNull().default("invite"),
    role: text("role"),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("invite_tokens_hash_unique").on(table.tokenHash),
  }),
);

export type InviteToken = typeof inviteTokens.$inferSelect;
export type NewInviteToken = typeof inviteTokens.$inferInsert;

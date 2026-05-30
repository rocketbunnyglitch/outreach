/**
 * email_soft_bounces — per-(team, email) running count of consecutive
 * SOFT bounces, used to escalate persistent transient-failure addresses
 * into permanent suppression. See migration 0053.
 *
 * Soft bounces alone don't suppress (an address may temporarily be in
 * a greylist or have a full mailbox). But when the same address bounces
 * softly N times in a row, the deliverability hit dominates the
 * we-might-recover-it benefit and we promote it to a hard suppression.
 *
 * The hard-bounce path doesn't touch this table — it goes straight to
 * email_suppression with reason='bounced'. This table is ONLY the
 * softer side of the ledger.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const emailSoftBounces = pgTable(
  "email_soft_bounces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    consecutiveCount: integer("consecutive_count").notNull().default(0),
    lastSubject: text("last_subject"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEmailUnique: uniqueIndex("email_soft_bounces_team_email_unique").on(t.teamId, t.email),
    lastSeenIdx: index("email_soft_bounces_last_seen_idx").on(t.lastSeenAt),
  }),
);

export type EmailSoftBounce = typeof emailSoftBounces.$inferSelect;
export type NewEmailSoftBounce = typeof emailSoftBounces.$inferInsert;

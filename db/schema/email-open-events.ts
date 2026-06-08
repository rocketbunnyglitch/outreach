/**
 * email_open_events — append-only log of open-pixel hits (migration 0124).
 *
 * One row per fetch of a tracked message's open pixel. Only OUTBOUND messages
 * on WARM threads ever carry a pixel (see lib/open-tracking-gate.ts), so cold
 * sends never appear here. Opens are a SOFT signal: this table is read for the
 * inbox "Seen" indicator only and must NEVER drive cadence or automation.
 *
 * is_likely_proxy flags opens that arrive suspiciously fast or from a known
 * mail-proxy (Gmail image proxy / Apple Mail Privacy Protection pre-fetch), so
 * an operator isn't misled into treating a proxy pre-fetch as a real human read.
 */

import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { emailMessages } from "./email-messages";

export const emailOpenEvents = pgTable(
  "email_open_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailMessageId: uuid("email_message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** True when the open looks like a mail-proxy pre-fetch, not a human read. */
    isLikelyProxy: boolean("is_likely_proxy").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageIdx: index("email_open_events_message_idx").on(table.emailMessageId),
  }),
);

export type EmailOpenEvent = typeof emailOpenEvents.$inferSelect;
export type NewEmailOpenEvent = typeof emailOpenEvents.$inferInsert;

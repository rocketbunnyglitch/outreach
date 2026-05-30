/**
 * Inbox alert rules + dispatch log. See migration 0054.
 *
 * Rule kinds are text (not pgEnum) so adding new alert types in
 * the future doesn't require a migration. The worker dispatches
 * based on the kind string; unknown kinds are skipped.
 */

import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { connectedAccounts } from "./users";

export const inboxAlertRules = pgTable(
  "inbox_alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    ruleKind: text("rule_kind").notNull(),
    threshold: numeric("threshold").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    channels: text("channels").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountKindUnique: uniqueIndex("inbox_alert_rules_account_kind_unique").on(
      t.connectedAccountId,
      t.ruleKind,
    ),
    accountIdx: index("inbox_alert_rules_account_idx").on(t.connectedAccountId),
  }),
);

export const inboxAlertDispatches = pgTable(
  "inbox_alert_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => inboxAlertRules.id, { onDelete: "cascade" }),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    observedValue: numeric("observed_value").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    notes: text("notes"),
  },
  (t) => ({
    ruleFiredIdx: index("inbox_alert_dispatches_rule_fired_idx").on(t.ruleId, t.firedAt),
  }),
);

export type InboxAlertRule = typeof inboxAlertRules.$inferSelect;
export type NewInboxAlertRule = typeof inboxAlertRules.$inferInsert;
export type InboxAlertDispatch = typeof inboxAlertDispatches.$inferSelect;
export type NewInboxAlertDispatch = typeof inboxAlertDispatches.$inferInsert;

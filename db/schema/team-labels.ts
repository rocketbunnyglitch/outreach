/**
 * Team-scoped label namespace mirroring Gmail labels. See migration
 * 0047 for the table layout. Two-way sync between team_labels and
 * Gmail labels on every connected_account on the team.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { emailThreads } from "./outreach";
import { teams } from "./teams";
import { staffOutreachEmails } from "./users";
import { users } from "./users";

export const teamLabels = pgTable(
  "team_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Tailwind color slug ('emerald', 'rose', 'blue', 'amber', etc).
     *  Null renders neutral zinc. UI picks from a known palette. */
    color: text("color"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    // Case-insensitive uniqueness per team. Index uses lower(name) so
    // direct equality lookups still need to lower() the input first.
    teamNameUnique: uniqueIndex("team_labels_team_name_unique").on(t.teamId, t.name),
  }),
);

export const teamLabelGmailLinks = pgTable(
  "team_label_gmail_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamLabelId: uuid("team_label_id")
      .notNull()
      .references(() => teamLabels.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => staffOutreachEmails.id, { onDelete: "cascade" }),
    /** The Gmail-side label id (e.g. "Label_4923847"). Sent as-is to
     *  gmail.users.threads.modify { addLabelIds, removeLabelIds }. */
    gmailLabelId: text("gmail_label_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("team_label_gmail_links_unique").on(t.teamLabelId, t.connectedAccountId),
    lookup: index("team_label_gmail_links_lookup_idx").on(t.connectedAccountId, t.gmailLabelId),
  }),
);

export const emailThreadLabels = pgTable(
  "email_thread_labels",
  {
    /** Synthetic PK so a thread can have multiple label rows with
     *  different sources (team + gmail) without collision. Added in
     *  migration 0062 to replace the old (thread_id, team_label_id)
     *  composite PK. */
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    /** team-label-direct row when set. Mutually exclusive with
     *  gmailLabelId per the check constraint added in migration
     *  0062. */
    teamLabelId: uuid("team_label_id").references(() => teamLabels.id, {
      onDelete: "cascade",
    }),
    /** Gmail-direct row when set. Must travel with
     *  connectedEmailAccountId since Gmail labels are scoped to
     *  one connected account. */
    gmailLabelId: text("gmail_label_id"),
    connectedEmailAccountId: uuid("connected_email_account_id").references(
      () => staffOutreachEmails.id,
      { onDelete: "cascade" },
    ),
    /** 'engine' for team-label rows; 'gmail' for Gmail-direct
     *  rows. Tracked separately from applied_via so the source
     *  namespace is explicit even after a label is mirrored both
     *  ways. */
    source: text("source").notNull().default("engine"),
    appliedBy: uuid("applied_by").references(() => users.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    /** 'manual' | 'gmail' | 'inherit'. See migration 0047. */
    appliedVia: text("applied_via").notNull().default("manual"),
  },
  (t) => ({
    threadIdx: index("email_thread_labels_thread_idx").on(t.threadId),
    labelIdx: index("email_thread_labels_label_idx").on(t.teamLabelId),
  }),
);

export type TeamLabel = typeof teamLabels.$inferSelect;
export type NewTeamLabel = typeof teamLabels.$inferInsert;
export type TeamLabelGmailLink = typeof teamLabelGmailLinks.$inferSelect;
export type EmailThreadLabel = typeof emailThreadLabels.$inferSelect;

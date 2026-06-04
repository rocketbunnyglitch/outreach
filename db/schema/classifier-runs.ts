/**
 * classifier_runs - audit log of AI inbound-classification runs (Phase 1.13).
 *
 * One row per model classification: which reference-doc sections were retrieved
 * and grounded the prompt, the model's output (classification + confidence), and
 * the model id. Lets us audit that the Reference Doc rules actually drive the
 * classifier and compare behavior across prompt/model versions.
 *
 * Append-only log (no audit/version columns), mirroring the migration's table.
 * See migration 0103. [ReferenceDoc 6.3 + 8.4]
 */

import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { emailMessages } from "./email-messages";
import { replyClassification } from "./enums";
import { emailThreads } from "./outreach";

export const classifierRuns = pgTable(
  "classifier_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    /** Reference-doc section codes retrieved for this run (e.g. 6.3, 8.4). */
    retrievedSectionCodes: text("retrieved_section_codes").array().notNull(),
    classification: replyClassification("classification").notNull(),
    /** 0.000-1.000 model confidence. */
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    model: text("model").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index("classifier_runs_thread_idx").on(table.threadId, table.runAt),
    messageIdx: index("classifier_runs_message_idx").on(table.messageId),
  }),
);

export type ClassifierRun = typeof classifierRuns.$inferSelect;
export type NewClassifierRun = typeof classifierRuns.$inferInsert;

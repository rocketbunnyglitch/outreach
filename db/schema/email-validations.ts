/**
 * email_validations — cached ZeroBounce results so we don't re-validate
 * the same email address forever.
 *
 * Per spec §6.6: validation runs on save when an email is added to a venue
 * record (not at send time). If we've already validated this exact email
 * recently, we skip re-validation.
 *
 * Retention: re-validate after 90 days (handled by the nightly cleanup
 * cron in Phase 8).
 */

import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { emailValidationStatus } from "./enums";

export const emailValidations = pgTable(
  "email_validations",
  {
    ...idColumn,

    // Normalized to lowercase, trimmed before insert.
    email: text("email").notNull(),

    status: emailValidationStatus("status").notNull(),

    // Full ZeroBounce response payload for forensics / re-classification
    // if we change our mapping later.
    rawResponse: jsonb("raw_response"),

    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull().defaultNow(),

    ...auditColumns,
    // No version column — we replace on revalidation.
  },
  (table) => ({
    emailUnique: uniqueIndex("email_validations_email_unique").on(table.email),
    statusIdx: index("email_validations_status_idx").on(table.status),
    validatedAtIdx: index("email_validations_validated_at_idx").on(table.validatedAt),
  }),
);

export type EmailValidation = typeof emailValidations.$inferSelect;
export type NewEmailValidation = typeof emailValidations.$inferInsert;

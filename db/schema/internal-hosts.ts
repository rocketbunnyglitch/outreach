/**
 * Internal Hosts — people on the team paid hourly to run/host crawls.
 *
 * Operator session-12 P3: a table of internal hosts with name, hourly
 * rate, hours worked, computed total, currency, and payout rail.
 *
 * Distinct from external_hosts (contractors with full contact + address
 * + pay details). Internal hosts are lighter-weight — just the payout
 * math for someone already on the team.
 *
 * Money: payRateCents is BIGINT cents (CLAUDE.md money convention).
 * hoursWorked is numeric(6,2) so half-hours work. The TOTAL is derived
 * (rate × hours) in the query/UI, NOT stored — single source of truth.
 */

import { bigint, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn } from "../types";
import { paymentMethod } from "./enums";

export const internalHosts = pgTable("internal_hosts", {
  ...idColumn,

  /** Host's display name. */
  name: text("name").notNull(),

  /** Hourly rate in minor units (cents) of `currency`. */
  payRateCents: bigint("pay_rate_cents", { mode: "number" }).notNull().default(0),

  /** Hours worked this period. numeric so 5.5h etc. are representable. */
  hoursWorked: numeric("hours_worked", { precision: 6, scale: 2 }).notNull().default("0"),

  /** ISO 4217 currency code, e.g. CAD / USD / PHP. */
  currency: text("currency").notNull().default("CAD"),

  /** Payout rail. */
  paymentMethod: paymentMethod("payment_method"),

  /** Free-text payment handle/details (e.g. Venmo @handle, e-transfer email). */
  paymentDetails: text("payment_details"),

  notes: text("notes"),

  ...auditColumns,
  ...archivedAt,
});

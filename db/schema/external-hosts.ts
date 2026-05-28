/**
 * External Hosts — contractors (not on the team) paid to host crawls.
 *
 * Operator session-12 P3: "External hosts table (full name, email,
 * phone, pay rate/hr, currency, full address, payment method, payment
 * contact)."
 *
 * Heavier than internal_hosts: external hosts need full contact +
 * mailing address + a payment contact (the person/handle to send money
 * to, which may differ from the host). Shares the payment_method enum
 * with internal_hosts.
 *
 * Money: payRateCents BIGINT cents (CLAUDE.md money convention).
 */

import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn } from "../types";
import { paymentMethod } from "./enums";

export const externalHosts = pgTable("external_hosts", {
  ...idColumn,

  /** Full legal/display name. */
  fullName: text("full_name").notNull(),

  email: text("email"),
  /** E.164 phone. */
  phoneE164: text("phone_e164"),

  /** Hourly rate in minor units (cents) of `currency`. */
  payRateCents: bigint("pay_rate_cents", { mode: "number" }).notNull().default(0),

  /** ISO 4217 currency code (CAD / USD / PHP / …). */
  currency: text("currency").notNull().default("USD"),

  /** Full mailing address (free text — international, multi-line). */
  address: text("address"),

  /** Payout rail. */
  paymentMethod: paymentMethod("payment_method"),

  /** Who/what to pay — handle, email, or contact name for payment. */
  paymentContact: text("payment_contact"),

  notes: text("notes"),

  ...auditColumns,
  ...archivedAt,
});

/**
 * SMS subsystem (Twilio) -- Phase 5.2/5.3.
 *
 * Three tables:
 *   - sms_messages    : every outbound + inbound SMS (audit log, parity with
 *                       email_messages / outreach_log). Outbound rows are
 *                       written by lib/sms.ts sendSms() BEFORE the provider call
 *                       so we always have a record of what was (or would be)
 *                       sent. When Twilio is not configured the row lands with
 *                       status='unconfigured' (inert dry-run visibility).
 *   - sms_consent_log : append-only opt-in / STOP / START / HELP events for
 *                       A2P 10DLC compliance.
 *   - host_sms_log    : per (external host, event, H-touch) idempotency +
 *                       response tracking for the host SMS cadence (5.4).
 *
 * Direction / status / kind are text columns with a TS $type union rather than
 * pgEnums so this module stays self-contained (no shared enums.ts edit, no
 * separate enum migration). Values are documented inline.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { outreachBrands } from "./brands";
import { campaigns } from "./campaigns";
import { cityCampaigns } from "./city-campaigns";
import { events } from "./events";
import { externalHosts } from "./external-hosts";
import { venues } from "./venues";

/** What an outbound SMS is for. Mirrors lib/sms.ts SmsKind. */
export type SmsKind =
  | "host_cadence"
  | "lineup_change"
  | "payment"
  | "post_event"
  | "manual"
  | "system";

export const smsMessages = pgTable(
  "sms_messages",
  {
    ...idColumn,

    direction: text("direction").$type<"inbound" | "outbound">().notNull(),
    provider: text("provider").notNull().default("twilio"),
    /** Twilio Message SID. Null when inert (unconfigured) or before send. */
    providerSid: text("provider_sid"),

    fromE164: text("from_e164"),
    toE164: text("to_e164").notNull(),
    body: text("body").notNull(),

    /** queued | sent | delivered | failed | unconfigured | received */
    status: text("status").notNull().default("queued"),
    kind: text("kind").$type<SmsKind>().notNull(),

    externalHostId: uuid("external_host_id").references(() => externalHosts.id, {
      onDelete: "set null",
    }),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
    cityCampaignId: uuid("city_campaign_id").references(() => cityCampaigns.id, {
      onDelete: "set null",
    }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    outreachBrandId: uuid("outreach_brand_id").references(() => outreachBrands.id, {
      onDelete: "set null",
    }),
    relatedEventId: uuid("related_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    /** User who triggered the send (null for system/cron-driven). */
    staffId: uuid("staff_id"),

    sentAt: timestamp("sent_at", { withTimezone: true }),

    ...auditColumns,
  },
  (table) => ({
    directionCreatedIdx: index("sms_messages_direction_created_idx").on(
      table.direction,
      table.createdAt,
    ),
    hostIdx: index("sms_messages_host_idx").on(table.externalHostId),
    toIdx: index("sms_messages_to_idx").on(table.toE164),
    // Unique on the Twilio SID for delivery-status dedup. Postgres treats
    // NULLs as distinct, so the many unconfigured/pre-send NULL rows coexist.
    providerSidUnique: uniqueIndex("sms_messages_provider_sid_unique").on(table.providerSid),
  }),
);

export const smsConsentLog = pgTable(
  "sms_consent_log",
  {
    ...idColumn,

    phoneE164: text("phone_e164").notNull(),
    /** opt_in | stop | start | help */
    action: text("action").$type<"opt_in" | "stop" | "start" | "help">().notNull(),
    /** inbound_webhook | manual | host_assign | system */
    source: text("source").notNull().default("system"),
    externalHostId: uuid("external_host_id").references(() => externalHosts.id, {
      onDelete: "set null",
    }),
    note: text("note"),

    ...auditColumns,
  },
  (table) => ({
    phoneIdx: index("sms_consent_log_phone_idx").on(table.phoneE164, table.createdAt),
  }),
);

export const hostSmsLog = pgTable(
  "host_sms_log",
  {
    ...idColumn,

    externalHostId: uuid("external_host_id")
      .notNull()
      .references(() => externalHosts.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** H1 | H2 | H3 | H4 | H5 */
    touchCode: text("touch_code").$type<"H1" | "H2" | "H3" | "H4" | "H5">().notNull(),
    smsMessageId: uuid("sms_message_id").references(() => smsMessages.id, {
      onDelete: "set null",
    }),
    /** sent | unconfigured | responded | escalated | failed */
    status: text("status").notNull().default("sent"),
    responseBody: text("response_body"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),

    ...auditColumns,
  },
  (table) => ({
    hostEventTouchUnique: uniqueIndex("host_sms_log_host_event_touch_unique").on(
      table.externalHostId,
      table.eventId,
      table.touchCode,
    ),
    eventIdx: index("host_sms_log_event_idx").on(table.eventId),
  }),
);

export type SmsMessage = typeof smsMessages.$inferSelect;
export type NewSmsMessage = typeof smsMessages.$inferInsert;
export type SmsConsentLogRow = typeof smsConsentLog.$inferSelect;
export type NewSmsConsentLogRow = typeof smsConsentLog.$inferInsert;
export type HostSmsLogRow = typeof hostSmsLog.$inferSelect;
export type NewHostSmsLogRow = typeof hostSmsLog.$inferInsert;

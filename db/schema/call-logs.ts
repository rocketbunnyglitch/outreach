/**
 * Call logs — live-support telephony.
 *
 * Every inbound (and optionally outbound) call we hear about from a provider
 * (Quo today; Viber later) lands here, matched or not. Unmatched calls are
 * kept deliberately so the support tab can surface them prominently during
 * active crawl windows. Distinct from outreach_log, which is the cold-outreach
 * attribution trail; this is the raw operational call record.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns, idColumn } from "../types";
import { callDirection, callMatchType } from "./enums";
import { staffMembers } from "./users";
import { venues } from "./venues";

export const callLogs = pgTable(
  "call_logs",
  {
    ...idColumn,

    /** Provider slug — "quo" | "viber". Text (not enum) to add providers freely. */
    provider: text("provider").notNull().default("quo"),
    /** Provider's call id — idempotency key for webhook retries. */
    externalId: text("external_id"),

    direction: callDirection("direction").notNull().default("incoming"),
    fromE164: text("from_e164"),
    toE164: text("to_e164"),
    callerName: text("caller_name"),
    /** Provider status string (e.g. completed, missed, voicemail). */
    status: text("status"),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    // Match result — how the caller was attributed.
    matchType: callMatchType("match_type").notNull().default("none"),
    matchedVenueId: uuid("matched_venue_id").references(() => venues.id, { onDelete: "set null" }),
    matchedStaffId: uuid("matched_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    /** Area code captured for the weak area-code fallback. Never confirmed. */
    areaCode: text("area_code"),

    ...auditColumns,
  },
  (table) => ({
    externalUnique: uniqueIndex("call_logs_external_unique").on(table.externalId),
    occurredAtIdx: index("call_logs_occurred_at_idx").on(table.occurredAt),
    matchTypeIdx: index("call_logs_match_type_idx").on(table.matchType),
    matchedVenueIdx: index("call_logs_matched_venue_idx").on(table.matchedVenueId),
    fromIdx: index("call_logs_from_idx").on(table.fromE164),
  }),
);

export type CallLog = typeof callLogs.$inferSelect;
export type NewCallLog = typeof callLogs.$inferInsert;

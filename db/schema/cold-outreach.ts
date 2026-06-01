/**
 * cold_outreach_entries — per-city-campaign cold pipeline tracker.
 *
 * One row per (city_campaign, venue). Status drives the cold outreach
 * table on the city sheet. ZeroBounce result for each venue's email is
 * read from the existing email_validations table at render time — no
 * column duplication here.
 */

import {
  boolean,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn } from "../types";
import { cityCampaigns } from "./city-campaigns";
import { staffMembers } from "./users";
import { venues } from "./venues";

export const coldOutreachStatus = pgEnum("cold_outreach_status", [
  "not_contacted",
  "email_sent",
  "follow_up_due",
  "called",
  "voicemail",
  "no_answer",
  "interested",
  "declined",
  "bad_email",
  "wrong_number",
  "do_not_contact",
  // Auto-set when 5+ unanswered call attempts pile up. Distinct from
  // do_not_contact (operator-set when the venue explicitly opted out).
  // See migration 0024 + the auto-cap logic in quo-actions.ts.
  "unreachable",
]);

export const coldOutreachEntries = pgTable(
  "cold_outreach_entries",
  {
    ...idColumn,

    cityCampaignId: uuid("city_campaign_id")
      .notNull()
      .references(() => cityCampaigns.id, { onDelete: "cascade" }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    status: coldOutreachStatus("status").notNull().default("not_contacted"),

    /**
     * Warm-leads flag (migration 0082). Independent from `status`:
     *   - cold table view: all rows regardless (mass outreach queue)
     *   - warm table view: WHERE is_warm = true
     *
     * Operator workflow:
     *   - "Promote to warm" sets is_warm=true; the row stays visible
     *     in cold (continues mass outreach) AND appears in warm.
     *   - "Remove from warm" sets is_warm=false; the row stays in
     *     cold with whatever status it had.
     *   - Status transitions to terminal states (declined /
     *     do_not_contact / bad_email / wrong_number) auto-clear
     *     is_warm — they're not warm anymore by definition.
     *
     * Pre-0082 history: warm-ness was encoded as status='interested',
     * which DROPPED the row from cold view (since cold view filters
     * status != 'interested'). The 0082 backfill set is_warm=true on
     * every existing status='interested' row so the migration is
     * lossless.
     */
    isWarm: boolean("is_warm").notNull().default(false),

    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),

    remarks: text("remarks"),

    lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),

    /**
     * Escalation workflow (migration 0027). When an outreach staffer
     * decides a conversation needs a more senior person — typically
     * Brandon — they escalate the entry. The three columns below mark
     * the cold-outreach row as "needs <staff>'s attention" and feed:
     *   - an auto-created task assigned to that staff member
     *   - an email notification to that staffer's email on file
     *   - a dashboard widget showing pending escalations
     *   - a filter chip on the cold-outreach table so any staffer can
     *     see what's currently with the escalation owner
     *
     * Cleared by un-escalating (action sets all three to NULL) or by
     * the task being completed (handled in app, not DB-cascaded — the
     * historical record stays on the entry so engineers can audit
     * "this was escalated, then completed, then escalated again").
     */
    escalatedToStaffId: uuid("escalated_to_staff_id").references(() => staffMembers.id, {
      onDelete: "set null",
    }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    /** Free-text context: "wants a call at 7pm Tue, asking about insurance" */
    escalationNotes: text("escalation_notes"),

    /**
     * AI lead scoring (Haiku ROI #5). 0..100 conversion-likelihood
     * score with a 1-line reason. Drives the default sort on the
     * cold-outreach worksheet so operators work the highest-signal
     * rows first. NULL = not scored yet. See lib/ai-lead-score.ts
     * for the prompt + caching rules.
     *
     * Migration 0077.
     */
    aiLeadScore: smallint("ai_lead_score"),
    aiLeadScoreReason: text("ai_lead_score_reason"),
    aiLeadScoreAt: timestamp("ai_lead_score_at", { withTimezone: true }),

    ...archivedAt,
    ...auditColumns,
  },
  (table) => ({
    ccVenueUnique: uniqueIndex("cold_outreach_entries_cc_venue_unique").on(
      table.cityCampaignId,
      table.venueId,
    ),
    statusIdx: index("cold_outreach_entries_status_idx").on(table.cityCampaignId, table.status),
    assignedIdx: index("cold_outreach_entries_assigned_idx").on(table.assignedStaffId),
    // Partial index from migration 0027 — only escalated rows. Cheap
    // because escalations are sparse (<5% of all entries at any time).
    escalatedToIdx: index("cold_outreach_entries_escalated_to_idx").on(
      table.escalatedToStaffId,
      table.escalatedAt,
    ),
    /** Drives default-sort on the cold-outreach worksheet —
     *  highest-scoring venues bubble up. NULLs last. */
    aiLeadScoreIdx: index("cold_outreach_entries_ai_lead_score_idx").on(
      table.cityCampaignId,
      table.aiLeadScore,
    ),
    /** Partial index over is_warm=true rows — used by the warm-leads
     *  panel filter. Sparse (most rows are cold). See migration 0082. */
    warmIdx: index("cold_outreach_entries_warm_idx").on(table.cityCampaignId, table.isWarm),
  }),
);

export type ColdOutreachEntry = typeof coldOutreachEntries.$inferSelect;
export type NewColdOutreachEntry = typeof coldOutreachEntries.$inferInsert;

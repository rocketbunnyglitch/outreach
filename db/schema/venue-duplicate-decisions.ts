import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { venues } from "./venues";

/**
 * Human rulings on candidate duplicate venue pairs (migration 0138,
 * CRM plan D1). One row per ORDERED pair (low uuid first):
 *   - 'not_duplicate' / 'same_org' suppress future duplicate warnings
 *     for the pair (decisions are remembered — no re-warning),
 *   - 'merged' documents that the pair was merged (source archived,
 *     venues.merged_into_venue_id points at the survivor).
 */
export const venueDuplicateDecisions = pgTable(
  "venue_duplicate_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueLowId: uuid("venue_low_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    venueHighId: uuid("venue_high_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    /** 'merged' | 'same_org' | 'not_duplicate' */
    decision: text("decision").notNull(),
    reason: text("reason"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairUnique: uniqueIndex("venue_duplicate_decisions_pair_unique").on(
      t.venueLowId,
      t.venueHighId,
    ),
    highIdx: index("venue_duplicate_decisions_high_idx").on(t.venueHighId),
  }),
);

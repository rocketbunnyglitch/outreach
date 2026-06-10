import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { cityCampaigns } from "./city-campaigns";
import { events } from "./events";
import { staffMembers } from "./users";

/**
 * Who finalized each crawl -- i.e. confirmed the venue that filled the LAST
 * required slot, completing the lineup (migration 0133). One row per event,
 * first finalizer wins (insert is ON CONFLICT DO NOTHING). Powers the
 * "%name% finalized %city%!" quick-win broadcast and the admin
 * finalized-crawls leaderboard.
 */
export const crawlFinalizations = pgTable(
  "crawl_finalizations",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staffMembers.id, { onDelete: "set null" }),
    cityCampaignId: uuid("city_campaign_id").references(() => cityCampaigns.id, {
      onDelete: "set null",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    staffIdx: index("crawl_finalizations_staff_idx").on(table.staffId, table.finalizedAt),
  }),
);

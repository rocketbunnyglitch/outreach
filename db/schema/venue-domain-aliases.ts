/**
 * Venue domain aliases -- per-venue list of email DOMAINS that belong
 * to the venue's brand / parent group, for cross-domain sender
 * matching.
 *
 * Motivation: venues.alternate_emails already handles the "this exact
 * address is also Lavelle" case. This table handles the broader
 * "anyone @ this DOMAIN is part of Lavelle" case -- e.g. Lavelle's
 * official site is lavellenyc.com but its manager emails from
 * @taohospitalitygroup.com (Tao owns Lavelle). Marking
 * taohospitalitygroup.com as an alias of the Lavelle venue lets the
 * matcher attach those threads automatically instead of forcing a
 * manual attach every time.
 *
 * The (venue_id, domain) unique index is intentional: a venue can have
 * many aliased domains, but the same domain can only appear once per
 * venue. A domain MAY repeat across venue rows when two venues
 * genuinely share a parent group (rare) -- the matcher surfaces all
 * matches in that case rather than picking one.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "../types";
import { users } from "./users";
import { venues } from "./venues";

export const venueDomainAliases = pgTable(
  "venue_domain_aliases",
  {
    ...idColumn,

    // Owning venue. Cascade so aliases vanish with the venue.
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),

    // Normalized host: lowercase, no leading "@", no path/port.
    // e.g. "taohospitalitygroup.com".
    domain: text("domain").notNull(),

    // Optional operator note explaining the relationship
    // ("Tao owns Lavelle").
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // Who added it. Nullable + ON DELETE SET NULL so removing a user
    // doesn't take their aliases with them.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    venueDomainUnique: uniqueIndex("venue_domain_aliases_venue_domain_unique").on(
      table.venueId,
      table.domain,
    ),
    domainIdx: index("venue_domain_aliases_domain_idx").on(table.domain),
  }),
);

/**
 * Brand entities — the two-brand-type model (CLAUDE.md §2, DECISIONS.md#010).
 *
 * OutreachBrand: operational, venue-facing. Eventsperse, [TBD-2].
 *   Owns email infrastructure (Postmark account, sender signatures, Gmail
 *   accounts via staff_outreach_emails), email signature template, Quo line.
 *   No website, no public assets, no ticket-buyer identity.
 *
 * CrawlBrand: public, customer-facing. Fright Crawl, Trick or Drink, etc.
 *   Owns public domain, Eventbrite organization, poster template, public
 *   JSON API branding fields. Geography-scoped (toronto | international).
 *
 * Every Campaign FKs to both. Conflating them is the most likely way to
 * produce wrong sends — see CLAUDE.md §2 and §7.
 *
 * Encrypted columns (Postmark tokens, Eventbrite tokens): stored as text;
 * encrypted via lib/crypto.ts at the app layer before write, decrypted on
 * read. The schema does not enforce encryption — the codebase does.
 */

import {
  boolean,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { crawlBrandGeography, crawlBrandStatus, holidayType, outreachBrandStatus } from "./enums";

// =========================================================================
// outreach_brands
// =========================================================================

export const outreachBrands = pgTable(
  "outreach_brands",
  {
    ...idColumn,
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),

    // Operational email infrastructure
    emailDomain: text("email_domain").notNull(), // e.g. "eventsperse.com"
    postmarkAccountId: text("postmark_account_id"),
    postmarkServerToken: text("postmark_server_token"), // encrypted
    postmarkSenderSignature: text("postmark_sender_signature"), // e.g. "hello@eventsperse.com"

    // Email signature for staff cold outreach
    emailSignatureHtml: text("email_signature_html"),
    emailSignatureText: text("email_signature_text"),

    // Shared phone line shown in signature; per-staff lines may override
    quoLineE164: text("quo_line_e164"),

    // Shared Viber account used by the 2-3 outreach staff for venues in
    // regions Quo can't service well (PH, parts of MENA, Eastern Europe).
    // The Viber app on the operator's device handles routing — this
    // column is the operational record of which number is dialed FROM.
    viberLineE164: text("viber_line_e164"),

    // Reputation isolation lifecycle
    status: outreachBrandStatus("status").notNull().default("active"),

    /**
     * Outreach phase (1-4) — the staged-rollout lifecycle:
     *   1 = Draft-assist (staff manually sends each email)
     *   2 = Controlled send (engine spaces sends across the day)
     *   3 = Auto follow-ups (stops on reply/bounce/decline/unsubscribe)
     *   4 = Transactional auto (confirmations + posters + info sheets)
     * Per-brand so a mature brand can be at Phase 4 while a new one
     * stays at Phase 1. The send composer and bulk-send UI check this
     * before enabling automated behaviors.
     */
    outreachPhase: smallint("outreach_phase").notNull().default(1),
    outreachPhaseSetAt: timestamp("outreach_phase_set_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    outreachPhaseSetBy: uuid("outreach_phase_set_by"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    slugUnique: uniqueIndex("outreach_brands_slug_unique").on(table.slug),
    emailDomainUnique: uniqueIndex("outreach_brands_email_domain_unique").on(table.emailDomain),
    statusIdx: index("outreach_brands_status_idx").on(table.status),
  }),
);

// =========================================================================
// crawl_brands
// =========================================================================

export const crawlBrands = pgTable(
  "crawl_brands",
  {
    ...idColumn,
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),

    // What holiday this brand serves. A single holiday can have multiple
    // CrawlBrands (e.g. Toronto-only "Trick or Drink" + international
    // "Fright Crawl" both serve Halloween).
    holidayType: holidayType("holiday_type").notNull(),

    // Geographic scope. Enforces at the app layer that you can't run a
    // Toronto-only brand in a non-Toronto city.
    geography: crawlBrandGeography("geography").notNull(),

    // Public-facing identity
    publicDomain: text("public_domain"), // e.g. "frightcrawl.com"
    logoUrl: text("logo_url"),
    primaryColorHex: text("primary_color_hex"), // "#ff6b35"
    accentColorHex: text("accent_color_hex"),
    tagline: text("tagline"),
    publicFooterText: text("public_footer_text"),

    // Eventbrite organization (one org per CrawlBrand). Encrypted tokens.
    eventbriteOrganizationId: text("eventbrite_organization_id"),
    eventbriteApiToken: text("eventbrite_api_token"),

    // Whether ticket buyers are currently being sold to under this brand
    status: crawlBrandStatus("status").notNull().default("active"),

    // Whether the engine should regenerate public assets for this brand.
    // Toggle off during reputation reset.
    publicAssetsEnabled: boolean("public_assets_enabled").notNull().default(true),

    // Default outreach brand to use when planning a new campaign under
    // this crawl brand. Nullable — campaigns can be assigned independently.
    defaultOutreachBrandId: uuid("default_outreach_brand_id").references(() => outreachBrands.id),

    // Version tracking for per-brand assets (poster templates, public footer,
    // etc.). Bumped via admin UI when assets change. See DECISIONS.md#10.4.
    templateVersion: text("template_version").notNull().default("v1"),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    slugUnique: uniqueIndex("crawl_brands_slug_unique").on(table.slug),
    holidayGeographyIdx: index("crawl_brands_holiday_geography_idx").on(
      table.holidayType,
      table.geography,
    ),
    statusIdx: index("crawl_brands_status_idx").on(table.status),
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type OutreachBrand = typeof outreachBrands.$inferSelect;
export type NewOutreachBrand = typeof outreachBrands.$inferInsert;
export type CrawlBrand = typeof crawlBrands.$inferSelect;
export type NewCrawlBrand = typeof crawlBrands.$inferInsert;

/**
 * Schema barrel. Import from `@/db/schema` rather than reaching into
 * individual files. Drizzle-kit reads this to discover all tables.
 *
 * Layout (CLAUDE.md should be updated if this changes):
 *
 *   enums.ts            — all pgEnum definitions
 *   brands.ts           — outreach_brands, crawl_brands (DECISIONS.md#010)
 *   staff.ts            — staff_members, staff_outreach_emails
 *   geography.ts        — countries, cities
 *   campaigns.ts        — campaigns
 *   city-campaigns.ts   — city_campaigns junction
 *   events.ts           — events
 *   venues.ts           — venues (PostGIS)
 *   venue-events.ts     — venue_events junction
 *   outreach.ts         — outreach_log, email_threads, reply_inbox
 *   wristbands.ts       — wristbands
 *   tasks.ts            — tasks
 *   notes.ts            — notes
 *   info-sheets.ts      — staff_info_sheets
 *   templates.ts        — email_templates, poster_templates
 *   email-validations.ts — email_validations
 *   goals.ts            — goals
 *   financial.ts        — financial_lines
 *   saved-filters.ts    — saved_filters
 *   audit.ts            — audit_log
 */

export * from "./enums";
export * from "./brands";
export * from "./staff";
export * from "./geography";
export * from "./campaigns";
export * from "./city-campaigns";
export * from "./middle-venue-groups";
export * from "./events";
export * from "./venues";
export * from "./venue-events";
export * from "./outreach";
export * from "./wristbands";
export * from "./tasks";
export * from "./notes";
export * from "./note-action-suggestions";
export * from "./info-sheets";
export * from "./templates";
export * from "./email-validations";
export * from "./goals";
export * from "./financial";
export * from "./saved-filters";
export * from "./audit";

/**
 * Email templates (per OutreachBrand × stage) and poster templates
 * (per CrawlBrand). Per the two-brand-type model (DECISIONS.md#010):
 *
 *   - Emails are sent BY outreach brands → email_templates FK to outreach_brands
 *   - Posters carry the CRAWL brand's visual identity → poster_templates FK to crawl_brands
 *
 * Merge fields are template-specific. Some examples:
 *   {{venue.name}}, {{venue.city}}, {{event.date}}, {{slot.start}},
 *   {{outreach_brand.name}}, {{outreach_brand.signature}},
 *   {{crawl_brand.name}}, {{staff.first_name}}.
 */

import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, auditColumns, idColumn, versionColumn } from "../types";
import { crawlBrands, outreachBrands } from "./brands";
import { emailTemplateStage } from "./enums";

// =========================================================================
// email_templates
// =========================================================================

export const emailTemplates = pgTable(
  "email_templates",
  {
    ...idColumn,

    outreachBrandId: uuid("outreach_brand_id")
      .notNull()
      .references(() => outreachBrands.id, { onDelete: "cascade" }),

    stage: emailTemplateStage("stage").notNull(),
    name: text("name").notNull(), // e.g. "Default cold v2", "Aggressive follow-up"

    // Templates are rendered server-side. We store both HTML and plain-text
    // variants; the sender picks based on the recipient or includes both
    // in a multipart message.
    subjectTemplate: text("subject_template").notNull(),
    bodyTemplateHtml: text("body_template_html"),
    bodyTemplateText: text("body_template_text").notNull(),

    // Sample merge values for previewing the template in admin UI.
    mergeFieldExamples: jsonb("merge_field_examples"),

    // Whether this template is the brand's default for its stage. The
    // cadence engine picks the default when sending automatic follow-ups.
    isDefaultForStage: boolean("is_default_for_stage").notNull().default(false),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    brandStageNameUnique: uniqueIndex("email_templates_brand_stage_name_unique").on(
      table.outreachBrandId,
      table.stage,
      table.name,
    ),
    brandStageIdx: index("email_templates_brand_stage_idx").on(table.outreachBrandId, table.stage),
    defaultIdx: index("email_templates_default_idx").on(table.isDefaultForStage),
  }),
);

// =========================================================================
// poster_templates
// =========================================================================

export const posterTemplates = pgTable(
  "poster_templates",
  {
    ...idColumn,

    crawlBrandId: uuid("crawl_brand_id")
      .notNull()
      .references(() => crawlBrands.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    // Puppeteer renders this HTML against a viewport sized for poster output.
    // Merge fields injected before render.
    htmlTemplate: text("html_template").notNull(),

    // Optional preview rendered at template-save time, displayed in admin UI.
    previewUrl: text("preview_url"),

    isDefault: boolean("is_default").notNull().default(false),

    ...archivedAt,
    ...auditColumns,
    ...versionColumn,
  },
  (table) => ({
    brandNameUnique: uniqueIndex("poster_templates_brand_name_unique").on(
      table.crawlBrandId,
      table.name,
    ),
    brandDefaultIdx: index("poster_templates_brand_default_idx").on(
      table.crawlBrandId,
      table.isDefault,
    ),
  }),
);

// =========================================================================
// Inferred types
// =========================================================================

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
export type PosterTemplate = typeof posterTemplates.$inferSelect;
export type NewPosterTemplate = typeof posterTemplates.$inferInsert;

/**
 * Seed script — populates a fresh database with placeholder data so the
 * dev environment is workable without waiting for real brand details
 * (OPEN_QUESTIONS.md#Q005, #Q020).
 *
 * Run via:  pnpm db:seed
 *
 * Idempotent: uses ON CONFLICT DO NOTHING on natural keys (slugs, ISO
 * codes) so running it twice is a no-op.
 *
 * What gets seeded:
 *   - Countries: CA, US, GB (the operating geographies)
 *   - Cities: Toronto, NYC, London (one per country) with proper TZs
 *   - OutreachBrand: Eventsperse placeholder (real Postmark token NOT set)
 *   - All 6 CrawlBrands: Fright Crawl, Trick or Drink, Midnight Pass,
 *     The Drop Pass, StPaddysCrawl, The Clover Crawl
 *   - 4 staff members: Bryle, JC, Yasue, Brandon
 *
 * What does NOT get seeded (waiting on real data):
 *   - Real Postmark tokens, Eventbrite org IDs, encrypted secrets
 *   - Brand domains, colors, taglines (#Q005)
 *   - The second OutreachBrand (#Q020)
 *   - Campaigns, venues, events (operational data, not seed data)
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { countries, crawlBrands, outreachBrands, staffMembers } from "../db/schema";
import { db } from "../lib/db";

async function seedCountries() {
  await db
    .insert(countries)
    .values([
      { code: "CA", name: "Canada", defaultCurrency: "CAD" },
      { code: "US", name: "United States", defaultCurrency: "USD" },
      { code: "GB", name: "United Kingdom", defaultCurrency: "GBP" },
    ])
    .onConflictDoNothing();
}

async function seedCities() {
  // Cities use a composite uniqueness on (country, region, name). We
  // insert with ON CONFLICT DO NOTHING via raw SQL since Drizzle's
  // onConflict targets need explicit column lists.
  await db.execute(sql`
    INSERT INTO cities (country_code, name, region, timezone, location)
    VALUES
      ('CA', 'Toronto',  'Ontario',  'America/Toronto',  ST_GeogFromText('SRID=4326;POINT(-79.3832 43.6532)')),
      ('US', 'New York', 'New York', 'America/New_York', ST_GeogFromText('SRID=4326;POINT(-74.0060 40.7128)')),
      ('GB', 'London',   'England',  'Europe/London',    ST_GeogFromText('SRID=4326;POINT(-0.1276 51.5074)'))
    ON CONFLICT DO NOTHING
  `);
}

async function seedOutreachBrands() {
  await db
    .insert(outreachBrands)
    .values([
      {
        slug: "eventsperse",
        displayName: "Eventsperse",
        emailDomain: "eventsperse.com",
        // Postmark token, sender signature, signature HTML left null —
        // populated via admin UI in Phase 2.
        status: "active",
      },
      // Second OutreachBrand TBD — OPEN_QUESTIONS.md#Q020
    ])
    .onConflictDoNothing({ target: outreachBrands.slug });
}

async function seedCrawlBrands() {
  await db
    .insert(crawlBrands)
    .values([
      {
        slug: "fright-crawl",
        displayName: "Fright Crawl",
        holidayType: "halloween",
        geography: "international",
        status: "active",
      },
      {
        slug: "trick-or-drink",
        displayName: "Trick or Drink",
        holidayType: "halloween",
        geography: "toronto",
        status: "active",
      },
      {
        slug: "midnight-pass",
        displayName: "Midnight Pass",
        holidayType: "newyears",
        geography: "toronto",
        status: "active",
      },
      {
        slug: "the-drop-pass",
        displayName: "The Drop Pass",
        holidayType: "newyears",
        geography: "international",
        status: "active",
      },
      {
        slug: "stpaddyscrawl",
        displayName: "StPaddysCrawl",
        holidayType: "stpaddys",
        geography: "international",
        status: "active",
      },
      {
        slug: "the-clover-crawl",
        displayName: "The Clover Crawl",
        holidayType: "stpaddys",
        geography: "toronto",
        status: "active",
      },
    ])
    .onConflictDoNothing({ target: crawlBrands.slug });
}

async function seedStaff() {
  // Email addresses are placeholders. Replace with real values once
  // OutreachBrand domains are confirmed in OPEN_QUESTIONS.md#Q005.
  // teamId defaults to the seeded BarCrawlConnect team — see
  // db/schema/teams.ts. Once multi-team support lands, seed extra
  // rows in teams + branch by team here.
  //
  // NOTE: these seeded users have NO password_hash. They cannot log
  // in via /login until an admin sends them an invite (commit 5 adds
  // the admin UI) or until you bootstrap an admin via
  // `pnpm tsx scripts/bootstrap-admin.ts`. Seeded rows still exist
  // so existing FKs (notes.author_staff_id etc.) have something to
  // point at in dev.
  const TEAM_ID = "00000000-0000-0000-0000-000000000001";
  await db
    .insert(staffMembers)
    .values([
      {
        displayName: "Bryle",
        primaryEmail: "bryle@example.local",
        role: "lead",
        timezone: "America/Toronto",
        teamId: TEAM_ID,
      },
      {
        displayName: "JC",
        primaryEmail: "jc@example.local",
        role: "outreach",
        timezone: "America/Toronto",
        teamId: TEAM_ID,
      },
      {
        displayName: "Yasue",
        primaryEmail: "yasue@example.local",
        role: "outreach",
        timezone: "America/Toronto",
        teamId: TEAM_ID,
      },
      {
        displayName: "Brandon",
        primaryEmail: "brandon@example.local",
        role: "outreach",
        timezone: "America/Toronto",
        teamId: TEAM_ID,
      },
    ])
    .onConflictDoNothing({ target: staffMembers.primaryEmail });
}

async function main() {
  await seedCountries();
  await seedCities();
  await seedOutreachBrands();
  await seedCrawlBrands();
  await seedStaff();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

/**
 * scripts/backup-to-sheets.ts
 *
 * Daily snapshot of an outreach campaign to a Google Sheets workbook.
 * Runs as a cron job (system cron, not BullMQ — independent of the
 * Next.js process so it keeps working when the app is down).
 *
 * Worst-case scenario this exists to mitigate:
 *   - Postgres corrupted / wiped
 *   - VPS unrecoverable
 *   - Engine code regression makes the data inaccessible from the UI
 *
 * In every one of those, the team can open this Google Sheet and
 * keep working — venue contacts, statuses, assignments, sales, all
 * of it is there as plain rows.
 *
 * Structure (matches the operator's reference workbook):
 *   - "Tracker" tab: one row per city in the campaign, mirroring the
 *     dashboard tracker (priority, city, status, sales, assigned,
 *     dashboard note)
 *   - One tab per city, name = city name (truncated to fit Google's
 *     100-char limit). Each city tab is a denormalized flat table:
 *
 *       Section  | Crawl | Slot     | Venue | Email | Phone | Status   | Assigned | Last Touch | Remarks
 *       Crawl    | 1     | Wristband| ...   | ...   | ...   | confirmed| Brandon  |            |
 *       Crawl    | 1     | Middle 1 | ...   | ...   | ...   | ...      |          |            |
 *       Cold     |       |          | ...   | ...   | ...   | called   | JC       | 2026-05-28 | left vm
 *       Warm     |       |          | ...   | ...   | ...   | interested| Bryle   | 2026-05-29 | ready to book
 *
 * Required env (script logs + exits 0 if any is missing — cron stays
 * green and the operator sees nothing scary, but a follow-up step
 * is needed to wire it up):
 *
 *   SHEETS_BACKUP_SPREADSHEET_ID
 *     Target workbook id, the long path segment in the docs URL.
 *
 *   SHEETS_BACKUP_CAMPAIGN_SLUG
 *     campaigns.slug — picks which campaign to snapshot. v1 is
 *     one-campaign-per-workbook. If you need multiple campaigns
 *     in one workbook later, prefix tab names with the slug.
 *
 *   SHEETS_BACKUP_SA_KEY_PATH (optional, default
 *     /root/outreach-secrets/sheets-service-account.json)
 *     Path to the service-account JSON key. The service account's
 *     email must be added to the spreadsheet's share list as Editor.
 *
 * One-time GCP setup (operator does this once):
 *
 *   1. console.cloud.google.com -> IAM -> Service Accounts -> CREATE
 *      Name it something like 'outreach-sheets-backup'.
 *   2. APIs & Services -> Library -> enable 'Google Sheets API' on
 *      the project.
 *   3. On the service account -> Keys -> Add Key -> JSON.
 *      Download the .json. Copy onto the VPS at
 *      /root/outreach-secrets/sheets-service-account.json,
 *      chmod 600.
 *   4. Open the target spreadsheet. Share -> add the service
 *      account's email (looks like name@project.iam.gserviceaccount.com)
 *      as Editor. Uncheck 'Notify people'.
 *   5. Add the three env vars to /var/www/outreach/.env.
 *
 * After that, the cron entry in /etc/cron.d/outreach-sheets-backup
 * runs this script every night at 04:00 UTC and replaces every tab
 * with a fresh snapshot.
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "../lib/db";
import { logger } from "../lib/logger";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MAX_TAB_NAME_LEN = 99;
const TRACKER_TAB = "Tracker";

const TRACKER_HEADER = [
  "Priority",
  "City",
  "Region",
  "Timezone",
  "Status",
  "Assigned",
  "Sales (USD)",
  "Sales goal (USD)",
  "Dashboard note",
];

const CITY_HEADER = [
  "Section",
  "Date",
  "Crawl #",
  "Slot",
  "Venue",
  "Email",
  "Phone",
  "Capacity",
  "Status",
  "Assigned",
  "Last touch",
  "Remarks",
];

// db.execute<T>() requires T extends Record<string, unknown>. The
// [key: string]: unknown index signature satisfies that without
// loosening the field types we actually consume.
interface CampaignRow {
  id: string;
  slug: string;
  name: string;
  [key: string]: unknown;
}

interface CityCampaign {
  city_campaign_id: string;
  city_id: string;
  city_name: string;
  region: string | null;
  timezone: string;
  priority: number;
  status: string;
  current_sales_cents: number;
  sales_goal_cents: number | null;
  lead_staff_name: string | null;
  dashboard_note: string | null;
  [key: string]: unknown;
}

interface CrawlSlotRow {
  event_date: string;
  slot_number: number;
  role: string;
  venue_name: string | null;
  venue_email: string | null;
  venue_phone: string | null;
  capacity: number | null;
  ve_status: string;
  [key: string]: unknown;
}

interface ColdRow {
  status: string;
  /** Warm-leads flag (migration 0082). Independent of status. */
  is_warm: boolean;
  venue_name: string;
  venue_email: string | null;
  venue_phone: string | null;
  capacity: number | null;
  assigned_name: string | null;
  last_touch_at: string | null;
  remarks: string | null;
  [key: string]: unknown;
}

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle_1: "Middle 1",
  middle_2: "Middle 2",
  final: "Final",
};

function dollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function isoOrEmpty(d: string | Date | null | undefined): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/** Google Sheets requires tab names <=100 chars, no [ ] * ? / \ : */
function safeTabName(raw: string): string {
  return raw
    .replace(/[\[\]\*\?\/\\:]/g, "-")
    .slice(0, MAX_TAB_NAME_LEN)
    .trim();
}

async function fetchCampaign(slug: string): Promise<CampaignRow | null> {
  const rows = await db.execute<CampaignRow>(sql`
    SELECT id::text AS id, slug, name
      FROM campaigns
     WHERE slug = ${slug}
     LIMIT 1
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: CampaignRow[] }).rows) ?? [];
  return list[0] ?? null;
}

async function fetchCityCampaigns(campaignId: string): Promise<CityCampaign[]> {
  const rows = await db.execute<CityCampaign>(sql`
    SELECT cc.id::text                    AS city_campaign_id,
           c.id::text                     AS city_id,
           c.name                         AS city_name,
           c.region                       AS region,
           c.timezone                     AS timezone,
           cc.priority                    AS priority,
           cc.status::text                AS status,
           cc.current_sales_cents         AS current_sales_cents,
           cc.sales_goal_cents            AS sales_goal_cents,
           u.display_name                 AS lead_staff_name,
           cc.dashboard_note              AS dashboard_note
      FROM city_campaigns cc
      JOIN cities c       ON c.id = cc.city_id
 LEFT JOIN users u        ON u.id = cc.lead_staff_id
     WHERE cc.campaign_id = ${campaignId}::uuid
  ORDER BY cc.priority ASC, c.name ASC
  `);
  return ((Array.isArray(rows) ? rows : (rows as { rows?: CityCampaign[] }).rows) ??
    []) as CityCampaign[];
}

async function fetchCrawlSlots(cityCampaignId: string): Promise<CrawlSlotRow[]> {
  // Every venue_event for every event in this city_campaign, plus
  // the empty slots (LEFT JOIN venue_events) so a city with unfilled
  // crawls still shows which slots exist.
  const rows = await db.execute<CrawlSlotRow>(sql`
    SELECT e.event_date::text       AS event_date,
           e.slot_number::int       AS slot_number,
           ve.role::text            AS role,
           v.name                   AS venue_name,
           v.email                  AS venue_email,
           v.phone_e164             AS venue_phone,
           v.capacity               AS capacity,
           ve.status::text          AS ve_status
      FROM events e
 LEFT JOIN venue_events ve ON ve.event_id = e.id
 LEFT JOIN venues       v  ON v.id = ve.venue_id
     WHERE e.city_campaign_id = ${cityCampaignId}::uuid
       AND e.archived_at IS NULL
  ORDER BY e.event_date ASC, e.slot_number ASC,
           CASE ve.role
             WHEN 'wristband' THEN 1
             WHEN 'middle_1'  THEN 2
             WHEN 'middle_2'  THEN 3
             WHEN 'final'     THEN 4
             ELSE 5
           END
  `);
  return ((Array.isArray(rows) ? rows : (rows as { rows?: CrawlSlotRow[] }).rows) ??
    []) as CrawlSlotRow[];
}

async function fetchColdEntries(cityCampaignId: string): Promise<ColdRow[]> {
  const rows = await db.execute<ColdRow>(sql`
    SELECT coe.status::text          AS status,
           coe.is_warm               AS is_warm,
           v.name                    AS venue_name,
           v.email                   AS venue_email,
           v.phone_e164              AS venue_phone,
           v.capacity                AS capacity,
           u.display_name            AS assigned_name,
           coe.last_touch_at::text   AS last_touch_at,
           coe.remarks               AS remarks
      FROM cold_outreach_entries coe
      JOIN venues v                ON v.id = coe.venue_id
 LEFT JOIN users  u                ON u.id = coe.assigned_staff_id
     WHERE coe.city_campaign_id = ${cityCampaignId}::uuid
       AND coe.archived_at IS NULL
  ORDER BY v.name ASC
  `);
  return ((Array.isArray(rows) ? rows : (rows as { rows?: ColdRow[] }).rows) ?? []) as ColdRow[];
}

function trackerValues(cities: CityCampaign[]): (string | number)[][] {
  const body = cities.map((c) => [
    c.priority,
    c.city_name,
    c.region ?? "",
    c.timezone,
    c.status,
    c.lead_staff_name ?? "",
    dollars(c.current_sales_cents),
    dollars(c.sales_goal_cents),
    c.dashboard_note ?? "",
  ]);
  return [TRACKER_HEADER, ...body];
}

function cityValues(crawls: CrawlSlotRow[], cold: ColdRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [CITY_HEADER];

  // Crawl section — one row per slot, blank venue cells for unfilled.
  for (const c of crawls) {
    rows.push([
      "Crawl",
      isoOrEmpty(c.event_date),
      c.slot_number,
      c.role ? (ROLE_LABEL[c.role] ?? c.role) : "(empty slot)",
      c.venue_name ?? "",
      c.venue_email ?? "",
      c.venue_phone ?? "",
      c.capacity ?? "",
      c.ve_status ?? "",
      "",
      "",
      "",
    ]);
  }

  // Warm leads = cold_outreach entries with is_warm=true (migration
  // 0082). Pre-0082 this filtered by status='interested' which was
  // the legacy way to mark warm — the migration backfilled is_warm
  // for those rows, so this still produces the same set, but now
  // continues to work after the operator's "promote keeps cold row
  // present" rule landed.
  //
  // NOTE: Unlike the UI cold panel (which shows ALL non-archived
  // rows), this backup script keeps the historical separation —
  // backup is a snapshot for human review, so seeing warm/cold
  // partitioned (no overlap) is more useful than the operational
  // view.
  const warm = cold.filter((e) => e.is_warm);
  const coldOnly = cold.filter((e) => !e.is_warm);

  if (warm.length > 0) rows.push([]);
  for (const e of warm) {
    rows.push([
      "Warm",
      "",
      "",
      "",
      e.venue_name,
      e.venue_email ?? "",
      e.venue_phone ?? "",
      e.capacity ?? "",
      e.status,
      e.assigned_name ?? "",
      isoOrEmpty(e.last_touch_at),
      e.remarks ?? "",
    ]);
  }

  if (coldOnly.length > 0) rows.push([]);
  for (const e of coldOnly) {
    rows.push([
      "Cold",
      "",
      "",
      "",
      e.venue_name,
      e.venue_email ?? "",
      e.venue_phone ?? "",
      e.capacity ?? "",
      e.status,
      e.assigned_name ?? "",
      isoOrEmpty(e.last_touch_at),
      e.remarks ?? "",
    ]);
  }

  return rows;
}

async function getSheetsClient(keyPath: string) {
  if (!existsSync(keyPath)) {
    throw new Error(
      `service-account key not found at ${keyPath} (set SHEETS_BACKUP_SA_KEY_PATH or place the JSON there)`,
    );
  }
  const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: [SCOPE] });
  return google.sheets({ version: "v4", auth });
}

/**
 * Ensure every tab in tabNames exists on the workbook. Tabs missing
 * are created; tabs already present are reused. Returns a map of
 * tab name -> sheetId for downstream batch clear/update calls.
 */
async function ensureTabs(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabNames: string[],
): Promise<Map<string, number>> {
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,sheetId))",
  });
  const existing = new Map<string, number>();
  for (const s of meta.data.sheets ?? []) {
    if (s.properties?.title && s.properties.sheetId != null) {
      existing.set(s.properties.title, s.properties.sheetId);
    }
  }
  const toCreate = tabNames.filter((n) => !existing.has(n));
  if (toCreate.length > 0) {
    const res = await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
    for (const reply of res.data.replies ?? []) {
      const props = reply.addSheet?.properties;
      if (props?.title && props.sheetId != null) existing.set(props.title, props.sheetId);
    }
  }
  return existing;
}

async function writeTabs(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabs: Array<{ name: string; values: (string | number)[][] }>,
): Promise<void> {
  // Clear first so the new snapshot replaces stale rows. Batch-clear
  // is cheaper than per-tab clear if there are many tabs.
  if (tabs.length === 0) return;
  await sheetsApi.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: tabs.map((t) => t.name) },
  });
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: tabs.map((t) => ({ range: t.name, values: t.values })),
    },
  });
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.SHEETS_BACKUP_SPREADSHEET_ID;
  const campaignSlug = process.env.SHEETS_BACKUP_CAMPAIGN_SLUG;
  const keyPath =
    process.env.SHEETS_BACKUP_SA_KEY_PATH ?? "/root/outreach-secrets/sheets-service-account.json";

  if (!spreadsheetId || !campaignSlug) {
    logger.warn(
      { hasSpreadsheet: !!spreadsheetId, hasCampaign: !!campaignSlug },
      "sheets backup: required env not set, exiting cleanly",
    );
    return;
  }

  const campaign = await fetchCampaign(campaignSlug);
  if (!campaign) {
    logger.warn({ campaignSlug }, "sheets backup: campaign slug not found, exiting cleanly");
    return;
  }

  const cities = await fetchCityCampaigns(campaign.id);
  logger.info(
    { campaign: campaign.slug, citiesCount: cities.length },
    "sheets backup: snapshotting campaign",
  );

  const sheetsApi = await getSheetsClient(keyPath);

  // Build payload for every tab BEFORE touching the workbook, so a
  // mid-run DB error doesn't half-overwrite a tab with a stale tail.
  const tabPayload: Array<{ name: string; values: (string | number)[][] }> = [
    { name: TRACKER_TAB, values: trackerValues(cities) },
  ];
  for (const city of cities) {
    const [crawls, cold] = await Promise.all([
      fetchCrawlSlots(city.city_campaign_id),
      fetchColdEntries(city.city_campaign_id),
    ]);
    tabPayload.push({
      name: safeTabName(city.city_name),
      values: cityValues(crawls, cold),
    });
  }

  await ensureTabs(
    sheetsApi,
    spreadsheetId,
    tabPayload.map((t) => t.name),
  );
  await writeTabs(sheetsApi, spreadsheetId, tabPayload);

  logger.info(
    { campaign: campaign.slug, tabsWritten: tabPayload.length, spreadsheetId },
    "sheets backup: success",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "sheets backup: failed");
    process.exitCode = 1;
  });

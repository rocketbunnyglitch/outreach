/**
 * scripts/backup-to-sheets.ts
 *
 * Nightly snapshot of an outreach campaign to a Google Sheets
 * workbook. Runs as a system cron (not BullMQ) so it keeps working
 * when the Next.js process is down.
 *
 * Worst-case scenarios this exists to mitigate:
 *   - Postgres corrupted / wiped
 *   - VPS unrecoverable
 *   - Engine code regression makes the data inaccessible from the UI
 *
 * In every one of those, the team opens this Google Sheet and keeps
 * working -- venue contacts, statuses, assignments, TICKET SALES,
 * crawl slot coverage, all of it as plain rows.
 *
 * One workbook per campaign (env-selected via slug). Re-running
 * UPDATES the same workbook in place: tabs are reused, cleared, and
 * rewritten. It NEVER creates a second workbook -- idempotent.
 *
 * Tabs (the operator's reference workbook layout):
 *   - "Campaign Cities"     one row per city in the campaign
 *   - "Crawl Schedule"      one row per REQUIRED crawl slot (filled
 *                           or MISSING), derived from each event's
 *                           required_*_count + crawl_format
 *   - "Venue Contacts"      one row per booked venue_event (contact
 *                           details for the night)
 *   - "Warm Leads"          cold_outreach rows flagged is_warm
 *   - "Cold Outreach"       cold_outreach rows not flagged warm
 *   - "Event-Day Readiness" ONE ROW PER CRAWL (even crawls with no
 *                           assigned venues): required-slot coverage
 *                           derived from required_*_count, plus a
 *                           Ready/Needs Review/Not Ready verdict and
 *                           a blocker summary
 *   - "Metadata"            export timestamp, version/commit, env,
 *                           and a do-not-edit warning. NO secrets.
 *
 * SALES are reported as TICKET COUNTS (events.ticket_sales_count),
 * which is the operational primary. Revenue (cents) is included as
 * a secondary informational column only.
 *
 * Required env (script logs + exits 0 if any is missing so cron
 * stays green; a follow-up wiring step is needed):
 *
 *   SHEETS_BACKUP_SPREADSHEET_ID
 *     Target workbook id (the long path segment in the docs URL).
 *
 *   SHEETS_BACKUP_CAMPAIGN_SLUG
 *     campaigns.slug -- picks which campaign to snapshot.
 *
 *   SHEETS_BACKUP_SA_KEY_PATH (optional, default
 *     /root/outreach-secrets/sheets-service-account.json)
 *     Path to the service-account JSON key. The service account's
 *     email must be added to the spreadsheet's share list as Editor.
 *
 *   SHEETS_BACKUP_CSV_DIR (optional, default
 *     /var/backups/outreach-sheets)
 *     Where CSV fallbacks are written if the Sheets API fails.
 *
 * If the Sheets API call fails for ANY reason (bad creds, network,
 * quota), the script writes every tab to a timestamped CSV directory
 * on disk and reports the failure -- the snapshot is never lost.
 *
 * Status is recorded to the cron_runs table (cron_name =
 * 'sheets-backup') so the admin Backups card can show last
 * success/failure + the workbook link without a new migration.
 */

import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "../lib/db";
// Pure core (no server-only) — the script grades crawls itself from raw
// SQL inputs so the backup carries the same health verdicts the app shows.
import { crawlHealthFromInputs } from "../lib/health-score-core";
import { logger } from "../lib/logger";
import { getVersion } from "../lib/version";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MAX_TAB_NAME_LEN = 99;
const CRON_NAME = "sheets-backup";
const DEFAULT_CSV_DIR = "/var/backups/outreach-sheets";

// ---- Tab names ----------------------------------------------------------
const TAB_CITIES = "Campaign Cities";
const TAB_SCHEDULE = "Crawl Schedule";
const TAB_CONTACTS = "Venue Contacts";
const TAB_WARM = "Warm Leads";
const TAB_COLD = "Cold Outreach";
const TAB_READINESS = "Event-Day Readiness";
const TAB_HEALTH = "Crawl Health";
const TAB_LIFECYCLE = "Lifecycle & V2";
const TAB_INCIDENTS = "Replacements & Cancellations";
const TAB_METADATA = "Metadata";

// ---- Headers ------------------------------------------------------------
const CITIES_HEADER = [
  "Priority",
  "City",
  "Region",
  "Timezone",
  "Status",
  "Lead staff",
  "Ticket sales (count)",
  "Ticket sales goal (count)",
  "Required venues",
  "Confirmed venues",
  "Revenue (USD, info)",
  "Revenue goal (USD, info)",
  "Dashboard note",
];

const SCHEDULE_HEADER = [
  "City",
  "Crawl",
  "Date",
  "Format",
  "Slot",
  "Ticket sales (count)",
  "Venue",
  "Venue status",
  "Agreed hours",
  "Remarks",
];

const CONTACTS_HEADER = [
  "City",
  "Crawl",
  "Date",
  "Slot",
  "Venue",
  "Venue email",
  "Venue phone",
  "Capacity",
  "Night-of contact",
  "Night-of phone",
  "Drink specials",
  "Venue status",
];

const COLD_HEADER = [
  "City",
  "Venue",
  "Email",
  "Phone",
  "Capacity",
  "Status",
  "Assigned",
  "Last touch",
  "Remarks",
];

const READINESS_HEADER = [
  "City",
  "Day/daypart",
  "Crawl number",
  "Ticket sales (count)",
  "Assigned staff",
  "Readiness",
  "Missing wristband",
  "Missing middle 1",
  "Missing middle 2",
  "Missing final",
  "Night-of contact missing",
  "Proposed hours missing",
  "Phone missing/unverified",
  "Readiness blocker summary",
];

// CRM plan D4: the backup must be a real emergency fallback for the
// CURRENT operating model — health verdicts, lifecycle/V2 state and
// incident state included. The per-crawl "Next action" column doubles
// as the NBA snapshot (the full NBA list is per-staffer derived
// guidance, not data you'd restore from).
const HEALTH_HEADER = [
  "City",
  "Crawl",
  "Event date",
  "Days out",
  "Tickets",
  "Score",
  "Color",
  "Viability",
  "Blockers",
  "Reasons",
  "Next action",
];

const LIFECYCLE_HEADER = [
  "City",
  "Venue",
  "Role",
  "Event date",
  "Status",
  "Confirmed at",
  "2-week email",
  "1-week email",
  "3-day call",
  "V2 floor-staff call",
  "Call attempts",
  "Last call outcome",
];

const INCIDENTS_HEADER = [
  "Type",
  "City",
  "Event date",
  "What",
  "Status",
  "Reason",
  "Drafts",
  "At",
  "By",
];

// db.execute<T>() requires T extends Record<string, unknown>. The
// [key: string]: unknown index signature satisfies that without
// loosening the field types we actually consume.
interface CampaignRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  revenue_goal_cents: string | number | null;
  target_ticket_sales_count: number | null;
  [key: string]: unknown;
}

interface CityCampaign {
  city_campaign_id: string;
  city_name: string;
  region: string | null;
  timezone: string;
  priority: number;
  status: string;
  ticket_sales_count: number;
  ticket_sales_goal: number | null;
  required_venues: number;
  confirmed_venues: number;
  current_sales_cents: string | number | null;
  sales_goal_cents: string | number | null;
  lead_staff_name: string | null;
  dashboard_note: string | null;
  [key: string]: unknown;
}

interface EventRow {
  event_id: string;
  city_campaign_id: string;
  city_name: string;
  event_date: string;
  slot_number: number;
  day_part: string | null;
  crawl_number: number | null;
  crawl_name: string | null;
  crawl_format: string;
  ticket_sales_count: number;
  required_wristband_count: number;
  required_middle_count: number;
  required_final_count: number;
  [key: string]: unknown;
}

interface VenueEventRow {
  event_id: string;
  role: string;
  slot_position: number | null;
  status: string;
  venue_name: string | null;
  venue_email: string | null;
  venue_phone: string | null;
  capacity: number | null;
  agreed_hours_text: string | null;
  slot_start_time: string | null;
  slot_end_time: string | null;
  drink_specials: string | null;
  night_of_contact_name: string | null;
  night_of_contact_phone: string | null;
  our_contact_staff_name: string | null;
  venue_phone_verified_at: string | null;
  [key: string]: unknown;
}

interface ColdRow {
  city_name: string;
  status: string;
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

const DAY_PART_LABEL: Record<string, string> = {
  thursday_night: "Thursday",
  friday_night: "Friday",
  saturday_day: "Saturday Day",
  saturday_night: "Saturday",
  sunday_day: "Sunday Day",
  sunday_night: "Sunday",
  other: "Crawl",
};

/** "Friday Crawl 2", "Saturday Day Crawl 1", or the custom name. */
function crawlLabel(e: {
  crawl_name: string | null;
  day_part: string | null;
  crawl_number: number | null;
  slot_number: number;
}): string {
  if (e.crawl_name?.trim()) return e.crawl_name.trim();
  const day = e.day_part ? (DAY_PART_LABEL[e.day_part] ?? "Crawl") : "Crawl";
  const num = e.crawl_number ?? e.slot_number;
  return `${day} Crawl ${num}`;
}

/**
 * Slot label per the operator's vocabulary:
 *   role=wristband              -> "Wristband"
 *   role=middle + slot_position -> "Middle 1/2/3"
 *   role=final                  -> "Final"
 *   role=alt_final              -> "Alt Final"
 * Falls back to a humanized role for any future enum value.
 */
function slotLabel(role: string, slotPosition: number | null): string {
  switch (role) {
    case "wristband":
      return "Wristband";
    case "middle":
      return `Middle ${slotPosition ?? 1}`;
    case "final":
      return "Final";
    case "alt_final":
      return "Alt Final";
    default:
      return role
        .split("_")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
  }
}

/**
 * Venue_event statuses that count as a slot actually being SECURED.
 * Mirrors lib/crawl-matrix.ts CONFIRMED_STATUSES (and the set the
 * Campaign Cities + Crawl Schedule derivation already trust): a signed
 * contract or a scheduled date are as committed as 'confirmed', so
 * treating them as unfilled would under-report readiness.
 */
const CONFIRMED_STATUSES = new Set(["confirmed", "scheduled", "contract_signed"]);
function isConfirmedStatus(s: string | null | undefined): boolean {
  return s != null && CONFIRMED_STATUSES.has(s);
}

function dollars(cents: string | number | null | undefined): string {
  if (cents == null) return "";
  const n = typeof cents === "string" ? Number(cents) : cents;
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

function isoOrEmpty(d: string | Date | null | undefined): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/** Google Sheets requires tab names <=100 chars, no [ ] * ? / \ : */
function safeTabName(raw: string): string {
  return raw
    .replace(/[[\]*?/\\:]/g, "-")
    .slice(0, MAX_TAB_NAME_LEN)
    .trim();
}

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

// ---- DB fetches ---------------------------------------------------------

async function fetchCampaign(slug: string): Promise<CampaignRow | null> {
  const res = await db.execute<CampaignRow>(sql`
    SELECT id::text                       AS id,
           slug,
           name,
           status::text                   AS status,
           revenue_goal_cents             AS revenue_goal_cents,
           target_ticket_sales_count      AS target_ticket_sales_count
      FROM campaigns
     WHERE slug = ${slug}
     LIMIT 1
  `);
  return rowsOf<CampaignRow>(res)[0] ?? null;
}

async function fetchCityCampaigns(campaignId: string): Promise<CityCampaign[]> {
  const res = await db.execute<CityCampaign>(sql`
    SELECT cc.id::text                    AS city_campaign_id,
           c.name                         AS city_name,
           c.region                       AS region,
           c.timezone                     AS timezone,
           cc.priority                    AS priority,
           cc.status::text                AS status,
           COALESCE((
             SELECT SUM(e.ticket_sales_count)::int
               FROM events e
              WHERE e.city_campaign_id = cc.id
                AND e.archived_at IS NULL
           ), 0)                          AS ticket_sales_count,
           cc.target_venue_count          AS required_venues,
           COALESCE((
             SELECT COUNT(*)::int
               FROM venue_events ve
               JOIN events e ON e.id = ve.event_id
              WHERE e.city_campaign_id = cc.id
                AND e.archived_at IS NULL
                AND ve.status IN ('confirmed','scheduled','contract_signed')
           ), 0)                          AS confirmed_venues,
           cc.current_sales_cents         AS current_sales_cents,
           cc.sales_goal_cents            AS sales_goal_cents,
           u.display_name                 AS lead_staff_name,
           cc.dashboard_note              AS dashboard_note
      FROM city_campaigns cc
      JOIN cities c ON c.id = cc.city_id
 LEFT JOIN users  u ON u.id = cc.lead_staff_id
     WHERE cc.campaign_id = ${campaignId}::uuid
  ORDER BY cc.priority ASC, c.name ASC
  `);
  // ticket_sales_goal has no per-city backing column; campaign-level
  // target_ticket_sales_count is surfaced on Metadata instead.
  return rowsOf<CityCampaign>(res).map((r) => ({ ...r, ticket_sales_goal: null }));
}

async function fetchEvents(campaignId: string): Promise<EventRow[]> {
  const res = await db.execute<EventRow>(sql`
    SELECT e.id::text                     AS event_id,
           e.city_campaign_id::text       AS city_campaign_id,
           c.name                         AS city_name,
           e.event_date::text             AS event_date,
           e.slot_number::int             AS slot_number,
           e.day_part::text               AS day_part,
           e.crawl_number::int            AS crawl_number,
           e.crawl_name                   AS crawl_name,
           e.crawl_format::text           AS crawl_format,
           e.ticket_sales_count::int      AS ticket_sales_count,
           e.required_wristband_count::int AS required_wristband_count,
           e.required_middle_count::int   AS required_middle_count,
           e.required_final_count::int    AS required_final_count
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c          ON c.id = cc.city_id
     WHERE cc.campaign_id = ${campaignId}::uuid
       AND e.archived_at IS NULL
  ORDER BY c.name ASC, e.event_date ASC, e.slot_number ASC
  `);
  return rowsOf<EventRow>(res);
}

async function fetchVenueEvents(campaignId: string): Promise<VenueEventRow[]> {
  const res = await db.execute<VenueEventRow>(sql`
    SELECT ve.event_id::text             AS event_id,
           ve.role::text                 AS role,
           ve.slot_position::int         AS slot_position,
           ve.status::text               AS status,
           v.name                        AS venue_name,
           v.email                       AS venue_email,
           v.phone_e164                  AS venue_phone,
           v.capacity::int               AS capacity,
           ve.agreed_hours_text          AS agreed_hours_text,
           ve.slot_start_time::text      AS slot_start_time,
           ve.slot_end_time::text        AS slot_end_time,
           ve.drink_specials             AS drink_specials,
           ve.night_of_contact_name      AS night_of_contact_name,
           ve.night_of_contact_phone_e164 AS night_of_contact_phone,
           su.display_name               AS our_contact_staff_name,
           v.verified_from_google_at::text AS venue_phone_verified_at
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN venues v ON v.id = ve.venue_id
 LEFT JOIN users su ON su.id = ve.our_contact_staff_id
     WHERE cc.campaign_id = ${campaignId}::uuid
       AND e.archived_at IS NULL
  ORDER BY ve.event_id, ve.role, ve.slot_position
  `);
  return rowsOf<VenueEventRow>(res);
}

async function fetchColdEntries(campaignId: string): Promise<ColdRow[]> {
  const res = await db.execute<ColdRow>(sql`
    SELECT c.name                         AS city_name,
           coe.status::text               AS status,
           coe.is_warm                    AS is_warm,
           v.name                         AS venue_name,
           v.email                        AS venue_email,
           v.phone_e164                   AS venue_phone,
           v.capacity::int                AS capacity,
           u.display_name                 AS assigned_name,
           coe.last_touch_at::text        AS last_touch_at,
           coe.remarks                    AS remarks
      FROM cold_outreach_entries coe
      JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
      JOIN cities c          ON c.id = cc.city_id
      JOIN venues v          ON v.id = coe.venue_id
 LEFT JOIN users  u          ON u.id = coe.assigned_staff_id
     WHERE cc.campaign_id = ${campaignId}::uuid
       AND coe.archived_at IS NULL
  ORDER BY c.name ASC, v.name ASC
  `);
  return rowsOf<ColdRow>(res);
}

// ---- D4 fetches: health inputs, lifecycle state, incidents ---------------

interface HealthInputRow {
  [key: string]: unknown;
  event_id: string;
  city_name: string;
  event_date: string;
  day_part: string | null;
  crawl_number: number | null;
  status: string;
  crawl_format: string;
  tickets: number;
  days_to_event: number;
  wb_required: number;
  mid_required: number;
  fin_required: number;
  wb_filled: number;
  mid_filled: number;
  fin_filled: number;
  hosts: number;
  wb_pending: number;
  unowned: number;
  unbriefed: number;
}

async function fetchHealthInputs(campaignId: string): Promise<HealthInputRow[]> {
  const res = await db.execute<HealthInputRow>(sql`
    SELECT e.id::text AS event_id,
           c.name AS city_name,
           e.event_date::text AS event_date,
           e.day_part::text AS day_part,
           e.crawl_number::int AS crawl_number,
           e.status::text AS status,
           e.crawl_format::text AS crawl_format,
           COALESCE(e.ticket_sales_count, 0)::int AS tickets,
           (e.event_date - (now() at time zone 'America/Toronto')::date)::int AS days_to_event,
           COALESCE(e.required_wristband_count, 0)::int AS wb_required,
           COALESCE(e.required_middle_count, 0)::int AS mid_required,
           COALESCE(e.required_final_count, 0)::int AS fin_required,
           (SELECT count(*) FROM venue_events ve WHERE ve.event_id = e.id
              AND ve.status = 'confirmed' AND ve.role = 'wristband')::int AS wb_filled,
           (SELECT count(*) FROM venue_events ve WHERE ve.event_id = e.id
              AND ve.status = 'confirmed' AND ve.role = 'middle')::int AS mid_filled,
           (SELECT count(*) FROM venue_events ve WHERE ve.event_id = e.id
              AND ve.status = 'confirmed' AND ve.role = 'final')::int AS fin_filled,
           (SELECT count(*) FROM crawl_hosts ch WHERE ch.event_id = e.id)::int AS hosts,
           (SELECT count(*) FROM wristbands w
              JOIN venue_events ve2 ON ve2.id = w.venue_event_id
             WHERE ve2.event_id = e.id
               AND w.status IN ('pending', 'ready_to_ship', 'issue'))::int AS wb_pending,
           (SELECT count(*) FROM venue_events ve3 WHERE ve3.event_id = e.id
              AND ve3.status = 'confirmed' AND ve3.our_contact_staff_id IS NULL)::int AS unowned,
           (SELECT count(*) FROM venue_events ve4 WHERE ve4.event_id = e.id
              AND ve4.status = 'confirmed'
              AND ve4.floor_staff_call_completed_at IS NULL)::int AS unbriefed
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
     WHERE cc.campaign_id = ${campaignId}::uuid
       AND e.archived_at IS NULL
       AND e.event_date >= (now() at time zone 'America/Toronto')::date
  ORDER BY c.name, e.event_date
  `);
  return rowsOf<HealthInputRow>(res);
}

interface LifecycleRow {
  [key: string]: unknown;
  city_name: string;
  venue_name: string;
  role: string;
  event_date: string;
  status: string;
  confirmed_at: string | null;
  two_week_email_sent_at: string | null;
  one_week_email_sent_at: string | null;
  three_day_call_completed_at: string | null;
  floor_staff_call_completed_at: string | null;
  call_attempts: number;
  last_outcome: string | null;
}

async function fetchLifecycleRows(campaignId: string): Promise<LifecycleRow[]> {
  const res = await db.execute<LifecycleRow>(sql`
    SELECT c.name AS city_name,
           v.name AS venue_name,
           ve.role::text AS role,
           e.event_date::text AS event_date,
           ve.status::text AS status,
           ve.confirmed_at::text AS confirmed_at,
           ve.two_week_email_sent_at::text AS two_week_email_sent_at,
           ve.one_week_email_sent_at::text AS one_week_email_sent_at,
           ve.three_day_call_completed_at::text AS three_day_call_completed_at,
           ve.floor_staff_call_completed_at::text AS floor_staff_call_completed_at,
           COALESCE(ve.floor_staff_call_attempts, 0)::int AS call_attempts,
           ve.floor_staff_last_call_outcome::text AS last_outcome
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      JOIN venues v ON v.id = ve.venue_id
     WHERE cc.campaign_id = ${campaignId}::uuid
       AND e.archived_at IS NULL
       AND ve.status IN ('confirmed', 'cancelled')
       AND e.event_date >= (now() at time zone 'America/Toronto')::date
  ORDER BY e.event_date, c.name, v.name
  `);
  return rowsOf<LifecycleRow>(res);
}

interface IncidentRow {
  [key: string]: unknown;
  kind: string;
  city_name: string;
  event_date: string;
  what: string;
  status: string;
  reason: string | null;
  drafts: number;
  at: string | null;
  by_name: string | null;
}

async function fetchIncidents(campaignId: string): Promise<IncidentRow[]> {
  const res = await db.execute<IncidentRow>(sql`
    SELECT 'replacement push' AS kind,
           c.name AS city_name,
           e.event_date::text AS event_date,
           rp.role AS what,
           rp.status AS status,
           rp.reason AS reason,
           rp.drafts_created::int AS drafts,
           rp.created_at::text AS at,
           u.display_name AS by_name
      FROM replacement_pushes rp
      JOIN events e ON e.id = rp.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
 LEFT JOIN users u ON u.id = rp.created_by
     WHERE cc.campaign_id = ${campaignId}::uuid
    UNION ALL
    SELECT 'cancellation' AS kind,
           c2.name AS city_name,
           e2.event_date::text AS event_date,
           v.name || ' (' || ve.role::text || ')' AS what,
           'cancelled' AS status,
           ve.cancellation_reason AS reason,
           0 AS drafts,
           ve.cancelled_at::text AS at,
           u2.display_name AS by_name
      FROM venue_events ve
      JOIN venues v ON v.id = ve.venue_id
      JOIN events e2 ON e2.id = ve.event_id
      JOIN city_campaigns cc2 ON cc2.id = e2.city_campaign_id
      JOIN cities c2 ON c2.id = cc2.city_id
 LEFT JOIN users u2 ON u2.id = ve.cancelled_by
     WHERE cc2.campaign_id = ${campaignId}::uuid
       AND ve.status = 'cancelled'
  ORDER BY 8 DESC NULLS LAST
  `);
  return rowsOf<IncidentRow>(res);
}

function healthValues(rows: HealthInputRow[]): (string | number)[][] {
  const out: (string | number)[][] = [HEALTH_HEADER];
  for (const r of rows) {
    const health = crawlHealthFromInputs({
      eventStatus: r.status as "planned" | "confirmed" | "completed" | "cancelled",
      crawlFormat: r.crawl_format as "standard" | "day_party",
      ticketsSold: Number(r.tickets),
      daysToEvent: Number(r.days_to_event),
      wristbandRequired: Number(r.wb_required),
      wristbandFilled: Number(r.wb_filled),
      middleRequired: Number(r.mid_required),
      middleFilled: Number(r.mid_filled),
      finalRequired: Number(r.fin_required),
      finalFilled: Number(r.fin_filled),
      readinessBlocker:
        Number(r.unbriefed) > 0 && Number(r.days_to_event) >= 0 && Number(r.days_to_event) <= 4,
      hostsAssigned: Number(r.hosts),
      wristbandsPending: Number(r.wb_pending) > 0,
      unassignedConfirmed: Number(r.unowned),
    });
    out.push([
      r.city_name,
      crawlLabel({
        crawl_name: null,
        day_part: r.day_part,
        crawl_number: r.crawl_number,
        slot_number: 1,
      }),
      r.event_date,
      Number(r.days_to_event),
      Number(r.tickets),
      health.score,
      health.color,
      health.viability,
      health.blockers.join(" | "),
      health.reasons.join(" | "),
      health.nextAction ?? "",
    ]);
  }
  return out;
}

function lifecycleValues(rows: LifecycleRow[]): (string | number)[][] {
  const out: (string | number)[][] = [LIFECYCLE_HEADER];
  for (const r of rows) {
    out.push([
      r.city_name,
      r.venue_name,
      r.role,
      r.event_date,
      r.status,
      isoOrEmpty(r.confirmed_at),
      isoOrEmpty(r.two_week_email_sent_at),
      isoOrEmpty(r.one_week_email_sent_at),
      isoOrEmpty(r.three_day_call_completed_at),
      isoOrEmpty(r.floor_staff_call_completed_at),
      Number(r.call_attempts),
      r.last_outcome ?? "",
    ]);
  }
  return out;
}

function incidentsValues(rows: IncidentRow[]): (string | number)[][] {
  const out: (string | number)[][] = [INCIDENTS_HEADER];
  for (const r of rows) {
    out.push([
      r.kind,
      r.city_name,
      r.event_date,
      r.what,
      r.status,
      r.reason ?? "",
      Number(r.drafts),
      isoOrEmpty(r.at),
      r.by_name ?? "",
    ]);
  }
  return out;
}

// ---- Tab builders -------------------------------------------------------

function citiesValues(cities: CityCampaign[]): (string | number)[][] {
  const body = cities.map((c) => [
    c.priority,
    c.city_name,
    c.region ?? "",
    c.timezone,
    c.status,
    c.lead_staff_name ?? "",
    c.ticket_sales_count,
    c.ticket_sales_goal ?? "",
    c.required_venues,
    c.confirmed_venues,
    dollars(c.current_sales_cents),
    dollars(c.sales_goal_cents),
    c.dashboard_note ?? "",
  ]);
  return [CITIES_HEADER, ...body];
}

/**
 * Derive the required slots for one event from its required_*_count
 * + crawl_format, then match each to a filled venue_event (if any).
 * Emits a row for EVERY required slot -- unfilled slots get
 * "MISSING" in the venue + status columns. day_party events emit no
 * Final slot regardless of required_final_count.
 *
 * Any EXTRA filled venue_events beyond the required count (e.g. a
 * 3rd middle, alt_finals) are appended so nothing booked is lost.
 */
function requiredSlotsForEvent(e: EventRow): Array<{ role: string; position: number }> {
  const slots: Array<{ role: string; position: number }> = [];
  for (let i = 1; i <= e.required_wristband_count; i++)
    slots.push({ role: "wristband", position: i });
  for (let i = 1; i <= e.required_middle_count; i++) slots.push({ role: "middle", position: i });
  if (e.crawl_format !== "day_party") {
    for (let i = 1; i <= e.required_final_count; i++) slots.push({ role: "final", position: i });
  }
  return slots;
}

function scheduleValues(
  events: EventRow[],
  veByEvent: Map<string, VenueEventRow[]>,
): (string | number)[][] {
  const rows: (string | number)[][] = [SCHEDULE_HEADER];

  for (const e of events) {
    const label = crawlLabel(e);
    const ves = veByEvent.get(e.event_id) ?? [];
    // Index filled venue_events by role+position. Wristband/final
    // have slot_position 1 (or null -> treat as 1).
    const filled = new Map<string, VenueEventRow>();
    const used = new Set<VenueEventRow>();
    for (const ve of ves) {
      const pos = ve.slot_position ?? 1;
      const key = `${ve.role}#${pos}`;
      if (!filled.has(key)) filled.set(key, ve);
    }

    for (const slot of requiredSlotsForEvent(e)) {
      const key = `${slot.role}#${slot.position}`;
      const ve = filled.get(key);
      if (ve) used.add(ve);
      const hours =
        ve?.agreed_hours_text ??
        (ve?.slot_start_time
          ? `${ve.slot_start_time.slice(0, 5)}${ve.slot_end_time ? `-${ve.slot_end_time.slice(0, 5)}` : ""}`
          : "");
      rows.push([
        e.city_name,
        label,
        isoOrEmpty(e.event_date),
        e.crawl_format,
        slotLabel(slot.role, slot.position),
        e.ticket_sales_count,
        ve?.venue_name ?? "MISSING",
        ve ? ve.status : "MISSING",
        hours,
        "",
      ]);
    }

    // Extra filled slots beyond the required count (alt_finals,
    // overflow middles) so a real booking is never dropped.
    for (const ve of ves) {
      if (used.has(ve)) continue;
      const pos = ve.slot_position ?? 1;
      const hours =
        ve.agreed_hours_text ??
        (ve.slot_start_time
          ? `${ve.slot_start_time.slice(0, 5)}${ve.slot_end_time ? `-${ve.slot_end_time.slice(0, 5)}` : ""}`
          : "");
      rows.push([
        e.city_name,
        label,
        isoOrEmpty(e.event_date),
        e.crawl_format,
        slotLabel(ve.role, pos),
        e.ticket_sales_count,
        ve.venue_name ?? "",
        ve.status,
        hours,
        "extra slot",
      ]);
    }
  }

  return rows;
}

function contactsValues(
  events: EventRow[],
  veByEvent: Map<string, VenueEventRow[]>,
): (string | number)[][] {
  const rows: (string | number)[][] = [CONTACTS_HEADER];
  for (const e of events) {
    const label = crawlLabel(e);
    for (const ve of veByEvent.get(e.event_id) ?? []) {
      rows.push([
        e.city_name,
        label,
        isoOrEmpty(e.event_date),
        slotLabel(ve.role, ve.slot_position),
        ve.venue_name ?? "",
        ve.venue_email ?? "",
        ve.venue_phone ?? "",
        ve.capacity ?? "",
        ve.night_of_contact_name ?? "",
        ve.night_of_contact_phone ?? "",
        ve.drink_specials ?? "",
        ve.status,
      ]);
    }
  }
  return rows;
}

function coldValues(cold: ColdRow[], wantWarm: boolean): (string | number)[][] {
  const rows: (string | number)[][] = [COLD_HEADER];
  for (const e of cold) {
    if (e.is_warm !== wantWarm) continue;
    rows.push([
      e.city_name,
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

/**
 * Event-Day Readiness: ONE ROW PER CRAWL (event), derived the same way
 * the Crawl Schedule tab derives required slots -- from
 * required_*_count + crawl_format -- so a crawl with NO assigned
 * venues still shows up (as Not Ready with every required slot flagged
 * missing) instead of vanishing.
 *
 * A required slot is "missing" when no CONFIRMED venue_event
 * (isConfirmedStatus: confirmed/scheduled/contract_signed) matches that
 * role + slot_position. day_party crawls require no Final slot, so a
 * day_party never flags a missing final (reuses requiredSlotsForEvent,
 * which already drops the final for day_party).
 *
 * Readiness:
 *   Not Ready    -- any REQUIRED slot is unconfirmed, OR night-of
 *                   contact is missing on the confirmed slots.
 *   Needs Review -- all required slots confirmed, but a minor blocker
 *                   (proposed hours missing, or a venue phone that is
 *                   missing/unverified).
 *   Ready        -- all required slots confirmed + a night-of contact +
 *                   proposed hours present, and no phone gap.
 *
 * Blocker summary is the comma-joined human list of every gap, so the
 * operator can act straight from the sheet even if Postgres is gone.
 */
function readinessValues(
  events: EventRow[],
  veByEvent: Map<string, VenueEventRow[]>,
): (string | number)[][] {
  const rows: (string | number)[][] = [READINESS_HEADER];

  for (const e of events) {
    const ves = veByEvent.get(e.event_id) ?? [];

    // Index ONLY confirmed venue_events by role#position. Wristband /
    // final carry slot_position null -> treat as 1, matching the
    // Crawl Schedule tab's filled-slot indexing.
    const confirmed = new Map<string, VenueEventRow>();
    for (const ve of ves) {
      if (!isConfirmedStatus(ve.status)) continue;
      const pos = ve.slot_position ?? 1;
      const key = `${ve.role}#${pos}`;
      if (!confirmed.has(key)) confirmed.set(key, ve);
    }

    // Required slots (same derivation as scheduleValues).
    const required = requiredSlotsForEvent(e);
    const requires = (role: string, position: number): boolean =>
      required.some((s) => s.role === role && s.position === position);
    const slotMissing = (role: string, position: number): boolean =>
      requires(role, position) && !confirmed.has(`${role}#${position}`);

    const missingWristband = slotMissing("wristband", 1);
    const missingMiddle1 = slotMissing("middle", 1);
    const missingMiddle2 = slotMissing("middle", 2);
    const missingFinal = slotMissing("final", 1);
    const anyRequiredSlotMissing = required.some((s) => slotMissing(s.role, s.position));

    // Contact / hours / phone are judged across the CONFIRMED slots
    // (an unconfirmed slot's contact info is not yet operative).
    const confirmedVes = [...confirmed.values()];
    const hasConfirmed = confirmedVes.length > 0;
    const hasContact =
      hasConfirmed && confirmedVes.some((ve) => (ve.night_of_contact_name ?? "").trim() !== "");
    const hasHours =
      hasConfirmed &&
      confirmedVes.some(
        (ve) => (ve.agreed_hours_text ?? "").trim() !== "" || ve.slot_start_time != null,
      );
    // Phone gap: at least one confirmed venue has no E.164 phone, or a
    // venue that has never been Google-verified (phone is unconfirmed).
    const phoneGap =
      hasConfirmed &&
      confirmedVes.some(
        (ve) => (ve.venue_phone ?? "").trim() === "" || ve.venue_phone_verified_at == null,
      );

    // A crawl with no required slots at all (e.g. all required counts
    // zero) cannot be "missing" a slot, but still needs contact/hours.
    const contactMissing = !hasContact;
    const hoursMissing = !hasHours;

    const blockers: string[] = [];
    if (missingWristband) blockers.push("wristband");
    if (missingMiddle1) blockers.push("middle 1");
    if (missingMiddle2) blockers.push("middle 2");
    if (missingFinal) blockers.push("final");
    // Surface any other required slot gaps the four fixed columns do
    // not cover (e.g. a 3rd wristband or 3rd middle) in the summary.
    for (const s of required) {
      if (!slotMissing(s.role, s.position)) continue;
      if (s.role === "wristband" && s.position === 1) continue;
      if (s.role === "middle" && (s.position === 1 || s.position === 2)) continue;
      if (s.role === "final" && s.position === 1) continue;
      blockers.push(slotLabel(s.role, s.position).toLowerCase());
    }
    if (contactMissing) blockers.push("night-of contact");
    if (hoursMissing) blockers.push("proposed hours");
    if (phoneGap) blockers.push("phone missing/unverified");

    // Not Ready: a required slot is unconfirmed, or the night-of
    // contact is missing (you cannot run the night without a contact).
    // Needs Review: slots all present but a minor gap (hours / phone).
    // Ready: everything required confirmed + contact + hours, no phone gap.
    let readiness: string;
    if (anyRequiredSlotMissing || contactMissing) {
      readiness = "Not Ready";
    } else if (hoursMissing || phoneGap) {
      readiness = "Needs Review";
    } else {
      readiness = "Ready";
    }

    const day = e.day_part ? (DAY_PART_LABEL[e.day_part] ?? "Crawl") : "Crawl";
    const crawlNumber = e.crawl_number ?? e.slot_number;
    const staff = [
      ...new Set(ves.map((ve) => (ve.our_contact_staff_name ?? "").trim()).filter((n) => n !== "")),
    ].join(", ");

    rows.push([
      e.city_name,
      day,
      crawlNumber,
      e.ticket_sales_count,
      staff,
      readiness,
      missingWristband ? "yes" : "no",
      missingMiddle1 ? "yes" : "no",
      missingMiddle2 ? "yes" : "no",
      missingFinal ? "yes" : "no",
      contactMissing ? "yes" : "no",
      hoursMissing ? "yes" : "no",
      phoneGap ? "yes" : "no",
      blockers.join(", "),
    ]);
  }

  return rows;
}

/**
 * Read the authoritative deployed commit + build time from
 * .next/.deployed-commit, which deploy.sh stamps with the real commit
 * on every deploy. Used for backup provenance because the standalone
 * (tsx) cron context does not get the build-baked BUILD_* env the Next
 * server has -- it would otherwise report stale .env values. Returns
 * null when the file is absent (e.g. dev), so the caller falls back to
 * getVersion().
 */
function deployedBuildInfo(): { commit: string; builtAt: string } | null {
  try {
    const p = join(process.cwd(), ".next", ".deployed-commit");
    if (!existsSync(p)) return null;
    const commit = readFileSync(p, "utf8").trim().slice(0, 12);
    if (!commit) return null;
    return { commit, builtAt: statSync(p).mtime.toISOString() };
  } catch {
    return null;
  }
}

function metadataValues(
  campaign: CampaignRow,
  cityCount: number,
  eventCount: number,
): (string | number)[][] {
  const v = getVersion();
  // getVersion() reads BUILD_* from process.env. The Next build bakes the
  // real values in, but this standalone script (run via tsx by the cron)
  // only sees whatever BUILD_* sit in .env -- which can be stale. The
  // deploy stamps the authoritative commit into .next/.deployed-commit, so
  // prefer that for the disaster-recovery provenance (commit + build time).
  const deployed = deployedBuildInfo();
  return [
    ["Field", "Value"],
    ["WARNING", "Backup export only -- do not edit here. Edits are overwritten nightly."],
    ["Campaign", campaign.name],
    ["Campaign slug", campaign.slug],
    ["Campaign status", campaign.status],
    ["Cities exported", cityCount],
    ["Events exported", eventCount],
    ["Campaign ticket-sales target (count)", campaign.target_ticket_sales_count ?? ""],
    ["Campaign revenue goal (USD)", dollars(campaign.revenue_goal_cents)],
    ["Exported at (UTC)", new Date().toISOString()],
    ["App version", v.version],
    ["App commit", deployed?.commit ?? v.commit],
    ["Built at", deployed?.builtAt ?? v.builtAt],
    ["Environment", process.env.NODE_ENV ?? "unknown"],
    ["Host", hostname()],
    ["Note", "No secrets, OAuth tokens, or credentials are ever exported here."],
  ];
}

// ---- Google Sheets I/O --------------------------------------------------

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
 * Ensure every tab in tabNames exists on the workbook. Missing tabs
 * are created; existing tabs reused. This is what makes re-runs
 * idempotent -- the same workbook is updated, never duplicated.
 */
async function ensureTabs(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabNames: string[],
): Promise<void> {
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  });
  const existing = new Set<string>();
  for (const s of meta.data.sheets ?? []) {
    if (s.properties?.title) existing.add(s.properties.title);
  }
  const toCreate = tabNames.filter((n) => !existing.has(n));
  if (toCreate.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }
}

async function writeTabsToSheets(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabs: Array<{ name: string; values: (string | number)[][] }>,
): Promise<void> {
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

// ---- CSV fallback -------------------------------------------------------

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(values: (string | number)[][]): string {
  return values.map((row) => row.map(csvCell).join(",")).join("\n");
}

/**
 * Last-resort persistence when the Sheets API can't be reached.
 * Writes one CSV per tab into a timestamped directory so the
 * nightly snapshot is never lost. Returns the directory path.
 */
function writeTabsToCsv(
  baseDir: string,
  campaignSlug: string,
  tabs: Array<{ name: string; values: (string | number)[][] }>,
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(baseDir, `${campaignSlug}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  for (const t of tabs) {
    const file = join(dir, `${safeTabName(t.name).replace(/\s+/g, "-")}.csv`);
    writeFileSync(file, toCsv(t.values), "utf8");
  }
  return dir;
}

// ---- cron_runs status surface ------------------------------------------

/**
 * Record the run in cron_runs so the admin Backups card can show
 * last success/failure + the workbook link. Best-effort: a tracking
 * failure must never mask the real backup result. No new migration
 * -- reuses the existing cron_runs table (cron_name='sheets-backup',
 * detail in result_summary jsonb).
 */
async function recordRun(
  status: "success" | "error",
  durationMs: number,
  summary: Record<string, unknown>,
  errorMessage: string | null,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO cron_runs
        (cron_name, status, started_at, finished_at, duration_ms, error_message, result_summary, host)
      VALUES
        (${CRON_NAME}, ${status}, NOW() - (${durationMs}::int || ' milliseconds')::interval,
         NOW(), ${durationMs}, ${errorMessage},
         ${JSON.stringify(summary)}::jsonb, ${hostname()})
    `);
  } catch (err) {
    logger.warn({ err }, "sheets backup: failed to record cron_runs row (non-fatal)");
  }
}

// ---- main ---------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();
  const spreadsheetId = process.env.SHEETS_BACKUP_SPREADSHEET_ID;
  const campaignSlug = process.env.SHEETS_BACKUP_CAMPAIGN_SLUG;
  const keyPath =
    process.env.SHEETS_BACKUP_SA_KEY_PATH ?? "/root/outreach-secrets/sheets-service-account.json";
  const csvDir = process.env.SHEETS_BACKUP_CSV_DIR ?? DEFAULT_CSV_DIR;

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

  const [cities, events, venueEvents, cold, healthInputs, lifecycleRows, incidentRows] =
    await Promise.all([
      fetchCityCampaigns(campaign.id),
      fetchEvents(campaign.id),
      fetchVenueEvents(campaign.id),
      fetchColdEntries(campaign.id),
      fetchHealthInputs(campaign.id),
      fetchLifecycleRows(campaign.id),
      fetchIncidents(campaign.id),
    ]);

  const veByEvent = new Map<string, VenueEventRow[]>();
  for (const ve of venueEvents) {
    const list = veByEvent.get(ve.event_id) ?? [];
    list.push(ve);
    veByEvent.set(ve.event_id, list);
  }

  logger.info(
    { campaign: campaign.slug, cities: cities.length, events: events.length },
    "sheets backup: snapshotting campaign",
  );

  // Build EVERY tab payload before touching the workbook, so a
  // mid-run DB error can't half-overwrite a tab.
  const tabPayload: Array<{ name: string; values: (string | number)[][] }> = [
    { name: safeTabName(TAB_CITIES), values: citiesValues(cities) },
    { name: safeTabName(TAB_SCHEDULE), values: scheduleValues(events, veByEvent) },
    { name: safeTabName(TAB_CONTACTS), values: contactsValues(events, veByEvent) },
    { name: safeTabName(TAB_WARM), values: coldValues(cold, true) },
    { name: safeTabName(TAB_COLD), values: coldValues(cold, false) },
    { name: safeTabName(TAB_READINESS), values: readinessValues(events, veByEvent) },
    { name: safeTabName(TAB_HEALTH), values: healthValues(healthInputs) },
    { name: safeTabName(TAB_LIFECYCLE), values: lifecycleValues(lifecycleRows) },
    { name: safeTabName(TAB_INCIDENTS), values: incidentsValues(incidentRows) },
    {
      name: safeTabName(TAB_METADATA),
      values: metadataValues(campaign, cities.length, events.length),
    },
  ];

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  try {
    const sheetsApi = await getSheetsClient(keyPath);
    await ensureTabs(
      sheetsApi,
      spreadsheetId,
      tabPayload.map((t) => t.name),
    );
    await writeTabsToSheets(sheetsApi, spreadsheetId, tabPayload);

    const summary = {
      campaign: campaign.slug,
      tabs: tabPayload.length,
      cities: cities.length,
      events: events.length,
      venueEvents: venueEvents.length,
      coldEntries: cold.length,
      spreadsheetId,
      sheetUrl,
      destination: "sheets",
    };
    await recordRun("success", Date.now() - startedAt, summary, null);
    logger.info(summary, "sheets backup: success");
  } catch (apiErr) {
    // Sheets API unreachable / bad creds / quota: persist CSVs so
    // the snapshot is never lost, then report the failure clearly.
    const apiMsg = (apiErr as Error)?.message ?? String(apiErr);
    let csvPath: string | null = null;
    let csvError: string | null = null;
    try {
      csvPath = writeTabsToCsv(csvDir, campaign.slug, tabPayload);
    } catch (csvErr) {
      csvError = (csvErr as Error)?.message ?? String(csvErr);
    }

    const summary = {
      campaign: campaign.slug,
      destination: csvPath ? "csv-fallback" : "none",
      csvPath,
      csvError,
      spreadsheetId,
      sheetUrl,
      sheetsError: apiMsg,
    };
    const errMessage = csvPath
      ? `Sheets API failed (${apiMsg}); wrote CSV fallback to ${csvPath}`
      : `Sheets API failed (${apiMsg}); CSV fallback ALSO failed (${csvError})`;
    await recordRun("error", Date.now() - startedAt, summary, errMessage);
    logger.error({ ...summary }, "sheets backup: Sheets API failed");
    // Re-throw so the process exits non-zero and the cron log shows
    // red. The CSV fallback already preserved the data on disk.
    throw new Error(errMessage);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "sheets backup: failed");
    process.exitCode = 1;
  });

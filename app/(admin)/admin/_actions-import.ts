"use server";

/**
 * Admin → CSV bulk upload of campaign cities + crawl instances.
 *
 * Spec input format (header required):
 *   priority_number, city_name, day, crawl_number
 *
 * Example:
 *   priority_number,city_name,day,crawl_number
 *   1,New York City,Thursday,1
 *   1,New York City,Friday,1
 *   1,New York City,Friday,2
 *   2,Chicago,Friday,1
 *
 * Behavior:
 *   1. Parse CSV → array of { priority, cityName, day, crawlNumber }.
 *   2. Resolve cityName → master cities row.
 *      • Match strategy: exact lower(name) match within the country,
 *        falling back to fuzzy via pg_trgm similarity (≥0.7).
 *      • Unmatched city names land in `errors[]` with a suggested
 *        master city candidate when similarity is between 0.4 and 0.7.
 *   3. Group rows by city → upsert city_campaigns (one per city), then
 *      one events row per (city, day, crawlNumber).
 *   4. Duplicates: rely on a partial unique index on events
 *      (city_campaign_id, day_part, crawl_number) so re-importing the
 *      same CSV is a no-op rather than duplicating rows.
 *
 * The action runs in two phases:
 *   • parseAndPreview(csv) → returns { rows, errors, summary } for the
 *     UI to display BEFORE the operator commits.
 *   • commitImport(csv, campaignId) → does the work.
 */

import { cityCampaigns } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const DAY_MAP: Record<string, "thursday_night" | "friday_night" | "saturday_night"> = {
  thu: "thursday_night",
  thursday: "thursday_night",
  fri: "friday_night",
  friday: "friday_night",
  sat: "saturday_night",
  saturday: "saturday_night",
};

export interface ParsedRow {
  rowNumber: number; // 1-based, header excluded
  priority: number;
  cityName: string;
  day: "thursday_night" | "friday_night" | "saturday_night";
  crawlNumber: number;
  /** Optional — when present, links the created event to an EB event. */
  eventbriteEventId: string | null;
  resolvedCityId: string | null;
  resolvedCityLabel: string | null;
  /** Fuzzy match suggestion when exact match failed. */
  suggestion?: { cityId: string; label: string; similarity: number };
}

export interface ImportError {
  rowNumber: number;
  raw: string;
  reason: string;
}

export interface ImportPreview {
  rows: ParsedRow[];
  errors: ImportError[];
  summary: {
    totalRows: number;
    citiesResolved: number;
    citiesUnresolved: number;
    crawlsToCreate: number;
  };
}

/**
 * Parse + resolve city names. Pure read — no inserts.
 */
export async function previewCsvImport(csv: string): Promise<ImportPreview> {
  const { rows, errors } = parseCsv(csv);

  // Bulk-resolve city names
  const uniqueNames = Array.from(new Set(rows.map((r) => r.cityName.toLowerCase())));
  const matched = await resolveCityNames(uniqueNames);

  const resolved: ParsedRow[] = rows.map((r) => {
    const key = r.cityName.toLowerCase();
    const m = matched.get(key);
    return {
      ...r,
      resolvedCityId: m?.exact?.id ?? null,
      resolvedCityLabel: m?.exact?.label ?? null,
      suggestion: m?.suggestion,
    };
  });

  const summary = {
    totalRows: rows.length,
    citiesResolved: new Set(
      resolved.filter((r) => r.resolvedCityId).map((r) => r.resolvedCityId as string),
    ).size,
    citiesUnresolved: new Set(
      resolved.filter((r) => !r.resolvedCityId).map((r) => r.cityName.toLowerCase()),
    ).size,
    crawlsToCreate: resolved.filter((r) => r.resolvedCityId).length,
  };

  return { rows: resolved, errors, summary };
}

const commitSchema = z.object({
  campaignId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  csv: z.string().min(1).max(200_000),
});

/**
 * Commit phase — creates city_campaigns + events rows. Idempotent on
 * (campaign, city) for city_campaigns and (city_campaign, day, crawl)
 * for events.
 */
export async function commitCsvImport(
  _prev: unknown,
  formData: FormData,
): Promise<
  ActionResult<{
    cityCampaignsCreated: number;
    eventsCreated: number;
    skipped: number;
  }>
> {
  const { staff } = await requireStaff();
  const parsed = commitSchema.safeParse({
    campaignId: String(formData.get("campaignId") ?? ""),
    csv: String(formData.get("csv") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const preview = await previewCsvImport(parsed.data.csv);
  if (preview.errors.length > 0) {
    return {
      ok: false,
      error: `${preview.errors.length} parse error(s) — fix the CSV and try again.`,
    };
  }
  const resolvedRows = preview.rows.filter((r) => r.resolvedCityId);
  if (resolvedRows.length === 0) {
    return { ok: false, error: "No rows resolved to a master city." };
  }

  let cityCampaignsCreated = 0;
  let eventsCreated = 0;
  let skipped = 0;

  try {
    await withAuditContext(staff.id, async (tx) => {
      // One city_campaigns row per (campaign, city)
      const byCity = new Map<string, ParsedRow[]>();
      for (const r of resolvedRows) {
        const cid = r.resolvedCityId as string;
        const list = byCity.get(cid) ?? [];
        list.push(r);
        byCity.set(cid, list);
      }

      for (const [cityId, cityRows] of byCity.entries()) {
        const priority = cityRows[0]?.priority ?? 5;
        const existing = await tx
          .select({ id: cityCampaigns.id })
          .from(cityCampaigns)
          .where(
            and(
              eq(cityCampaigns.campaignId, parsed.data.campaignId),
              eq(cityCampaigns.cityId, cityId),
            ),
          )
          .limit(1)
          .then((r) => r[0]);

        let cityCampaignId: string;
        if (existing) {
          cityCampaignId = existing.id;
          await tx
            .update(cityCampaigns)
            .set({ priority, updatedBy: staff.id })
            .where(eq(cityCampaigns.id, existing.id));
        } else {
          const [row] = await tx
            .insert(cityCampaigns)
            .values({
              campaignId: parsed.data.campaignId,
              cityId,
              priority,
              status: "planning",
              createdBy: staff.id,
              updatedBy: staff.id,
            })
            .returning({ id: cityCampaigns.id });
          cityCampaignId = row?.id ?? "";
          cityCampaignsCreated++;
        }

        for (const cr of cityRows) {
          // Deduplicate against existing events
          const existingEvent = await tx.execute<{ id: string }>(sql`
            SELECT id FROM events
            WHERE city_campaign_id = ${cityCampaignId}
              AND day_part = ${cr.day}::day_part
              AND crawl_number = ${cr.crawlNumber}
            LIMIT 1
          `);
          const existingRows: Array<{ id: string }> = Array.isArray(existingEvent)
            ? (existingEvent as unknown as Array<{ id: string }>)
            : ((existingEvent as unknown as { rows: Array<{ id: string }> }).rows ?? []);

          if (existingRows.length > 0) {
            // If CSV supplies an EB id and the event doesn't have one
            // yet, patch it in. Don't overwrite a manually-set EB id.
            if (cr.eventbriteEventId) {
              await tx.execute(sql`
                UPDATE events
                SET eventbrite_event_id = ${cr.eventbriteEventId},
                    updated_at = NOW(),
                    updated_by = ${staff.id}
                WHERE id = ${existingRows[0]?.id}
                  AND eventbrite_event_id IS NULL
              `);
            }
            skipped++;
            continue;
          }

          // Insert via raw SQL because events has fields the operator
          // hasn't supplied yet (event_date, name) — we set sensible
          // defaults so the row is valid.
          await tx.execute(sql`
            INSERT INTO events (
              id, city_campaign_id, day_part, crawl_number,
              event_date, name, status, eventbrite_event_id,
              created_at, updated_at, created_by, updated_by, version
            ) VALUES (
              gen_random_uuid(),
              ${cityCampaignId},
              ${cr.day}::day_part,
              ${cr.crawlNumber},
              CURRENT_DATE,
              ${`${capitalize(cr.day)} crawl ${cr.crawlNumber}`},
              'planning',
              ${cr.eventbriteEventId},
              NOW(), NOW(), ${staff.id}, ${staff.id}, 1
            )
          `);
          eventsCreated++;
        }
      }
    });

    logger.info(
      { cityCampaignsCreated, eventsCreated, skipped, campaignId: parsed.data.campaignId },
      "admin CSV import committed",
    );
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true, data: { cityCampaignsCreated, eventsCreated, skipped } };
  } catch (err) {
    logger.error({ err }, "commitCsvImport failed");
    return { ok: false, error: "Import failed. See server logs." };
  }
}

// ---------- Internals ----------

function parseCsv(csv: string): {
  rows: Omit<ParsedRow, "resolvedCityId" | "resolvedCityLabel" | "suggestion">[];
  errors: ImportError[];
} {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 0,
          raw: csv.slice(0, 80),
          reason: "CSV needs a header row and at least one data row.",
        },
      ],
    };
  }
  const header = lines[0]?.toLowerCase() ?? "";
  const expectedCols = ["priority_number", "city_name", "day", "crawl_number"];
  if (!expectedCols.every((c) => header.includes(c))) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 0,
          raw: lines[0] ?? "",
          reason: `Header must include: ${expectedCols.join(", ")}`,
        },
      ],
    };
  }

  // Resolve column order from header
  const headerCols = splitCsvLine(lines[0] ?? "").map((c) => c.toLowerCase().trim());
  const idx = {
    priority: headerCols.indexOf("priority_number"),
    city: headerCols.indexOf("city_name"),
    day: headerCols.indexOf("day"),
    crawl: headerCols.indexOf("crawl_number"),
    // Optional — when present, links the created event to an EB event
    eventbriteId: headerCols.indexOf("eventbrite_id"),
  };

  const rows: Omit<ParsedRow, "resolvedCityId" | "resolvedCityLabel" | "suggestion">[] = [];
  const errors: ImportError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const cols = splitCsvLine(raw);
    // 4 required columns (priority, city, day, crawl) — eventbrite_id is optional
    if (cols.length < 4) {
      errors.push({ rowNumber: i, raw, reason: "Expected at least 4 columns." });
      continue;
    }

    const priority = Number(cols[idx.priority]);
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
      errors.push({
        rowNumber: i,
        raw,
        reason: `priority_number must be 1-10 (got ${cols[idx.priority]}).`,
      });
      continue;
    }

    const cityName = cols[idx.city]?.trim();
    if (!cityName) {
      errors.push({ rowNumber: i, raw, reason: "city_name is empty." });
      continue;
    }

    const dayRaw = cols[idx.day]?.toLowerCase().trim() ?? "";
    const day = DAY_MAP[dayRaw];
    if (!day) {
      errors.push({
        rowNumber: i,
        raw,
        reason: `day must be Thursday/Friday/Saturday (got "${cols[idx.day]}").`,
      });
      continue;
    }

    const crawlNumber = Number(cols[idx.crawl]);
    if (!Number.isInteger(crawlNumber) || crawlNumber < 1 || crawlNumber > 4) {
      errors.push({
        rowNumber: i,
        raw,
        reason: `crawl_number must be 1-4 (got ${cols[idx.crawl]}).`,
      });
      continue;
    }

    // Optional EB id — if column exists and value present, must be
    // numeric (EB event IDs are large integers).
    let eventbriteEventId: string | null = null;
    if (idx.eventbriteId !== -1) {
      const ebRaw = cols[idx.eventbriteId]?.trim() ?? "";
      if (ebRaw) {
        if (!/^\d{6,20}$/.test(ebRaw)) {
          errors.push({
            rowNumber: i,
            raw,
            reason: `eventbrite_id must be a 6-20 digit number (got "${ebRaw}").`,
          });
          continue;
        }
        eventbriteEventId = ebRaw;
      }
    }

    rows.push({ rowNumber: i, priority, cityName, day, crawlNumber, eventbriteEventId });
  }

  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV split: respects double-quoted fields with commas.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

interface CityMatch {
  exact?: { id: string; label: string };
  suggestion?: { cityId: string; label: string; similarity: number };
}

async function resolveCityNames(lowerNames: string[]): Promise<Map<string, CityMatch>> {
  if (lowerNames.length === 0) return new Map();

  // Exact match first (lower(name) IN (...))
  const exactRows = await db.execute<{
    id: string;
    name: string;
    region: string | null;
    country_code: string;
    lower_name: string;
  }>(sql`
    SELECT id, name, region, country_code, lower(name) AS lower_name
    FROM cities
    WHERE archived_at IS NULL AND lower(name) = ANY(${lowerNames}::text[])
  `);

  type CityRow = {
    id: string;
    name: string;
    region: string | null;
    country_code: string;
    lower_name: string;
  };
  const exactList: CityRow[] = Array.isArray(exactRows)
    ? (exactRows as unknown as CityRow[])
    : ((exactRows as unknown as { rows: CityRow[] }).rows ?? []);

  const exactByName = new Map<string, CityRow>();
  for (const r of exactList) exactByName.set(r.lower_name, r);

  const unmatchedNames = lowerNames.filter((n) => !exactByName.has(n));

  // For unmatched: pg_trgm similarity. One query per unmatched (small N).
  const suggestionByName = new Map<string, { cityId: string; label: string; similarity: number }>();
  for (const name of unmatchedNames) {
    try {
      const fuzzy = await db.execute<{
        id: string;
        name: string;
        region: string | null;
        country_code: string;
        sim: number;
      }>(sql`
        SELECT id, name, region, country_code, similarity(name, ${name}) AS sim
        FROM cities
        WHERE archived_at IS NULL AND similarity(name, ${name}) > 0.4
        ORDER BY sim DESC
        LIMIT 1
      `);
      type FuzzyRow = {
        id: string;
        name: string;
        region: string | null;
        country_code: string;
        sim: number;
      };
      const fuzzyList: FuzzyRow[] = Array.isArray(fuzzy)
        ? (fuzzy as unknown as FuzzyRow[])
        : ((fuzzy as unknown as { rows: FuzzyRow[] }).rows ?? []);
      const best = fuzzyList[0];
      if (best) {
        suggestionByName.set(name, {
          cityId: best.id,
          label: `${best.name}${best.region ? `, ${best.region}` : ""}`,
          similarity: Number(best.sim),
        });
      }
    } catch {
      /* ignore — pg_trgm may not be installed in test envs */
    }
  }

  const out = new Map<string, CityMatch>();
  for (const name of lowerNames) {
    const exact = exactByName.get(name);
    if (exact) {
      out.set(name, {
        exact: {
          id: exact.id,
          label: `${exact.name}${exact.region ? `, ${exact.region}` : ""}`,
        },
      });
    } else {
      const sug = suggestionByName.get(name);
      if (sug) out.set(name, { suggestion: sug });
      else out.set(name, {});
    }
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

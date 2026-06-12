"use server";

/**
 * Venue CSV import.
 *
 * Workflow:
 *   1. Parse the uploaded file with papaparse, header-row required.
 *   2. Resolve every distinct (city, country) tuple to a cities.id.
 *      Missing matches → rows get status:"error" with a helpful message.
 *   3. Validate each row with `venueCsvRowSchema`. Rows that fail Zod
 *      validation go to status:"error" with the field-level details.
 *   4. Bulk-insert valid rows inside a single `withAuditContext` transaction
 *      — so the operator either gets the full import or nothing, no awkward
 *      half-imports to clean up.
 *
 * Returns a VenueImportSummary structured for the client to render a
 * per-row review table.
 */

import { cities, countries, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type VenueCsvRow,
  type VenueImportRowResult,
  type VenueImportSummary,
  venueCsvRowSchema,
} from "@/lib/validation/csv-import";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { type ParseResult, parse } from "papaparse";

interface ImportActionResult {
  ok: boolean;
  summary?: VenueImportSummary;
  error?: string;
}

/**
 * Look up cities by (name, optional country) — case-insensitive on name.
 * Returns a map from a normalized `"name|country"` key to cities.id, so
 * the import can resolve each CSV row's city quickly.
 *
 * If country is omitted, the city name must be globally unique in the
 * cities table; otherwise the row gets an "ambiguous city" error so the
 * operator can add the country column and retry.
 */
async function buildCityIndex(
  rows: VenueCsvRow[],
): Promise<Map<string, { id: string; ambiguous: boolean }>> {
  const distinctCities = new Set<string>();
  for (const row of rows) {
    distinctCities.add(row.city.trim().toLowerCase());
  }

  // Fetch all cities whose name matches any distinct value in the CSV.
  const cityRows = await db
    .select({
      id: cities.id,
      name: cities.name,
      countryCode: cities.countryCode,
      countryName: countries.name,
    })
    .from(cities)
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .where(
      // case-insensitive name match
      inArray(sql`lower(${cities.name})`, Array.from(distinctCities)),
    );

  const index = new Map<string, { id: string; ambiguous: boolean }>();
  for (const c of cityRows) {
    const nameKey = c.name.toLowerCase();
    // With country
    const withCountryKey = `${nameKey}|${c.countryCode.toLowerCase()}`;
    const withCountryNameKey = `${nameKey}|${c.countryName.toLowerCase()}`;
    index.set(withCountryKey, { id: c.id, ambiguous: false });
    index.set(withCountryNameKey, { id: c.id, ambiguous: false });

    // Without country: collide-detect. Two cities sharing the name from
    // different countries → both become ambiguous when looked up without
    // a country tag.
    const noCountryKey = `${nameKey}|`;
    const existing = index.get(noCountryKey);
    if (existing) {
      index.set(noCountryKey, { id: existing.id, ambiguous: true });
    } else {
      index.set(noCountryKey, { id: c.id, ambiguous: false });
    }
  }
  return index;
}

export async function importVenuesCsv(
  _prev: unknown,
  formData: FormData,
): Promise<ImportActionResult> {
  const { staff } = await requireStaff();

  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file uploaded." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "CSV must be smaller than 5 MB." };
  }
  if (!/\.csv$/i.test(file.name) && file.type && !/csv/i.test(file.type)) {
    return {
      ok: false,
      error: "File must be a .csv. Export from Sheets via File → Download → CSV.",
    };
  }

  const text = await file.text();
  const parsed: ParseResult<Record<string, string>> = parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  if (parsed.errors.length > 0) {
    const firstErr = parsed.errors[0];
    return {
      ok: false,
      error: `CSV parse failed at row ${(firstErr?.row ?? 0) + 1}: ${firstErr?.message ?? "unknown"}`,
    };
  }
  if (parsed.data.length === 0) {
    return { ok: false, error: "CSV had no data rows." };
  }
  if (parsed.data.length > 5000) {
    return {
      ok: false,
      error: "CSV has more than 5000 rows. Split into multiple files and import in batches.",
    };
  }

  // First pass: Zod-validate every row, build a stripped list of valid rows.
  const results: VenueImportRowResult[] = [];
  const validRows: { row: VenueCsvRow; rowIndex: number }[] = [];
  const rowWarnings = new Map<number, string>();
  for (let i = 0; i < parsed.data.length; i++) {
    const rowIndex = i + 2; // +1 for 0-based → 1-based, +1 for header row
    const raw = parsed.data[i] ?? {};
    // Soft-fail phones: operator sheets rarely hold E.164, and losing the
    // whole row over a formatting nit is worse than importing it phoneless.
    const rawPhone = (raw.phone ?? "").trim();
    if (rawPhone && !/^\+[1-9]\d{9,14}$/.test(rawPhone)) {
      raw.phone = "";
      rowWarnings.set(rowIndex, `Phone "${rawPhone}" isn't E.164 — imported without a phone.`);
    }
    const result = venueCsvRowSchema.safeParse(raw);
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      const msg = Object.entries(flat)
        .map(([k, v]) => `${k}: ${(v ?? []).join("; ")}`)
        .join(" · ");
      results.push({ rowIndex, status: "error", message: msg || "Invalid row" });
      continue;
    }
    validRows.push({ row: result.data, rowIndex });
  }

  // Second pass: resolve cities.
  const cityIndex = await buildCityIndex(validRows.map((v) => v.row));

  // Resolve each row to a cityId first, so we know which cities to load
  // the existing-venue dedupe index for.
  const resolved: {
    rowIndex: number;
    cityId: string;
    row: VenueCsvRow;
  }[] = [];
  for (const { row, rowIndex } of validRows) {
    const nameKey = row.city.toLowerCase().trim();
    const countryKey = row.country?.toLowerCase().trim() ?? "";
    const lookup = cityIndex.get(`${nameKey}|${countryKey}`);
    if (!lookup) {
      results.push({
        rowIndex,
        status: "error",
        message: `City "${row.city}"${row.country ? ` in ${row.country}` : ""} not found. Add it under /cities first.`,
      });
      continue;
    }
    if (lookup.ambiguous && !row.country) {
      results.push({
        rowIndex,
        status: "error",
        message: `City "${row.city}" is ambiguous (multiple countries). Add a country column.`,
      });
      continue;
    }
    resolved.push({ rowIndex, cityId: lookup.id, row });
  }

  // Dedupe index: load existing venues for every city referenced by this
  // import and key them by (city_id, lower(name)), exact phone, and
  // lower(email). A re-import of the same sheet then SKIPS rows that
  // already exist instead of inserting duplicate venues. Archived venues
  // are excluded so an import can resurface a previously-archived venue.
  const dedupeKey = (cityId: string, name: string) => `${cityId}|${name.trim().toLowerCase()}`;
  const existingByName = new Set<string>();
  const existingByPhone = new Set<string>();
  const existingByEmail = new Set<string>();
  const cityIds = Array.from(new Set(resolved.map((r) => r.cityId)));
  if (cityIds.length > 0) {
    const existingVenues = await db
      .select({
        cityId: venues.cityId,
        name: venues.name,
        phoneE164: venues.phoneE164,
        email: venues.email,
      })
      .from(venues)
      .where(and(inArray(venues.cityId, cityIds), isNull(venues.archivedAt)));
    for (const v of existingVenues) {
      existingByName.add(dedupeKey(v.cityId, v.name));
      if (v.phoneE164) existingByPhone.add(v.phoneE164.trim());
      if (v.email) existingByEmail.add(v.email.trim().toLowerCase());
    }
  }

  // Intra-file dedupe: a sheet that lists the same venue twice should
  // insert it once. Track keys we've already accepted in this batch.
  const seenName = new Set<string>();
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();

  const insertable: {
    rowIndex: number;
    values: typeof venues.$inferInsert;
  }[] = [];
  for (const { rowIndex, cityId, row } of resolved) {
    const nameDk = dedupeKey(cityId, row.name);
    const phoneDk = row.phone?.trim() || null;
    const emailDk = row.email?.trim().toLowerCase() || null;

    const dupReason =
      existingByName.has(nameDk) || seenName.has(nameDk)
        ? `A venue named "${row.name}" already exists in this city.`
        : phoneDk && (existingByPhone.has(phoneDk) || seenPhone.has(phoneDk))
          ? `A venue with phone ${row.phone} already exists.`
          : emailDk && (existingByEmail.has(emailDk) || seenEmail.has(emailDk))
            ? `A venue with email ${row.email} already exists.`
            : null;
    if (dupReason) {
      results.push({ rowIndex, status: "skipped", message: dupReason });
      continue;
    }

    // Reserve this row's keys so a later identical row in the same file
    // is skipped too.
    seenName.add(nameDk);
    if (phoneDk) seenPhone.add(phoneDk);
    if (emailDk) seenEmail.add(emailDk);

    insertable.push({
      rowIndex,
      values: {
        cityId,
        name: row.name,
        address: row.address,
        phoneE164: row.phone,
        email: row.email,
        websiteUrl: row.website,
        instagramHandle: row.instagram,
        capacity: row.capacity,
        servesAlcohol: row.serves_alcohol ?? true,
        doNotContact: row.dnc ?? false,
        internalNotes: row.notes ?? "",
        createdBy: staff.id,
        updatedBy: staff.id,
      },
    });
  }

  // Bulk insert in a single audit-context transaction.
  if (insertable.length > 0) {
    try {
      await withAuditContext(staff.id, async (tx) => {
        const inserted = await tx
          .insert(venues)
          .values(insertable.map((i) => i.values))
          .returning({ id: venues.id });
        for (let i = 0; i < insertable.length; i++) {
          const item = insertable[i];
          const row = inserted[i];
          if (!item || !row) continue;
          results.push({
            rowIndex: item.rowIndex,
            status: "ok",
            venueId: row.id,
            message: rowWarnings.get(item.rowIndex),
          });
        }
      });
    } catch (err) {
      logger.error({ err }, "csv import insert failed");
      return {
        ok: false,
        error: "Bulk insert failed — no venues were imported. Check server logs.",
      };
    }
  }

  results.sort((a, b) => a.rowIndex - b.rowIndex);
  const summary: VenueImportSummary = {
    totalRows: parsed.data.length,
    inserted: results.filter((r) => r.status === "ok").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };

  revalidatePath("/venues");
  return { ok: true, summary };
}

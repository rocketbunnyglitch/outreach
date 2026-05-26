/**
 * Validation schemas for CSV import.
 *
 * The CSV format is intentionally close to what the operator already uses in
 * Google Sheets — column names mirror common spreadsheet headers, and most
 * fields are optional. The import action:
 *   1. Parses the CSV with papaparse (header row required)
 *   2. Validates each row with `venueCsvRowSchema`
 *   3. Resolves `city` (string) to a cities.id by matching name + optional
 *      country (case-insensitive). Surfaces row-level errors.
 *   4. Bulk-inserts in a single transaction so a CSV either fully imports or
 *      fails atomically — partial imports are confusing.
 *
 * Boolean columns ("yes"/"no"/"true"/"false"/"1"/"0"/empty) are normalized
 * via `csvBoolean`.
 *
 * Phone numbers: we DON'T attempt to format raw "(416) 555-1234" into E.164
 * here — the operator's data may not be reliably formatted, and a silent
 * reformat could change a 9-digit number into something wrong. Instead we
 * accept E.164 strictly, and rows with non-E.164 phones get the phone left
 * blank with a per-row warning.
 */

import { z } from "zod";

const csvBoolean = z
  .union([
    z.literal("").transform(() => undefined),
    z.string().transform((s) => {
      const v = s.trim().toLowerCase();
      if (["true", "yes", "y", "1", "x", "✓"].includes(v)) return true;
      if (["false", "no", "n", "0", ""].includes(v)) return false;
      return undefined;
    }),
  ])
  .optional();

const csvE164 = z
  .union([
    z.literal("").transform(() => undefined),
    z
      .string()
      .regex(
        /^\+[1-9]\d{9,14}$/,
        "Must be in E.164 format (e.g. +14165551234). Reformat in your sheet before importing.",
      ),
  ])
  .optional();

const csvEmail = z
  .union([z.literal("").transform(() => undefined), z.string().email("Invalid email address")])
  .optional();

const csvUrl = z
  .union([z.literal("").transform(() => undefined), z.string().url("Must be a valid URL")])
  .optional();

const csvOptional = (max = 500) =>
  z
    .union([
      z.literal("").transform(() => undefined),
      z
        .string()
        .max(max)
        .transform((s) => s.trim() || undefined),
    ])
    .optional();

const csvPositiveInt = z
  .union([z.literal("").transform(() => undefined), z.coerce.number().int().nonnegative()])
  .optional();

/**
 * Schema for one row of the venues import CSV.
 *
 * Required columns: `name`, `city`
 * Optional columns: `country`, `address`, `phone`, `email`, `website`,
 *   `instagram`, `capacity`, `serves_alcohol`, `dnc`, `notes`
 */
export const venueCsvRowSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  city: z.string().min(1, "City is required").max(120),
  country: csvOptional(120),
  address: csvOptional(500),
  phone: csvE164,
  email: csvEmail,
  website: csvUrl,
  instagram: z
    .union([
      z.literal("").transform(() => undefined),
      z
        .string()
        .regex(/^@?[a-zA-Z0-9._]{1,30}$/, "Instagram handle: letters, digits, dot, underscore")
        .transform((s) => (s.startsWith("@") ? s.slice(1) : s)),
    ])
    .optional(),
  capacity: csvPositiveInt,
  serves_alcohol: csvBoolean,
  dnc: csvBoolean,
  notes: csvOptional(5000),
});

export type VenueCsvRow = z.infer<typeof venueCsvRowSchema>;

/**
 * Per-row import result. Aggregated into a summary for the UI.
 */
export interface VenueImportRowResult {
  rowIndex: number; // 1-based, matches what the operator sees in Excel
  status: "ok" | "skipped" | "error";
  message?: string;
  venueId?: string;
}

export interface VenueImportSummary {
  totalRows: number;
  inserted: number;
  skipped: number;
  errors: number;
  results: VenueImportRowResult[];
}

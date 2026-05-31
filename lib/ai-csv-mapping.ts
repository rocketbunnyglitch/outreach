import "server-only";

/**
 * AI CSV column auto-mapper — Tier S #2 of the Haiku ROI sprint.
 *
 * Reads the FIRST ROW of a pasted CSV and suggests which of the
 * operator's columns map to the 4 required + 1 optional canonical
 * fields that the campaign-roster importer expects:
 *
 *   priority_number   (required, 1-10)
 *   city_name         (required, free text)
 *   day               (required, Thursday / Friday / Saturday / etc.)
 *   crawl_number      (required, 1-9)
 *   eventbrite_id     (optional)
 *
 * Operators paste CSVs from Google Sheets, Excel, Notion, etc.
 * with column headers like "City", "Priority", "Night", "Crawl #"
 * that don't match the canonical names. Today the importer rejects
 * with "Header must include: priority_number, city_name, ...".
 * This module bridges that by asking Haiku for a mapping the
 * operator can confirm before commit.
 *
 * Cost characteristics:
 *   - ~200 input tokens (just the header + first 3 data rows)
 *   - ~80 output tokens (5-field JSON mapping)
 *   - ~$0.001/call with Haiku 4.5
 *
 * Guardrails:
 *   - AI_CSV_MAPPING_ENABLED env flag (kill switch)
 *   - Per-staff rate limit: 5/min (this is a rare action)
 *   - Input cap: first 4 lines only, each truncated to 1000 chars
 *   - Output validated: every claimed column index must exist in
 *     the header row; required fields can't all be null
 *   - One-shot — no streaming, no retry on parse failure
 */

import { generateCompletion, isAiConfigured } from "@/lib/ai";
import { checkAiRateLimit, isAiFeatureEnabled, truncateForAi } from "@/lib/ai-guardrails";
import { logger } from "@/lib/logger";

const MAPPER_MODEL = "claude-haiku-4-5-20251001";
const MAPPER_MAX_TOKENS = 240;

const SYSTEM_PROMPT = `You are a CSV column mapper for a campaign-roster import flow.

The operator pasted a CSV. Look at the HEADER row + a few sample
data rows, and return a JSON mapping from the canonical field
names below to the matching column INDEX (0-based) in the
header:

  priority_number  (REQUIRED) — an integer 1-10 representing
                     city priority. Operator headers: "priority",
                     "rank", "tier", "p", "#"
  city_name        (REQUIRED) — the city the crawl is in. Headers:
                     "city", "town", "location", "market", "place"
  day              (REQUIRED) — a weekday name. Headers: "day",
                     "night", "weekday", "when"
  crawl_number     (REQUIRED) — an integer 1-9 — which crawl slot.
                     Headers: "crawl", "slot", "crawl #", "event #"
  eventbrite_id    (OPTIONAL) — Eventbrite event ID. Headers:
                     "eventbrite", "eb id", "ticket id", "url"

Output STRICT JSON only, no preamble, no markdown:

  {
    "priority_number": 0,
    "city_name": 1,
    "day": 2,
    "crawl_number": 3,
    "eventbrite_id": null
  }

Use null when no column matches (only allowed for eventbrite_id).
If you can't confidently map a REQUIRED field, set the value to
-1 (the import will surface this as "no match found, please pick
a column").

Trust the SAMPLE DATA more than the header name when they
disagree. e.g. a header named "City" but the data column has
integers 1-10 is probably actually priority.

Do NOT invent indices — every value must be a valid 0-based
index into the header, or null, or -1.`;

interface MapperRawOutput {
  priority_number: number | null;
  city_name: number | null;
  day: number | null;
  crawl_number: number | null;
  eventbrite_id: number | null;
}

export interface CsvColumnMapping {
  priority_number: number | null;
  city_name: number | null;
  day: number | null;
  crawl_number: number | null;
  eventbrite_id: number | null;
  /** Indices the model marked as "couldn't figure out" — UI shows
   *  these as required-but-unmapped so the operator can pick. */
  unmappedRequired: Array<"priority_number" | "city_name" | "day" | "crawl_number">;
}

/**
 * Suggest a column mapping for the given CSV. Returns null when
 * AI isn't available or the input is empty/malformed.
 *
 * NEVER throws — caller can safely call without try/catch.
 */
export async function suggestCsvMapping(input: {
  csv: string;
  staffId: string;
}): Promise<CsvColumnMapping | null> {
  if (!isAiConfigured()) return null;
  if (!isAiFeatureEnabled("csv_mapping")) return null;
  if (!input.csv) return null;

  // Per-staff rate limit. This is a rare action (operator imports
  // maybe a few times per week) so 5/min is plenty. Mostly here to
  // catch a misbehaving UI that fires on every keystroke.
  const limit = checkAiRateLimit({
    feature: "csv_mapping",
    staffId: input.staffId,
    max: 5,
  });
  if (!limit.ok) {
    logger.warn(
      { staffId: input.staffId, retryAfterMs: limit.retryAfterMs },
      "csv mapping rate limited",
    );
    return null;
  }

  // Pull first 4 lines (header + 3 data rows). Each capped at
  // 1000 chars so a one-cell-with-200KB-of-text row can't blow
  // up the input.
  const lines = input.csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((l) => truncateForAi(l, 1000));
  if (lines.length < 2) return null;

  const header = lines[0];
  if (!header) return null;
  const headerCols = splitCsvLine(header);
  if (headerCols.length === 0) return null;
  if (headerCols.length > 50) {
    // Defensive — 50+ columns is almost certainly a malformed
    // paste. Don't spend tokens trying to map it.
    logger.warn({ headerLen: headerCols.length }, "csv mapping skipped — too many columns");
    return null;
  }

  const userPrompt = `Header (0-indexed):
${headerCols.map((c, i) => `  [${i}] "${c}"`).join("\n")}

Sample data rows:
${lines.slice(1).join("\n")}

Return the JSON mapping object.`;

  const start = Date.now();
  const aiResult = await generateCompletion({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    model: MAPPER_MODEL,
    maxTokens: MAPPER_MAX_TOKENS,
    tag: "ai-csv-mapping",
  });
  const elapsedMs = Date.now() - start;

  if (!aiResult.ok) {
    logger.warn({ reason: aiResult.reason, elapsedMs }, "csv mapping completion failed");
    return null;
  }

  const parsed = parseMapperResponse(aiResult.text);
  if (!parsed) {
    logger.warn({ raw: aiResult.text.slice(0, 200) }, "csv mapping JSON parse failed");
    return null;
  }

  // Validate every claimed index is in range. Indices outside the
  // header are clamped to null (treated as "no match"). -1 marks
  // "model couldn't decide" — surfaced to UI so the operator picks.
  const validIndex = (n: number | null): number | null => {
    if (n === null) return null;
    if (n === -1) return -1; // sentinel — kept as-is
    if (!Number.isInteger(n) || n < 0 || n >= headerCols.length) return null;
    return n;
  };

  const mapping: CsvColumnMapping = {
    priority_number: validIndex(parsed.priority_number),
    city_name: validIndex(parsed.city_name),
    day: validIndex(parsed.day),
    crawl_number: validIndex(parsed.crawl_number),
    eventbrite_id: validIndex(parsed.eventbrite_id),
    unmappedRequired: [],
  };

  // Identify required fields the model marked as -1 OR null.
  const requiredFields: Array<"priority_number" | "city_name" | "day" | "crawl_number"> = [
    "priority_number",
    "city_name",
    "day",
    "crawl_number",
  ];
  for (const f of requiredFields) {
    if (mapping[f] === -1 || mapping[f] === null) {
      mapping.unmappedRequired.push(f);
    }
  }

  // Convert -1 sentinels to null for the final shape (the UI only
  // needs to know "this is unmapped"; -1 served its purpose as a
  // model output signal).
  for (const f of requiredFields) {
    if (mapping[f] === -1) mapping[f] = null;
  }

  logger.info(
    {
      elapsedMs,
      mapped: requiredFields.filter((f) => mapping[f] !== null).length,
      unmapped: mapping.unmappedRequired.length,
    },
    "csv mapping suggested",
  );

  return mapping;
}

function parseMapperResponse(raw: string): MapperRawOutput | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1));
    if (!json || typeof json !== "object") return null;
    const coerce = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };
    return {
      priority_number: coerce(json.priority_number),
      city_name: coerce(json.city_name),
      day: coerce(json.day),
      crawl_number: coerce(json.crawl_number),
      eventbrite_id: coerce(json.eventbrite_id),
    };
  } catch {
    return null;
  }
}

/**
 * Rewrite a raw CSV using the suggested column mapping so the
 * existing strict importer (which insists on canonical headers)
 * sees what it expects.
 *
 * Strategy: keep the data rows untouched, but build a new header
 * row + reordered columns matching the canonical order. The
 * importer's parseCsv then runs with no changes.
 *
 * Returns null when the mapping isn't complete enough (any
 * required field unmapped).
 */
export function applyMappingToCsv(opts: {
  csv: string;
  mapping: CsvColumnMapping;
}): string | null {
  const m = opts.mapping;
  if (m.unmappedRequired.length > 0) return null;
  if (m.priority_number === null || m.city_name === null) return null;
  if (m.day === null || m.crawl_number === null) return null;

  const lines = opts.csv.split(/\r?\n/);
  const dataLines = lines.slice(1).filter((l) => l.trim() !== "");

  // Canonical header order. eventbrite_id is appended only when
  // mapped — the parser treats it as optional.
  const includeEb = m.eventbrite_id !== null;
  const headerOut = ["priority_number", "city_name", "day", "crawl_number"];
  if (includeEb) headerOut.push("eventbrite_id");

  const out: string[] = [headerOut.join(",")];
  for (const line of dataLines) {
    const cols = splitCsvLine(line);
    const row = [
      escapeCell(cols[m.priority_number] ?? ""),
      escapeCell(cols[m.city_name] ?? ""),
      escapeCell(cols[m.day] ?? ""),
      escapeCell(cols[m.crawl_number] ?? ""),
    ];
    if (includeEb && m.eventbrite_id !== null) {
      row.push(escapeCell(cols[m.eventbrite_id] ?? ""));
    }
    out.push(row.join(","));
  }
  return out.join("\n");
}

// Minimal CSV splitter mirroring the parseCsv splitCsvLine in
// _actions-import.ts. Kept here so this module doesn't import
// from server-only action files (which would force-bundle the
// import action into anything that touches the mapper).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur.trim());
  return out;
}

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

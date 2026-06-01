import "server-only";

/**
 * Venue resolver — exact → trgm → stub.
 *
 * Used by the Halloween 2025 import + future bulk ingest flows.
 * NO external API calls — runs entirely against the local DB.
 *
 * Pipeline:
 *   1. EXACT match on (city_id, lower(name)). Fastest, most reliable.
 *   2. TRIGRAM match on the same scope, threshold 0.5. Handles
 *      operator typos and stylistic variants ("Smiths Bar" vs
 *      "Smith's Bar", "TBD Lounge" vs "TBD's Lounge").
 *   3. STUB create — when nothing matches, create the venue with
 *      whatever data the source gave us (name + address + email +
 *      phone). These stubs get flagged in the dry-run report so
 *      the operator (via Claude Code + Claude in Chrome) can
 *      verify against Google Maps and clean up name/address
 *      formatting in a follow-up pass.
 *
 * Source-of-truth rule: this module NEVER overwrites operator data.
 *   - When matching an existing venue, we don't touch its name,
 *     address, or operator-edited fields.
 *   - When backfilling, we ONLY set fields that are currently
 *     NULL on the venue (email, phone, address, capacity).
 */

import { venues } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, isNull, sql } from "drizzle-orm";

const TRGM_SIMILARITY_THRESHOLD = 0.5;

export type ResolveDecision = "exact" | "trgm" | "stub_new" | "skipped";

export interface ResolveInput {
  name: string;
  cityId: string;
  source?: {
    email?: string | null;
    phoneRaw?: string | null;
    address?: string | null;
    capacity?: number | null;
    contactName?: string | null;
  };
  dryRun?: boolean;
}

export interface ResolveResult {
  decision: ResolveDecision;
  venueId: string | null;
  similarity: number | null;
  resolvedName: string | null;
  resolvedAddress: string | null;
  fieldBackfills: Array<"email" | "phoneE164" | "address" | "capacity" | "contactName">;
  wouldCreate: boolean;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export async function resolveVenue(input: ResolveInput): Promise<ResolveResult> {
  const name = input.name?.trim();
  if (!name) {
    return {
      decision: "skipped",
      venueId: null,
      resolvedName: null,
      resolvedAddress: null,
      similarity: null,
      fieldBackfills: [],
      wouldCreate: false,
    };
  }

  // ---------------- 1. Exact match ----------------
  const exactRow = await db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      email: venues.email,
      phoneE164: venues.phoneE164,
      capacity: venues.capacity,
      contactName: venues.contactName,
    })
    .from(venues)
    .where(
      and(
        eq(venues.cityId, input.cityId),
        sql`lower(${venues.name}) = lower(${name})`,
        isNull(venues.archivedAt),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  if (exactRow) {
    const fieldBackfills = await maybeBackfill({
      venueId: exactRow.id,
      input,
      existing: exactRow,
      dryRun: input.dryRun ?? false,
    });
    return {
      decision: "exact",
      venueId: exactRow.id,
      resolvedName: exactRow.name,
      resolvedAddress: exactRow.address,
      similarity: null,
      fieldBackfills,
      wouldCreate: false,
    };
  }

  // ---------------- 2. Trigram match ----------------
  const trgmRow = await db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      email: venues.email,
      phoneE164: venues.phoneE164,
      capacity: venues.capacity,
      contactName: venues.contactName,
      similarity: sql<number>`similarity(${venues.name}, ${name})`,
    })
    .from(venues)
    .where(
      and(
        eq(venues.cityId, input.cityId),
        isNull(venues.archivedAt),
        sql`similarity(${venues.name}, ${name}) >= ${TRGM_SIMILARITY_THRESHOLD}`,
      ),
    )
    .orderBy(sql`similarity(${venues.name}, ${name}) DESC`)
    .limit(1)
    .then((r) => r[0]);

  if (trgmRow) {
    const fieldBackfills = await maybeBackfill({
      venueId: trgmRow.id,
      input,
      existing: trgmRow,
      dryRun: input.dryRun ?? false,
    });
    return {
      decision: "trgm",
      venueId: trgmRow.id,
      resolvedName: trgmRow.name,
      resolvedAddress: trgmRow.address,
      similarity: trgmRow.similarity,
      fieldBackfills,
      wouldCreate: false,
    };
  }

  // ---------------- 3. Stub create ----------------
  if (input.dryRun) {
    return {
      decision: "stub_new",
      venueId: null,
      resolvedName: name,
      resolvedAddress: input.source?.address ?? null,
      similarity: null,
      fieldBackfills: [],
      wouldCreate: true,
    };
  }

  const stubId = await createStubVenue({
    cityId: input.cityId,
    name,
    sourceContacts: input.source,
  });
  return {
    decision: "stub_new",
    venueId: stubId,
    resolvedName: name,
    resolvedAddress: input.source?.address ?? null,
    similarity: null,
    fieldBackfills: [],
    wouldCreate: false,
  };
}

// =========================================================================
// Backfill helper
// =========================================================================

interface MatchedVenueRow {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  phoneE164: string | null;
  capacity: number | null;
  contactName: string | null;
}

async function maybeBackfill(opts: {
  venueId: string;
  input: ResolveInput;
  existing: MatchedVenueRow;
  dryRun: boolean;
}): Promise<ResolveResult["fieldBackfills"]> {
  const filled: ResolveResult["fieldBackfills"] = [];
  const src = opts.input.source;
  if (!src) return filled;

  const updates: Record<string, unknown> = {};

  if (!opts.existing.email && src.email) {
    updates.email = src.email.trim().toLowerCase();
    filled.push("email");
  }
  if (!opts.existing.phoneE164 && src.phoneRaw) {
    const e164 = normalizePhone(src.phoneRaw);
    if (e164) {
      updates.phoneE164 = e164;
      filled.push("phoneE164");
    }
  }
  if (!opts.existing.address && src.address) {
    updates.address = src.address.trim();
    filled.push("address");
  }
  if (!opts.existing.capacity && src.capacity && src.capacity > 0) {
    updates.capacity = src.capacity;
    filled.push("capacity");
  }
  if (!opts.existing.contactName && src.contactName) {
    updates.contactName = src.contactName.trim();
    filled.push("contactName");
  }

  if (Object.keys(updates).length === 0) return filled;
  if (opts.dryRun) return filled;

  await db.update(venues).set(updates).where(eq(venues.id, opts.venueId));
  return filled;
}

async function createStubVenue(opts: {
  cityId: string;
  name: string;
  sourceContacts?: ResolveInput["source"];
}): Promise<string> {
  const phone = normalizePhone(opts.sourceContacts?.phoneRaw);
  const values = {
    cityId: opts.cityId,
    name: opts.name,
    address: opts.sourceContacts?.address ?? null,
    email: opts.sourceContacts?.email?.trim().toLowerCase() ?? null,
    phoneE164: phone ?? null,
    capacity: opts.sourceContacts?.capacity ?? null,
    contactName: opts.sourceContacts?.contactName?.trim() || null,
    venueType: [] as string[],
  };
  const [row] = await db.insert(venues).values(values).returning({ id: venues.id });
  if (!row) {
    logger.error({ values }, "createStubVenue: insert returned no row");
    throw new Error("Failed to create stub venue");
  }
  return row.id;
}

"use server";

/**
 * Admin → AI venue-type backfill (Haiku ROI #8).
 *
 * Sweeps the venues table for rows with empty venueType arrays and
 * asks Haiku for the right tag(s) from a fixed vocabulary. The
 * operator's manual edits are NEVER overwritten — the WHERE clause
 * filters out any venue with a non-empty venueType, and a
 * defensive re-check inside the lib write path ensures the row is
 * still empty before the UPDATE.
 *
 * Admin-only (requireStaff with role check).
 * NEVER throws — failures return ok:false with a user-readable
 * message.
 */

import { backfillVenueTypes } from "@/lib/ai-venue-type-tag";
import { requireStaff } from "@/lib/auth";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export async function backfillVenueTypesForAdmin(input?: {
  /** Optional scope — when set, only venues in this city are
   *  scanned. Useful when the operator wants to tag a single
   *  city before a campaign push without spending on a global
   *  backfill. */
  cityId?: string;
}): Promise<
  ActionResult<{
    scanned: number;
    tagged: number;
    failed: number;
    batches: number;
    hasMore: boolean;
  }>
> {
  const { staff } = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Admin role required." };
  }

  try {
    const result = await backfillVenueTypes({
      staffId: staff.id,
      cityId: input?.cityId,
    });
    // Many surfaces depend on venue type. Rather than enumerate
    // them, revalidate the admin page (which is what triggered
    // the call) plus the city-campaigns root since most users
    // immediately go look at the cold-outreach table.
    revalidatePath("/admin");
    revalidatePath("/city-campaigns");
    logger.info(
      {
        staffId: staff.id,
        cityScope: input?.cityId ?? "global",
        ...result,
      },
      "venue-type backfill complete",
    );
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, cityId: input?.cityId }, "venue-type backfill failed");
    return { ok: false, error: "Venue tag backfill failed." };
  }
}

/**
 * Count venues with empty venueType arrays. Cheap — partial
 * index from migration 0078 makes this O(empty-rows). Surfaces
 * the "X to go" number in the admin panel.
 */
export async function getUntaggedVenueCount(): Promise<number> {
  const { staff } = await requireStaff();
  if (staff.role !== "admin") return 0;
  const { db } = await import("@/lib/db");
  const { venues } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(venues)
    .where(sql`cardinality(${venues.venueType}) = 0`);
  return row?.n ?? 0;
}

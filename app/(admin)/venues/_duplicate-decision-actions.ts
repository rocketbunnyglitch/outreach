"use server";

/**
 * Duplicate decision actions (CRM plan D1) — the three human rulings on
 * a candidate duplicate pair, all recorded in venue_duplicate_decisions
 * so the checker never re-warns:
 *
 *   - mergeDuplicateVenues: fold source into survivor (lib/venue-merge:
 *     full relation re-pointing, history preserved). Admin-only — a
 *     merge re-points outreach history and is effectively irreversible.
 *   - recordDuplicateDecision('same_org' | 'not_duplicate'): keep both
 *     venues, remember the ruling.
 *
 * listVenueDuplicates feeds the venue-page Duplicates card: candidates
 * for THIS venue, with already-ruled pairs filtered out.
 */

import { venues } from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { type VenueDuplicate, findVenueDuplicates } from "@/lib/venue-duplicates";
import { type MergeResult, mergeVenues } from "@/lib/venue-merge";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listVenueDuplicates(
  venueId: string,
): Promise<ActionResult<{ duplicates: VenueDuplicate[] }>> {
  await requireStaff();
  if (!UUID_RE.test(venueId)) return { ok: false, error: "Invalid venue id." };
  try {
    const [v] = await db
      .select({
        name: venues.name,
        address: venues.address,
        cityId: venues.cityId,
        phoneE164: venues.phoneE164,
        email: venues.email,
        websiteUrl: venues.websiteUrl,
      })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!v) return { ok: false, error: "Venue not found." };
    const duplicates = await findVenueDuplicates({
      candidateName: v.name,
      candidateAddress: v.address,
      candidatePhoneE164: v.phoneE164,
      candidateEmail: v.email,
      candidateWebsiteUrl: v.websiteUrl,
      cityId: v.cityId,
      subjectVenueId: venueId,
      limit: 6,
    });
    return { ok: true, data: { duplicates } };
  } catch (err) {
    logger.error({ err, venueId }, "listVenueDuplicates failed");
    return { ok: false, error: "Couldn't check for duplicates." };
  }
}

export async function recordDuplicateDecision(input: {
  venueAId: string;
  venueBId: string;
  decision: "same_org" | "not_duplicate";
  reason?: string;
}): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "outreach")) {
    return { ok: false, error: "Read-only access cannot record duplicate decisions." };
  }
  if (!UUID_RE.test(input.venueAId) || !UUID_RE.test(input.venueBId)) {
    return { ok: false, error: "Invalid venue ids." };
  }
  if (input.venueAId === input.venueBId) return { ok: false, error: "Same venue twice." };
  if (input.decision !== "same_org" && input.decision !== "not_duplicate") {
    return { ok: false, error: "Invalid decision." };
  }
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.execute(sql`
        INSERT INTO venue_duplicate_decisions
          (venue_low_id, venue_high_id, decision, reason, decided_by)
        VALUES (
          LEAST(${input.venueAId}::uuid, ${input.venueBId}::uuid),
          GREATEST(${input.venueAId}::uuid, ${input.venueBId}::uuid),
          ${input.decision},
          ${input.reason ?? null},
          ${staff.id}::uuid
        )
        ON CONFLICT (venue_low_id, venue_high_id) DO UPDATE
          SET decision = ${input.decision},
              reason = ${input.reason ?? null},
              decided_by = ${staff.id}::uuid
      `);
    });
    revalidatePath(`/venues/${input.venueAId}`);
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, ...input }, "recordDuplicateDecision failed");
    return { ok: false, error: "Couldn't record the decision." };
  }
}

export async function mergeDuplicateVenues(input: {
  sourceId: string;
  destId: string;
  reason?: string;
}): Promise<ActionResult<MergeResult>> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Only admins can merge venues (it re-points all history)." };
  }
  if (!UUID_RE.test(input.sourceId) || !UUID_RE.test(input.destId)) {
    return { ok: false, error: "Invalid venue ids." };
  }
  const result = await mergeVenues({
    sourceId: input.sourceId,
    destId: input.destId,
    byStaffId: staff.id,
    reason: input.reason,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "Merge failed." };
  revalidatePath(`/venues/${input.destId}`);
  revalidatePath("/venues");
  return { ok: true, data: result };
}

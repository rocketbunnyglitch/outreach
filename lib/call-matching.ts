import "server-only";

/**
 * Caller matching — attribute an inbound call's number to a venue, staff
 * member, or prior caller. Priority (per spec): venue main phone → staff cell
 * → prior matched call from the same number → weak area-code hint. The
 * area-code result is NEVER treated as confirmed; it's a suggestion only.
 *
 * Note: there's no venue-contacts / night-of-contacts table yet, so those
 * sources aren't consulted — when they exist they slot in ahead of the
 * area-code fallback.
 */

import { callLogs, staffMembers, venues } from "@/db/schema";
import type { CallMatchType } from "@/lib/crawl-support-types";
import { db } from "@/lib/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export interface CallMatch {
  matchType: CallMatchType;
  venueId: string | null;
  staffId: string | null;
  areaCode: string | null;
}

/** Best-effort area code (NANP) or leading area digits — a weak hint only. */
export function extractAreaCode(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null;
}

export async function matchCaller(e164: string | null | undefined): Promise<CallMatch> {
  const areaCode = extractAreaCode(e164);
  if (!e164) return { matchType: "none", venueId: null, staffId: null, areaCode };

  // 1) Venue main phone (exact).
  const [venue] = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.phoneE164, e164))
    .limit(1);
  if (venue) return { matchType: "venue", venueId: venue.id, staffId: null, areaCode };

  // 2) Staff cell (exact).
  const [staff] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.phoneE164, e164))
    .limit(1);
  if (staff) return { matchType: "staff", venueId: null, staffId: staff.id, areaCode };

  // 3) Prior matched call from the same number.
  const [prior] = await db
    .select({ venueId: callLogs.matchedVenueId, staffId: callLogs.matchedStaffId })
    .from(callLogs)
    .where(and(eq(callLogs.fromE164, e164), isNotNull(callLogs.matchedVenueId)))
    .orderBy(desc(callLogs.occurredAt))
    .limit(1);
  if (prior?.venueId) {
    return { matchType: "prior", venueId: prior.venueId, staffId: prior.staffId ?? null, areaCode };
  }

  // 4) Weak area-code hint — never confirmed.
  if (areaCode) return { matchType: "area_code", venueId: null, staffId: null, areaCode };
  return { matchType: "none", venueId: null, staffId: null, areaCode };
}

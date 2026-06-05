import "server-only";

/**
 * Venue x outreach-brand relationship helpers (Phase 3.9/3.10/3.11).
 * [ReferenceDoc 3.3]
 *
 * Reads/writes venue_domain_relationships (Phase 3.8). Kept separate from the
 * operator form action (venues/_relationship-actions.ts) so the classifier and
 * send pipeline can update/read flags server-side without a FormData round-trip.
 */

import { type RelationshipStatus, venueDomainRelationships } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface RelationshipSnapshot {
  status: RelationshipStatus;
  notes: string | null;
  setAt: Date;
  autoClearAt: Date | null;
}

/** Current relationship for a venue x brand; null when there's no row. */
export async function getVenueBrandRelationship(
  venueId: string,
  outreachBrandId: string,
): Promise<RelationshipSnapshot | null> {
  const [row] = await db
    .select({
      status: venueDomainRelationships.status,
      notes: venueDomainRelationships.notes,
      setAt: venueDomainRelationships.setAt,
      autoClearAt: venueDomainRelationships.autoClearAt,
    })
    .from(venueDomainRelationships)
    .where(
      and(
        eq(venueDomainRelationships.venueId, venueId),
        eq(venueDomainRelationships.outreachBrandId, outreachBrandId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Phase 3.9: update the venue x brand flag from an inbound classification.
 *   - hard_no       -> bad, auto_clear_at = now + 1 year (authoritative: they
 *                      asked to stop, so this overrides any prior flag)
 *   - engaged       -> neutral ONLY when no row exists yet (never downgrade a
 *                      good/bad; positive 'good' needs an explicit signal)
 *   - cancelled_by_them / anything else -> no-op (don't punish cancellations)
 * Best-effort: a failure here never blocks classification.
 */
export async function autoFlagRelationshipFromClassification(args: {
  venueId: string;
  outreachBrandId: string;
  classification: string;
}): Promise<void> {
  const { venueId, outreachBrandId, classification } = args;
  try {
    if (classification === "hard_no") {
      const now = new Date();
      await db
        .insert(venueDomainRelationships)
        .values({
          venueId,
          outreachBrandId,
          status: "bad",
          setBy: "auto_inbound",
          notes: "Auto-flagged bad from a hard-no / unsubscribe reply.",
          autoClearAt: new Date(now.getTime() + ONE_YEAR_MS),
        })
        .onConflictDoUpdate({
          target: [venueDomainRelationships.venueId, venueDomainRelationships.outreachBrandId],
          set: {
            status: "bad",
            setBy: "auto_inbound",
            notes: "Auto-flagged bad from a hard-no / unsubscribe reply.",
            setAt: now,
            autoClearAt: new Date(now.getTime() + ONE_YEAR_MS),
          },
        });
    } else if (classification === "engaged") {
      await db
        .insert(venueDomainRelationships)
        .values({
          venueId,
          outreachBrandId,
          status: "neutral",
          setBy: "auto_inbound",
          notes: "Auto-set neutral on first engagement.",
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    logger.error({ err, venueId, outreachBrandId, classification }, "autoFlagRelationship failed");
  }
}

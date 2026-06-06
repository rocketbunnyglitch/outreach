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
import { relationshipActionForClassification } from "@/lib/relationship-classification-map";
import { and, eq } from "drizzle-orm";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
 *
 * Uses the pure mapping in lib/relationship-classification-map.ts so the real
 * classifier labels (lib/ai-classify.ts VALID_CLASSIFICATIONS) drive the flag.
 * The earlier version checked "hard_no" / "engaged" -- labels the classifier
 * NEVER emits -- so this auto-flag never fired.
 *
 *   - unsubscribe (conf >= 0.9)              -> bad, auto_clear_at = now + 1yr,
 *                                               set_by = auto_inbound. Hard block;
 *                                               manager-only manual clear. Does NOT
 *                                               clobber an existing manual_operator
 *                                               'bad' (operator intent wins).
 *   - interested / warm / confirmed (>= 0.9) -> neutral ONLY when no row exists
 *                                               (onConflictDoNothing). NEVER 'good',
 *                                               NEVER downgrades an existing row.
 *   - decline / cancelled_by_them / stalled_warm / everything else -> no-op.
 *                                               Cancellations are never auto-bad
 *                                               (Reference Doc 7.16.4); decline is
 *                                               handled at the cadence level.
 *   - anything below 0.9 confidence          -> no-op (operator triages).
 *
 * Best-effort: a failure here never blocks classification.
 */
export async function autoFlagRelationshipFromClassification(args: {
  venueId: string;
  outreachBrandId: string;
  classification: string;
  confidence: number;
}): Promise<void> {
  const { venueId, outreachBrandId, classification, confidence } = args;
  const decision = relationshipActionForClassification(classification, confidence);
  if (decision.action === "none") return;

  try {
    if (decision.action === "set_bad") {
      const now = new Date();
      const autoClearAt = new Date(now.getTime() + (decision.autoClearDays ?? 365) * MS_PER_DAY);

      // Don't clobber an existing manual_operator 'bad' -- an operator's explicit
      // bad flag (and its notes / clear policy) outranks an auto write. Refresh
      // the auto_clear window for any other case so the unsubscribe is honored.
      const [existing] = await db
        .select({
          status: venueDomainRelationships.status,
          setBy: venueDomainRelationships.setBy,
        })
        .from(venueDomainRelationships)
        .where(
          and(
            eq(venueDomainRelationships.venueId, venueId),
            eq(venueDomainRelationships.outreachBrandId, outreachBrandId),
          ),
        )
        .limit(1);

      if (existing && existing.status === "bad" && existing.setBy === "manual_operator") {
        logger.info(
          { venueId, outreachBrandId, classification },
          "autoFlagRelationship: kept existing manual_operator bad (no clobber)",
        );
        return;
      }

      await db
        .insert(venueDomainRelationships)
        .values({
          venueId,
          outreachBrandId,
          status: "bad",
          setBy: "auto_inbound",
          notes: "Auto-flagged bad from an unsubscribe reply (>= 0.9 confidence).",
          autoClearAt,
        })
        .onConflictDoUpdate({
          target: [venueDomainRelationships.venueId, venueDomainRelationships.outreachBrandId],
          set: {
            status: "bad",
            setBy: "auto_inbound",
            notes: "Auto-flagged bad from an unsubscribe reply (>= 0.9 confidence).",
            setAt: now,
            autoClearAt,
          },
        });
      return;
    }

    if (decision.action === "ensure_neutral") {
      // Create a neutral row ONLY when none exists. Never updates an existing
      // row -- we never auto-upgrade to 'good' and never downgrade good/bad.
      await db
        .insert(venueDomainRelationships)
        .values({
          venueId,
          outreachBrandId,
          status: "neutral",
          setBy: "auto_inbound",
          notes: "Auto-set neutral on first positive engagement.",
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    logger.error({ err, venueId, outreachBrandId, classification }, "autoFlagRelationship failed");
  }
}

import "server-only";

/**
 * Phase 4 — Transactional auto sends for the confirmation cascade.
 *
 * When a venue_event transitions to 'confirmed' AND the outreach brand
 * is at Phase 4, this module queues the 4 cascade emails (poster
 * delivery, 2-week confirm, 1-week confirm, floor brief) as scheduled
 * sends with sendKind=transactional — bypassing the cold-send throttle
 * since these go to confirmed relationships.
 *
 * Templates picked by stage:
 *   - poster_delivery     → "Deliver poster" cascade slot
 *   - confirm_2_week      → "2-week confirm"
 *   - confirm_1_week      → "1-week confirm"
 *   - floor_staff_3_day   → "Floor staff brief"
 *
 * Each scheduled at the corresponding daysBefore the event_date.
 * Poster delivery fires NOW (no specific date).
 *
 * If the brand has no template for a given stage, that slot is silently
 * skipped (the existing task-based cascade still covers it; operator
 * sees the task in their queue).
 */

import { emailTemplates, scheduledSends } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { phaseCapability } from "@/lib/outreach-phase";
import { and, eq, inArray } from "drizzle-orm";

interface CascadeSendOpts {
  venueId: string;
  venueEventId: string;
  outreachBrandId: string;
  brandPhase: 1 | 2 | 3 | 4;
  eventDate: Date;
  staffMemberId: string;
  staffOutreachEmailId: string;
  recipientEmail: string;
}

interface CascadeStage {
  stage: "poster_delivery" | "confirm_2_week" | "confirm_1_week" | "floor_staff_3_day";
  scheduleFor: Date;
  label: string;
}

export async function queueCascadeSends(opts: CascadeSendOpts): Promise<{
  queued: number;
  skipped: string[];
}> {
  // Phase 4 gate
  if (!phaseCapability.canAutoTransactional(opts.brandPhase)) {
    return { queued: 0, skipped: ["brand not at Phase 4"] };
  }

  const now = new Date();
  const daysBefore = (n: number): Date => {
    const d = new Date(opts.eventDate);
    d.setUTCDate(d.getUTCDate() - n);
    // Snap to 10am local-ish (we don't know the city TZ here cheaply;
    // worker re-checks business hours so this is just a hint)
    d.setHours(10, 0, 0, 0);
    return d;
  };

  // Stages in cascade order. If a stage's scheduleFor is already in the
  // past (i.e. event is < 14 days away when this fires), the scheduled
  // send fires immediately on the next worker tick — that's correct
  // behavior since the operator is already behind.
  const stages: CascadeStage[] = [
    { stage: "poster_delivery", scheduleFor: now, label: "Poster delivery" },
    { stage: "confirm_2_week", scheduleFor: daysBefore(14), label: "2-week confirm" },
    { stage: "confirm_1_week", scheduleFor: daysBefore(7), label: "1-week confirm" },
    { stage: "floor_staff_3_day", scheduleFor: daysBefore(3), label: "Floor staff brief" },
  ];

  // Look up all templates in one query
  const templates = await db
    .select({
      id: emailTemplates.id,
      stage: emailTemplates.stage,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.outreachBrandId, opts.outreachBrandId),
        inArray(emailTemplates.stage, [
          "poster_delivery",
          "confirm_2_week",
          "confirm_1_week",
          "floor_staff_3_day",
        ]),
      ),
    );

  const templateByStage = new Map(templates.map((t) => [t.stage, t.id]));

  const rowsToInsert: Array<typeof scheduledSends.$inferInsert> = [];
  const skipped: string[] = [];

  for (const stage of stages) {
    const templateId = templateByStage.get(stage.stage);
    if (!templateId) {
      skipped.push(`${stage.label}: no ${stage.stage} template for this brand`);
      continue;
    }
    rowsToInsert.push({
      staffMemberId: opts.staffMemberId,
      staffOutreachEmailId: opts.staffOutreachEmailId,
      outreachBrandId: opts.outreachBrandId,
      venueId: opts.venueId,
      venueEventId: opts.venueEventId,
      recipientEmail: opts.recipientEmail,
      emailTemplateId: templateId,
      status: "pending",
      sendKind: "transactional",
      scheduledFor: stage.scheduleFor,
      batchLabel: `Cascade · ${stage.label}`,
      createdBy: opts.staffMemberId,
      updatedBy: opts.staffMemberId,
    });
  }

  if (rowsToInsert.length === 0) return { queued: 0, skipped };

  try {
    await db.insert(scheduledSends).values(rowsToInsert);
    logger.info(
      {
        venueEventId: opts.venueEventId,
        brandId: opts.outreachBrandId,
        queued: rowsToInsert.length,
        skipped,
      },
      "phase 4 cascade sends queued",
    );
    return { queued: rowsToInsert.length, skipped };
  } catch (err) {
    logger.error({ err, venueEventId: opts.venueEventId }, "cascade send insert failed");
    return { queued: 0, skipped: [...skipped, "insert failed"] };
  }
}

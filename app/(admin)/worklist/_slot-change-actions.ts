"use server";

/**
 * Slot-change swap actions (Phase 3.5). [ReferenceDoc 9.4]
 *
 * When a confirmed venue replies "we can only do Friday" / "can we switch to
 * the late slot", the operator cleanly cancels the original confirmed slot and
 * re-confirms the venue into a new open slot. Detection is the heuristic FLAG
 * (lib/slot-change-detect) -- the SWAP here is fully operator-driven: the
 * operator picks the target (event, role, slot_position).
 *
 *   loadSlotChangeOptions(threadId)  -> current confirmed slot(s) for the
 *       thread's venue + the open (event, role, slot_position) targets on the
 *       campaign's events to swap INTO.
 *   approveSlotSwap(input)           -> cancel the old venue_event
 *       (triggerVenueCancellation) then create/confirm the new one, firing the
 *       confirmation cascade + lifecycle scheduler (mirrors reconfirmCancelledVenue
 *       and the confirm branch of events/_venue-event-actions).
 *   dismissSlotChange(threadId)      -> clear the flag (no swap needed).
 */

import { events, emailThreads, venueEvents, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { triggerVenueCancellation } from "@/lib/cancellation-flow";
import { generateConfirmationCascade } from "@/lib/confirmation-cascade";
import { db, withAuditContext } from "@/lib/db";
import { resolveEngineRole } from "@/lib/engine-roles";
import type { ActionResult } from "@/lib/form-utils";
import { scheduleLifecycle } from "@/lib/lifecycle-scheduler";
import { logger } from "@/lib/logger";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type VenueRole = "wristband" | "middle" | "final" | "alt_final";
const VENUE_ROLES: readonly VenueRole[] = ["wristband", "middle", "final", "alt_final"];

// The standard slots a crawl always has, used to enumerate swap-into targets.
// wristband + final are single-slot (position 1); middle defaults to two
// (M1, M2). alt_final is operator-added per-event and is enumerated from the
// rows that already exist (handled below), so it is not in the base grid.
const BASE_SLOT_GRID: ReadonlyArray<{ role: VenueRole; slotPosition: number }> = [
  { role: "wristband", slotPosition: 1 },
  { role: "middle", slotPosition: 1 },
  { role: "middle", slotPosition: 2 },
  { role: "final", slotPosition: 1 },
];

export interface SlotChangeCurrentSlot {
  venueEventId: string;
  eventId: string;
  eventDate: string;
  role: string;
  slotPosition: number | null;
}

export interface SlotChangeOpenSlot {
  eventId: string;
  eventDate: string;
  crawlNumber: number | null;
  routeLabel: string | null;
  role: VenueRole;
  slotPosition: number;
}

export interface SlotChangeOptions {
  venueId: string;
  venueName: string;
  current: SlotChangeCurrentSlot[];
  open: SlotChangeOpenSlot[];
}

/**
 * For the swap picker: the venue's CURRENT confirmed slot(s) (what we cancel)
 * and the OPEN (event, role, slot_position) targets across the thread's city
 * campaign's events (what we confirm into). "Open" = not already filled by a
 * confirmed venue_event at that exact coordinate (mirrors the city-sheet slot
 * logic: a confirmed row owns the slot).
 */
export async function loadSlotChangeOptions(
  threadId: string,
): Promise<ActionResult<SlotChangeOptions>> {
  // Auth gate only; the loader is read-only and not staff-scoped.
  await requireStaff();
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };

  try {
    // Thread -> venue + city campaign. The flag is only ever set on threads
    // whose venue holds a confirmed event, so a missing venue is a no-op.
    const [thread] = await db
      .select({
        venueId: emailThreads.venueId,
        cityCampaignId: emailThreads.cityCampaignId,
      })
      .from(emailThreads)
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!thread?.venueId) {
      return { ok: false, error: "This thread has no venue attached." };
    }
    const venueId = thread.venueId;

    const [venueRow] = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);

    // Current confirmed slot(s) for this venue.
    const currentRows = await db
      .select({
        venueEventId: venueEvents.id,
        eventId: venueEvents.eventId,
        eventDate: events.eventDate,
        role: venueEvents.role,
        slotPosition: venueEvents.slotPosition,
      })
      .from(venueEvents)
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .where(and(eq(venueEvents.venueId, venueId), eq(venueEvents.status, "confirmed")))
      .orderBy(asc(events.eventDate));

    // Scope the swap-into search to the city campaign. Prefer the thread's
    // cityCampaignId; fall back to the confirmed slots' campaign so the picker
    // still works when the thread was never campaign-tagged.
    let cityCampaignId = thread.cityCampaignId ?? null;
    if (!cityCampaignId && currentRows[0]) {
      const [ev] = await db
        .select({ cityCampaignId: events.cityCampaignId })
        .from(events)
        .where(eq(events.id, currentRows[0].eventId))
        .limit(1);
      cityCampaignId = ev?.cityCampaignId ?? null;
    }

    const open: SlotChangeOpenSlot[] = [];
    if (cityCampaignId) {
      const campaignEvents = await db
        .select({
          eventId: events.id,
          eventDate: events.eventDate,
          crawlNumber: events.crawlNumber,
          routeLabel: events.routeLabel,
        })
        .from(events)
        .where(eq(events.cityCampaignId, cityCampaignId))
        .orderBy(asc(events.eventDate));

      // Which (event, role, slot_position) coordinates are already taken by a
      // confirmed venue_event -- those are NOT offered as swap targets.
      const filled = await db
        .select({
          eventId: venueEvents.eventId,
          role: venueEvents.role,
          slotPosition: venueEvents.slotPosition,
        })
        .from(venueEvents)
        .innerJoin(events, eq(events.id, venueEvents.eventId))
        .where(and(eq(events.cityCampaignId, cityCampaignId), eq(venueEvents.status, "confirmed")));
      const filledKeys = new Set(
        filled.map((f) => `${f.eventId}:${f.role}:${f.slotPosition ?? 1}`),
      );

      for (const ev of campaignEvents) {
        for (const slot of BASE_SLOT_GRID) {
          const key = `${ev.eventId}:${slot.role}:${slot.slotPosition}`;
          if (filledKeys.has(key)) continue;
          open.push({
            eventId: ev.eventId,
            eventDate: ev.eventDate,
            crawlNumber: ev.crawlNumber,
            routeLabel: ev.routeLabel,
            role: slot.role,
            slotPosition: slot.slotPosition,
          });
        }
      }
    }

    return {
      ok: true,
      data: {
        venueId,
        venueName: venueRow?.name ?? "Venue",
        current: currentRows.map((r) => ({
          venueEventId: r.venueEventId,
          eventId: r.eventId,
          eventDate: r.eventDate,
          role: r.role,
          slotPosition: r.slotPosition ?? null,
        })),
        open,
      },
    };
  } catch (err) {
    logger.error({ err, threadId }, "loadSlotChangeOptions failed");
    return { ok: false, error: "Couldn't load swap options." };
  }
}

export interface ApproveSlotSwapInput {
  threadId: string;
  fromVenueEventId: string;
  toEventId: string;
  toRole: VenueRole;
  toSlotPosition: number | null;
}

/**
 * Cancel the venue's current confirmed slot and confirm it into the new one.
 *
 * Order mirrors the spec: cancel FIRST (triggerVenueCancellation stops the old
 * slot's lifecycle emails + tasks and drafts the T16), THEN create/confirm the
 * new venue_event and fire the confirmation cascade + lifecycle scheduler --
 * exactly as reconfirmCancelledVenue / the confirm branch of
 * events/_venue-event-actions do. The flag is cleared on success.
 */
export async function approveSlotSwap(
  input: ApproveSlotSwapInput,
): Promise<ActionResult<{ toVenueEventId: string }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(input.threadId)) return { ok: false, error: "Invalid thread id." };
  if (!UUID_RE.test(input.fromVenueEventId)) return { ok: false, error: "Invalid source slot." };
  if (!UUID_RE.test(input.toEventId)) return { ok: false, error: "Invalid target crawl." };
  if (!VENUE_ROLES.includes(input.toRole)) return { ok: false, error: "Invalid target role." };
  const toSlotPosition = input.toSlotPosition ?? 1;
  if (!Number.isInteger(toSlotPosition) || toSlotPosition < 1 || toSlotPosition > 20) {
    return { ok: false, error: "Invalid target slot position." };
  }

  try {
    // Resolve the venue (and verify the source slot exists) up front.
    const [fromRow] = await db
      .select({ venueId: venueEvents.venueId })
      .from(venueEvents)
      .where(eq(venueEvents.id, input.fromVenueEventId))
      .limit(1);
    if (!fromRow) return { ok: false, error: "Original slot not found." };
    const venueId = fromRow.venueId;

    const [graphicsDesignerId, lifecycleOwnerId] = await Promise.all([
      resolveEngineRole(staff.teamId, "graphics_designer"),
      resolveEngineRole(staff.teamId, "lifecycle_owner"),
    ]);

    // 1. Cancel the original slot (stops its lifecycle + tasks, drafts T16).
    const cancellation = await triggerVenueCancellation({
      venueEventId: input.fromVenueEventId,
      reason: "Venue requested a slot change (operator-approved swap).",
      byStaffId: staff.id,
      teamId: staff.teamId,
    });
    if (!cancellation.ok) {
      return { ok: false, error: "Couldn't cancel the original slot." };
    }

    // 2. Create-or-confirm the new venue_event and fire the cascade atomically.
    const toVenueEventId = await withAuditContext(staff.id, async (tx) => {
      const existing = await tx
        .select({ id: venueEvents.id })
        .from(venueEvents)
        .where(
          and(
            eq(venueEvents.eventId, input.toEventId),
            eq(venueEvents.role, input.toRole),
            eq(venueEvents.slotPosition, toSlotPosition),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      let id: string;
      if (existing) {
        // Re-point an existing (e.g. previously-cleared / lead) row at our venue
        // and confirm it.
        await tx
          .update(venueEvents)
          .set({
            venueId,
            status: "confirmed",
            confirmedAt: new Date(),
            cancelledAt: null,
            cancellationReason: null,
            cancelledBy: null,
            updatedBy: staff.id,
          })
          .where(eq(venueEvents.id, existing.id));
        id = existing.id;
      } else {
        const [created] = await tx
          .insert(venueEvents)
          .values({
            eventId: input.toEventId,
            venueId,
            role: input.toRole,
            slotPosition: toSlotPosition,
            status: "confirmed",
            confirmedAt: new Date(),
            ourContactStaffId: staff.id,
            createdBy: staff.id,
            updatedBy: staff.id,
          })
          .returning({ id: venueEvents.id });
        if (!created) throw new Error("insert returned no row");
        id = created.id;
      }

      await generateConfirmationCascade(tx, id, { graphicsDesignerId });
      return id;
    });

    // 3. Schedule the post-confirm lifecycle emails for the new slot
    // (best-effort, outside the tx -- mirrors reconfirmCancelledVenue).
    await scheduleLifecycle({
      venueEventId: toVenueEventId,
      ownerStaffId: lifecycleOwnerId ?? staff.id,
      teamId: staff.teamId,
    }).catch((err) => logger.error({ err }, "slot-swap: lifecycle scheduling failed"));

    // 4. Clear the slot-change flag on the thread.
    await db
      .update(emailThreads)
      .set({
        slotChangeRequested: false,
        slotChangeDetectedAt: null,
        slotChangePhrase: null,
        updatedBy: staff.id,
      })
      .where(eq(emailThreads.id, input.threadId));

    revalidatePath("/worklist");
    revalidatePath(`/events/${input.toEventId}`);
    return { ok: true, data: { toVenueEventId } };
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "approveSlotSwap failed");
    return { ok: false, error: "Couldn't complete the slot swap." };
  }
}

/**
 * No swap needed -- clear the heuristic flag so the row drops off the worklist.
 */
export async function dismissSlotChange(threadId: string): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  try {
    await db
      .update(emailThreads)
      .set({
        slotChangeRequested: false,
        slotChangeDetectedAt: null,
        slotChangePhrase: null,
        updatedBy: staff.id,
      })
      .where(eq(emailThreads.id, threadId));
    revalidatePath("/worklist");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, threadId }, "dismissSlotChange failed");
    return { ok: false, error: "Couldn't dismiss." };
  }
}

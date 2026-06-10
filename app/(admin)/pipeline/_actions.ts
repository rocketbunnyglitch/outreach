"use server";

/**
 * Pipeline board mutations. [CRM buildout, Phase 10 + Phase 5 gates]
 *
 * Moving a card between lanes sets the venue_event status. The Confirmed move
 * is gated (contact + proposed hours) and DELEGATES to updateVenueEvent so the
 * confirmation cascade (auto-tasks, graphics deliverable, lifecycle drafts,
 * notifications) fires exactly as it does from the venue-event form -- we never
 * write a raw status that would skip it.
 */

import { venueEvents, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  type LaneKey,
  checkStageGate,
  isDropTarget,
  laneToStatus,
} from "@/lib/pipeline-board-core";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { updateVenueEvent } from "../events/_venue-event-actions";

export interface MoveResult {
  ok: boolean;
  error?: string;
  missing?: string[];
}

export async function moveVenueEventStage(
  venueEventId: string,
  targetLane: LaneKey,
): Promise<MoveResult> {
  await requireStaff();

  if (!isDropTarget(targetLane)) {
    return { ok: false, error: "That column can't be set by dragging." };
  }
  const targetStatus = laneToStatus(targetLane);
  if (!targetStatus) {
    return { ok: false, error: "That column isn't a move target." };
  }

  const [row] = await db
    .select({
      status: venueEvents.status,
      slotStartTime: venueEvents.slotStartTime,
      agreedHoursText: venueEvents.agreedHoursText,
      nightOfContactName: venueEvents.nightOfContactName,
      nightOfContactPhone: venueEvents.nightOfContactPhoneE164,
      email: venues.email,
      phoneE164: venues.phoneE164,
      contactName: venues.contactName,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(eq(venueEvents.id, venueEventId))
    .limit(1);
  if (!row) return { ok: false, error: "Venue event not found." };

  // Server-side lock mirror of DRAGGABLE_LANES: confirmed+ and cancelled cards
  // are locked on the board (un-confirming / cancelling has its own flow, and
  // re-confirming would re-fire the whole confirmation cascade). The client
  // only disables dragging -- enforce it here so a direct action call can't
  // demote a confirmed or cancelled venue_event.
  const LOCKED_STATUSES = new Set([
    "confirmed",
    "scheduled",
    "contract_signed",
    "declined",
    "cancelled",
  ]);
  if (LOCKED_STATUSES.has(row.status)) {
    return {
      ok: false,
      error:
        "Confirmed and cancelled cards are locked — use the venue event form or the cancellation flow.",
    };
  }

  // Already there -- nothing to do.
  if (row.status === targetStatus) return { ok: true };

  const hasContact = Boolean(
    row.email ||
      row.phoneE164 ||
      row.contactName ||
      row.nightOfContactName ||
      row.nightOfContactPhone,
  );
  const hasHours = Boolean(row.slotStartTime || row.agreedHoursText?.trim());
  const gate = checkStageGate(targetLane, { hasContact, hasHours });
  if (!gate.ok) {
    return {
      ok: false,
      error: `Can't confirm yet — add ${gate.missing.join(" and ")}.`,
      missing: gate.missing,
    };
  }

  // Delegate (status only) so the confirmation cascade runs on -> confirmed.
  const fd = new FormData();
  fd.set("status", targetStatus);
  const result = await updateVenueEvent(venueEventId, null, fd);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Update failed." };
  }

  revalidatePath("/pipeline");
  return { ok: true };
}

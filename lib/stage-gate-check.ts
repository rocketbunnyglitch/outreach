import "server-only";

/**
 * Server-side confirmed-stage gate (CRM build plan A1, 2026-06-11).
 *
 * The pipeline board already runs checkStageGate before a drag into
 * Confirmed — but the OTHER two confirm paths (the events-page form
 * and the city-sheet status select) skipped it, so staff could create
 * "fake progress": confirmed venues with no way to contact them and
 * no agreed time. One shared loader + the SAME pure core now gates
 * all three sites identically.
 *
 * Requirements to confirm (same as the board): a contact method
 * (venue email, phone, contact name, or a night-of contact) AND
 * proposed hours or a slot time. Both are sub-minute fixes when
 * missing, and both are prerequisites for the entire post-confirm
 * lifecycle — blocking here prevents downstream T9-T17 chaos, not
 * busywork.
 */

import { venueEvents, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { checkStageGate } from "@/lib/pipeline-board-core";
import { eq } from "drizzle-orm";

/** Form values arriving in the SAME save as the confirm — confirming
 *  while filling the contact/hours in one submit must pass. undefined
 *  = field not in this save (stored value applies). */
export interface ConfirmGateOverlay {
  slotStartTime?: string | null;
  agreedHoursText?: string | null;
  nightOfContactName?: string | null;
  nightOfContactPhoneE164?: string | null;
}

/**
 * Run the confirmed-lane gate for one venue_event. Returns null when
 * the transition may proceed, else an actionable error message.
 */
export async function confirmGateError(
  venueEventId: string,
  overlay: ConfirmGateOverlay = {},
): Promise<string | null> {
  const [row] = await db
    .select({
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
  if (!row) return "Venue event not found.";

  const pick = <T>(incoming: T | undefined, stored: T): T =>
    incoming === undefined ? stored : incoming;

  const nightName = pick(overlay.nightOfContactName, row.nightOfContactName);
  const nightPhone = pick(overlay.nightOfContactPhoneE164, row.nightOfContactPhone);
  const slotStart = pick(overlay.slotStartTime, row.slotStartTime);
  const agreedHours = pick(overlay.agreedHoursText, row.agreedHoursText);

  const hasContact = Boolean(
    row.email || row.phoneE164 || row.contactName || nightName || nightPhone,
  );
  const hasHours = Boolean(slotStart || agreedHours?.trim());
  const gate = checkStageGate("confirmed", { hasContact, hasHours });
  if (gate.ok) return null;
  return `Can't confirm yet — missing ${gate.missing.join(" and ")}. Add ${
    gate.missing.length === 1 ? "it" : "them"
  } to the venue/slot first (takes under a minute, and the post-confirm emails need it).`;
}

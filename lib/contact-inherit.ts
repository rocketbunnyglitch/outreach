/**
 * Inherit-unless-overridden resolution for venue-event contact + hours
 * (linkage-gap fix 2026-06-11).
 *
 * The same real-world facts live in two layers:
 *   - venues.contact_name / phone_e164 / hours  (the venue record)
 *   - venue_events.night_of_contact_* / agreed_hours_text (per-slot)
 *
 * Before this helper, displays read ONLY the per-slot layer, so fixing
 * a phone number on the venue record left every existing slot showing
 * the stale value (staff would call the old number on crawl night).
 * Resolution rule: the slot value wins when present; otherwise the
 * venue record shows through, flagged `inherited` so surfaces can
 * label it ("venue main line").
 *
 * Pure + client-safe: no db, no server-only.
 */

export interface EffectiveContact {
  name: string | null;
  phone: string | null;
  /** True when BOTH fields came from the venue record (no slot override). */
  inherited: boolean;
}

export function effectiveNightOfContact(
  slot: { nightOfContactName: string | null; nightOfContactPhoneE164: string | null },
  venue: { contactName: string | null; phoneE164: string | null },
): EffectiveContact {
  const name = slot.nightOfContactName?.trim() || null;
  const phone = slot.nightOfContactPhoneE164?.trim() || null;
  if (name || phone) {
    // Partial override: a typed name with no phone still falls back to
    // the venue's main line (and vice versa).
    return {
      name: name ?? venue.contactName?.trim() ?? null,
      phone: phone ?? venue.phoneE164?.trim() ?? null,
      inherited: false,
    };
  }
  return {
    name: venue.contactName?.trim() || null,
    phone: venue.phoneE164?.trim() || null,
    inherited: true,
  };
}

export interface EffectiveHours {
  text: string | null;
  /** True when the text came from venues.hours, not the slot. */
  inherited: boolean;
}

export function effectiveAgreedHours(
  slot: { agreedHoursText: string | null },
  venue: { hours: string | null },
): EffectiveHours {
  const own = slot.agreedHoursText?.trim() || null;
  if (own) return { text: own, inherited: false };
  const venueHours = venue.hours?.trim() || null;
  return { text: venueHours, inherited: venueHours != null };
}

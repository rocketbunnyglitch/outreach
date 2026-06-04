/**
 * Pure formatting helpers for the template merge-context builder
 * (lib/template-merge-context.ts). No DB / server-only, so they are
 * unit-testable and shared by the server builder.
 *
 * These turn raw rows (venue roles, dates, pay cents, open-slot sets) into the
 * exact strings the seeded Halloween templates expect mid-sentence, e.g.
 * "around {{guest_count}} people", "Open: {{thu_open_slots}}",
 * "{{open_slots}} open". Grounded in the real template bodies, not the spec.
 */

export type VenueRole = "wristband" | "middle" | "final" | "alt_final";
export type DayPart =
  | "thursday_night"
  | "friday_night"
  | "saturday_day"
  | "saturday_night"
  | "sunday_day"
  | "sunday_night"
  | "other";

/** Standard crawl slot windows by role (from the seeded T4/T5 bodies). */
export const STANDARD_SLOT_TIME: Record<"wristband" | "middle" | "final", string> = {
  wristband: "7:30 PM to 10:30 PM",
  middle: "8:30 PM to 11:30 PM",
  final: "11:30 PM to 2:00 AM",
};

/** Day-party slot windows (the afternoon crawl has only wristband + middle). */
export const DAY_SLOT_TIME: Record<"wristband" | "middle", string> = {
  wristband: "1:00 PM to 4:00 PM",
  middle: "3:00 PM to 8:00 PM",
};

/** Venue-facing label for a crawl role ("Participating" for middle). */
export function roleLabel(role: VenueRole): string {
  if (role === "wristband") return "Wristband";
  if (role === "middle") return "Participating";
  return "Final"; // final + alt_final
}

/**
 * A rich, venue-facing slot line for the detailed open-slots list, e.g.
 * "Wristband Venue (7:30 PM to 10:30 PM): check-in, where guests pick up their
 * wristbands to start the night". Night vs day-party times + descriptions.
 */
export function detailedSlotLine(role: VenueRole, isDay: boolean): string {
  const key: "wristband" | "middle" | "final" = role === "alt_final" ? "final" : role;
  const time = isDay && key !== "final" ? DAY_SLOT_TIME[key] : STANDARD_SLOT_TIME[key];
  const desc = isDay
    ? {
        wristband: "check-in, where guests pick up their wristbands to start",
        middle: "a stop on the crawl with an open bar-hop window",
        final: "the final stop",
      }
    : {
        wristband: "check-in, where guests pick up their wristbands to start the night",
        middle: "a middle stop on the crawl, shared with 2-3 other venues",
        final: "the final stop where everyone meets to end the night",
      };
  return `${roleLabel(role)} Venue (${time}): ${desc[key]}`;
}

/** "Saturday, October 31" (date-only, pinned to UTC -- the VPS clock is UTC). */
export function formatEventDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Saturday" */
export function eventDayName(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/** "Saturday, Oct 31" */
export function shortDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Thursday night" / "Saturday day". */
export function dayPartLabel(dp: DayPart): string {
  switch (dp) {
    case "thursday_night":
      return "Thursday night";
    case "friday_night":
      return "Friday night";
    case "saturday_night":
      return "Saturday night";
    case "saturday_day":
      return "Saturday day";
    case "sunday_night":
      return "Sunday night";
    case "sunday_day":
      return "Sunday day";
    default:
      return "the crawl";
  }
}

/** "1 crawl" / "2 crawls". */
export function crawlsCountLabel(n: number): string {
  return `${n} crawl${n === 1 ? "" : "s"}`;
}

/** Oxford-comma "a, b, and c"; "a and b"; "a". */
export function joinAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")}, and ${last}`;
}

/** Distinct role labels in canonical crawl order (wristband, participating, final). */
export function canonicalRoleLabels(roles: VenueRole[]): string[] {
  const present = new Set(roles);
  const out: string[] = [];
  for (const r of ["wristband", "middle", "final"] as const) {
    if (present.has(r)) out.push(roleLabel(r));
  }
  return out;
}

/**
 * Open-slot phrase from the set of open roles, lowercased to read inside
 * "We have {{open_slots}} open" / "Open: {{thu_open_slots}}". Empty set reads
 * "fully booked".
 */
export function openSlotsLabel(openRoles: VenueRole[]): string {
  const labels = canonicalRoleLabels(openRoles).map((l) => l.toLowerCase());
  if (labels.length === 0) return "fully booked";
  return joinAnd(labels);
}

/**
 * Reduce a turnout-helper number phrase to a bare count/range for templates
 * that wrap it ("around {{guest_count}} people"). The seeded numbers carry
 * qualifiers ("about 200") or descriptive tails ("around 20 split across
 * stops, steady flow - total ~50") that would double up with the template's
 * own "around". Prefer an explicit "total ~N"; otherwise strip a leading
 * qualifier and keep the leading number or range.
 */
export function guestCount(raw: string): string {
  const total = /total ~?(\d+)/.exec(raw);
  if (total?.[1]) return total[1];
  const stripped = raw.replace(/^(about|around)\s+/i, "").replace(/^~/, "");
  const lead = /^\d+(?:\s*-\s*\d+)?/.exec(stripped);
  return lead ? lead[0].replace(/\s+/g, "") : stripped;
}

/** "$25/hr CAD" from minor units; empty string when no rate. */
export function payRateLabel(cents: number, currency: string): string {
  if (!cents) return "";
  const dollars = cents / 100;
  const amount = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${amount}/hr ${currency}`;
}

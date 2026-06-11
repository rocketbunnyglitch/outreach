/**
 * Pure core for the durable lineup change log (CRM plan B1). No db, no
 * server-only — safe to unit test and to import from anywhere.
 *
 * The one job here is the payload sanitizer: the public_payload column
 * is served verbatim to EXTERNAL consumers through the engine API, so
 * it must only ever contain public lineup facts. Internal notes,
 * contact details, DNC reasons, and financials are never public
 * (never-do #6) — an allowlist (not a blocklist) is the only shape of
 * filter that fails safe when someone adds a new field upstream.
 */

export type LineupChangeType =
  | "confirmed"
  | "swapped"
  | "cancelled"
  | "slot_changed"
  | "times_changed"
  | "venue_added"
  | "venue_removed";

/** Keys allowed out the door in public_payload. Everything else is
 *  dropped silently. Add a key ONLY if it appears on the public map /
 *  Eventbrite listing already. */
const PUBLIC_PAYLOAD_KEYS = [
  "venueName",
  "role",
  "slotPosition",
  "slotStartTime",
  "slotEndTime",
  "previousStatus",
  "newStatus",
  "detail",
] as const;

type PublicPayloadKey = (typeof PUBLIC_PAYLOAD_KEYS)[number];

const ALLOWED = new Set<string>(PUBLIC_PAYLOAD_KEYS);

/**
 * Filter an arbitrary payload down to the public-safe allowlist.
 * Values must be primitives (string/number/boolean) — nested objects
 * are dropped too, so a whole venue row passed by mistake leaks
 * nothing.
 */
export function sanitizeLineupPayload(
  payload: Record<string, unknown> | null | undefined,
): Partial<Record<PublicPayloadKey, string | number | boolean>> {
  if (!payload) return {};
  const out: Partial<Record<PublicPayloadKey, string | number | boolean>> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED.has(key)) continue;
    if (value === null || value === undefined) continue;
    const t = typeof value;
    if (t !== "string" && t !== "number" && t !== "boolean") continue;
    out[key as PublicPayloadKey] = value as string | number | boolean;
  }
  return out;
}

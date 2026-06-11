/**
 * Venue activity timeline -- PURE core (no db, no "server-only"), so the entry
 * type + the sort/filter helpers are unit-tested and client-importable. The DB
 * read + the per-source mapping live in lib/venue-activity.ts; this module only
 * defines the shared shape and the (deterministic) merge/filter logic the
 * client timeline runs when the operator toggles a filter.
 *
 * One unified chronological feed merges what the venue page otherwise scatters
 * across tabs: emails, calls, manual touches, notes, tasks, slot lifecycle
 * (assigned / confirmed / cancelled), floor-staff (V2) outcomes, wristband
 * shipments and relationship-flag changes.
 */

export type VenueActivityType =
  | "email"
  | "call"
  | "touch"
  | "note"
  | "task"
  | "slot"
  | "confirmation"
  | "cancellation"
  | "v2_call"
  | "wristband"
  | "relationship"
  | "deliverable"
  | "override";

export type ActivityTone = "positive" | "negative" | "neutral";

export interface VenueActivityEntry {
  /** Stable key, unique across sources (e.g. "email:<threadId>"). */
  id: string;
  type: VenueActivityType;
  /** ISO timestamp -- the sort key. */
  at: string;
  /** Pre-formatted display label (built server-side, pinned tz) so the client
   *  never does date/locale work that could trip hydration. */
  atLabel: string;
  title: string;
  detail?: string | null;
  /** Who did it, when known. */
  actor?: string | null;
  /** Campaign context, when the source has it (slot/confirm/cancel/v2/wristband
   *  + campaign-scoped touches). Null for venue-global sources (notes, emails,
   *  relationship flags) -- those drop out when a specific campaign is picked. */
  campaignId?: string | null;
  campaignName?: string | null;
  /** Deep link to the original record, when there is one. */
  href?: string | null;
  tone?: ActivityTone;
}

export const ACTIVITY_TYPE_LABEL: Record<VenueActivityType, string> = {
  email: "Email",
  call: "Call",
  touch: "Touch",
  note: "Note",
  task: "Task",
  slot: "Slot",
  confirmation: "Confirmed",
  cancellation: "Cancelled",
  v2_call: "Floor staff",
  wristband: "Wristband",
  relationship: "Relationship",
  deliverable: "Deliverable",
  override: "Override",
};

/** Newest first. Stable for equal timestamps (preserves input order). */
export function sortActivityDesc(entries: VenueActivityEntry[]): VenueActivityEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = Date.parse(a.e.at);
      const tb = Date.parse(b.e.at);
      if (tb !== ta) return tb - ta;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}

export interface ActivityFilter {
  /** Keep only these types. Null/empty = all types. */
  types?: VenueActivityType[] | null;
  /** Keep only entries tied to this campaign. Null = all campaigns. Entries
   *  with no campaign context are hidden when a specific campaign is chosen. */
  campaignId?: string | null;
}

export function filterActivity(
  entries: VenueActivityEntry[],
  filter: ActivityFilter = {},
): VenueActivityEntry[] {
  const typeSet =
    filter.types && filter.types.length > 0 ? new Set<VenueActivityType>(filter.types) : null;
  return entries.filter((e) => {
    if (typeSet && !typeSet.has(e.type)) return false;
    if (filter.campaignId && e.campaignId !== filter.campaignId) return false;
    return true;
  });
}

/** The distinct types present, in canonical display order -- powers the chips. */
export function presentTypes(entries: VenueActivityEntry[]): VenueActivityType[] {
  const present = new Set(entries.map((e) => e.type));
  return (Object.keys(ACTIVITY_TYPE_LABEL) as VenueActivityType[]).filter((t) => present.has(t));
}

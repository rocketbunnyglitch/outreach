"use client";

import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  type CrawlCard,
  SLOT_ROLE_ORDER,
  type SlotRole,
  type SlotRow,
} from "@/lib/city-sheet-shared";
import { cn } from "@/lib/cn";
import type { NoteRow } from "@/lib/notes";
import { formatDayPart } from "@/lib/tracker-status-types";
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquare,
  PauseCircle,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addCrawlNote, deleteCrawlNote, loadCrawlNotes } from "../_note-actions";
import {
  assignSlotVenue,
  clearSlot,
  deleteCrawl,
  demoteVenueFromCrawl,
  setVenueEventDisabled,
  updateCrawl,
  updateSlotField,
} from "../_slot-actions";
import { Slot1HostControl } from "./crawl-slot1-host";
import { MiddleGroupPicker } from "./middle-group-picker";
import { VenueAutocomplete } from "./venue-autocomplete";

interface Props {
  crawl: CrawlCard;
  cityId: string;
  cityCampaignId: string;
  staff: Array<{ id: string; displayName: string }>;
}

/**
 * Editable crawl header — shows "Friday crawl 2 · Downtown loop" with
 * an inline editor (pencil) to rename / renumber, and a delete button.
 * Operators flagged (session 12) they want to manage crawls directly
 * from the city sheet rather than a separate setup screen.
 *
 * Uses formatDayPart() from tracker-status-types for the day prefix so
 * every value from the day_part enum renders correctly — saturday_day,
 * sunday_day, sunday_night, other, and null are all handled, where the
 * previous local DAY_LABEL was hard-coded to only 3 values and rendered
 * "undefined crawl 1" -> "crawl 1" for every other case.
 */
function CrawlHeader({
  crawl,
  cityCampaignId,
}: {
  crawl: CrawlCard;
  cityCampaignId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [num, setNum] = useState(String(crawl.crawlNumber));
  const [label, setLabel] = useState(crawl.routeLabel ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();

  function save() {
    setError(null);
    const parsedNum = Number(num);
    if (!Number.isInteger(parsedNum) || parsedNum < 1 || parsedNum > 99) {
      setError("Crawl number must be 1–99.");
      return;
    }
    startTx(async () => {
      try {
        const result = await updateCrawl({
          eventId: crawl.eventId,
          cityCampaignId,
          crawlNumber: parsedNum,
          routeLabel: label,
        });
        if (!result.ok) {
          setError(result.error ?? "Couldn't save.");
          return;
        }
        setEditing(false);
        router.refresh();
      } catch (err) {
        console.error("[crawl-header] updateCrawl failed", err);
        setError("Couldn't save — try again.");
      }
    });
  }

  function remove() {
    const name = `${formatDayPart(crawl.dayPart)} crawl ${crawl.crawlNumber}`;
    if (
      !confirm(
        `Delete "${name}"? This removes the crawl and all its venue slot assignments. This can't be undone.`,
      )
    ) {
      return;
    }
    startTx(async () => {
      try {
        const result = await deleteCrawl({ eventId: crawl.eventId, cityCampaignId });
        if (!result.ok) {
          setError(result.error ?? "Couldn't delete.");
          return;
        }
        router.refresh();
      } catch (err) {
        console.error("[crawl-header] deleteCrawl failed", err);
        setError("Couldn't delete — try again.");
      }
    });
  }

  if (editing) {
    return (
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            {formatDayPart(crawl.dayPart)} crawl
          </span>
          <input
            type="number"
            min={1}
            max={99}
            value={num}
            onChange={(e) => setNum(e.target.value)}
            disabled={pending}
            className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Crawl number"
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
            placeholder="Crawl name (optional)"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Crawl name"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 font-medium text-[11px] text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setNum(String(crawl.crawlNumber));
              setLabel(crawl.routeLabel ?? "");
              setError(null);
            }}
            disabled={pending}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && <span className="text-[11px] text-rose-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="group/crawlhdr flex items-baseline gap-3">
        <h3 className="font-semibold text-base tracking-tight">
          {/* When the operator has bulk-renamed the crawl (events.crawl_name
              set), the custom name REPLACES the auto label "Saturday
              crawl N". Otherwise the auto label renders so freshly-
              created crawls have a sensible default. Per operator: "I
              changed all Crawl 4 to a day party and name as Day Party
              but it doesn't show up on the crawl name on the individual
              cities" — the bug was that loadCitySheet wasn't SELECTing
              the crawl_name column at all, so the render never saw the
              operator's override. */}
          {crawl.crawlName ?? `${formatDayPart(crawl.dayPart)} crawl ${crawl.crawlNumber}`}
          {/* Sun icon when this crawl is classified as a day party.
              Matches the same affordance on the tracker (Round 1
              commit 2244135 added it to the CrawlSlotNeedGrid +
              CrawlGlowGrid day labels). Amber-500 to read as
              warm-daylight without competing with the wristband
              orange. */}
          {crawl.crawlFormat === "day_party" && (
            <span
              className="ml-1 align-middle text-amber-500 dark:text-amber-400"
              aria-label="day crawl"
              title="Day crawl (wristband + 2+ middles, no final)"
            >
              ☀
            </span>
          )}
          {crawl.routeLabel && (
            <span className="ml-2 font-normal text-zinc-500">· {crawl.routeLabel}</span>
          )}
        </h3>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          {crawl.eventDate}
          {crawl.middleGroupSharedWith.length > 0 && (
            <>
              {" · "}
              shared with{" "}
              <span className="text-zinc-700 dark:text-zinc-300">
                {crawl.middleGroupSharedWith.map((s) => s.label).join(", ")}
              </span>
            </>
          )}
        </span>
        <WristbandShipDot ship={crawl.wristbandShip} venueEventId={crawl.wristbandVenueEventId} />
        {/* Edit + delete affordances — appear on header hover to keep the
            calm state clean. */}
        <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover/crawlhdr:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={pending}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Edit crawl"
            title="Rename / renumber crawl"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded p-1 text-zinc-400 hover:bg-rose-500/[0.08] hover:text-rose-600"
            aria-label="Delete crawl"
            title="Delete crawl"
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Slot1HostControl
          eventId={crawl.eventId}
          cityCampaignId={cityCampaignId}
          slot1={crawl.hosts.find((h) => h.slot === 1)}
        />
        <WristbandStatusChip
          ship={crawl.wristbandShip}
          venueEventId={crawl.wristbandVenueEventId}
        />
      </div>
      <CrawlNotesControl eventId={crawl.eventId} cityCampaignId={cityCampaignId} />
    </div>
  );
}

/**
 * Tiny status dot for a crawl's wristband shipping, next to the crawl
 * header. red = not shipped, yellow = shipped, green = received. Hidden
 * when there's no wristband venue_event yet (nothing to ship). Clicking
 * opens the wristband sheet focused on this crawl's wristband.
 */
function WristbandShipDot({
  ship,
  venueEventId,
}: {
  ship: CrawlCard["wristbandShip"];
  venueEventId: string | null;
}) {
  if (ship === "none") return null;
  const config = {
    not_shipped: { tone: "bg-rose-500", label: "Wristbands: not shipped" },
    shipped: { tone: "bg-amber-500", label: "Wristbands: shipped, in transit" },
    received: { tone: "bg-emerald-500", label: "Wristbands: received" },
  }[ship];

  const dot = (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block h-2 w-2 rounded-full", config.tone)} aria-hidden />
      <span className="sr-only">{config.label}</span>
    </span>
  );

  if (!venueEventId) {
    return (
      <span title={config.label} className="inline-flex">
        {dot}
      </span>
    );
  }
  return (
    <Link
      href={`/wristbands?ve=${venueEventId}`}
      title={`${config.label} — open wristband sheet`}
      className="inline-flex rounded-full p-0.5 transition-transform hover:scale-125"
    >
      {dot}
    </Link>
  );
}

/**
 * Labeled wristband shipping status chip -- the wristband icon + a
 * "Not Shipped" / "Shipped" / "Received" label, color-coded red/amber/
 * green like the tracker table. Sits beside the slot-1 host selector so
 * operators see ship status without opening the wristband sheet. Hidden
 * when the crawl has no wristband venue yet (nothing to ship). Clicking
 * opens the wristband sheet for this crawl.
 */
function WristbandStatusChip({
  ship,
  venueEventId,
}: {
  ship: CrawlCard["wristbandShip"];
  venueEventId: string | null;
}) {
  if (ship === "none") return null;
  const { tone, label } =
    ship === "received"
      ? { tone: "text-green-500 dark:text-green-400", label: "Received" }
      : ship === "shipped"
        ? { tone: "text-amber-500 dark:text-amber-400", label: "Shipped" }
        : { tone: "text-red-500 dark:text-red-400", label: "Not Shipped" };
  const inner = (
    <span className={cn("inline-flex items-center gap-1 font-medium text-[11px]", tone)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" fill="currentColor" opacity="0.2" />
        <rect
          x="2.5"
          y="8.5"
          width="19"
          height="7"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      </svg>
      {label}
    </span>
  );
  if (!venueEventId) {
    return <span title={`Wristbands: ${label}`}>{inner}</span>;
  }
  return (
    <Link
      href={`/wristbands?ve=${venueEventId}`}
      title={`Wristbands: ${label} -- open wristband sheet`}
      className="inline-flex rounded-md px-1 py-0.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {inner}
    </Link>
  );
}

/**
 * Collapsible per-crawl notes. Notes attach to the event via the
 * polymorphic notes table (target_type='event'). Lazy-loads on first
 * open (same pattern as the host picker) so the city sheet stays light.
 * Author-only delete (enforced server-side; surfaced via isOwnNote).
 */
function CrawlNotesControl({
  eventId,
  cityCampaignId,
}: {
  eventId: string;
  cityCampaignId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();

  function toggle() {
    setError(null);
    const next = !open;
    setOpen(next);
    if (next && notes === null) {
      startTx(async () => {
        try {
          setNotes(await loadCrawlNotes({ eventId }));
        } catch (err) {
          console.error("[crawl-notes] load failed", err);
          setError("Couldn't load notes.");
        }
      });
    }
  }

  function add() {
    const body = draft.trim();
    if (!body) return;
    startTx(async () => {
      try {
        const result = await addCrawlNote({ eventId, cityCampaignId, body });
        if (!result.ok) {
          setError(result.error ?? "Couldn't save.");
          return;
        }
        setDraft("");
        setError(null);
        setNotes(await loadCrawlNotes({ eventId }));
        router.refresh();
      } catch (err) {
        console.error("[crawl-notes] add failed", err);
        setError("Couldn't save — try again.");
      }
    });
  }

  function remove(note: NoteRow) {
    startTx(async () => {
      try {
        const result = await deleteCrawlNote({ id: note.id, cityCampaignId });
        if (!result.ok) {
          setError(result.error ?? "Couldn't delete.");
          return;
        }
        setNotes((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
        router.refresh();
      } catch (err) {
        console.error("[crawl-notes] delete failed", err);
        setError("Couldn't delete — try again.");
      }
    });
  }

  const count = notes?.length ?? 0;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex w-fit items-center gap-1 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.14em] hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        <MessageSquare className="h-3 w-3" />
        Notes
        {notes !== null && count > 0 && <span className="text-zinc-500">({count})</span>}
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 border-dashed p-2 dark:border-zinc-700/60">
          {notes === null ? (
            <span className="text-[11px] text-zinc-500">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              Loading…
            </span>
          ) : notes.length === 0 ? (
            <span className="text-[11px] text-zinc-500">No notes yet.</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notes.map((n) => (
                <li key={n.id} className="group/note flex items-start gap-2 text-xs">
                  <div className="flex-1">
                    <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{n.body}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      {n.authorName} · {formatNoteTime(n.createdAt)}
                    </p>
                  </div>
                  {n.isOwnNote && (
                    <button
                      type="button"
                      onClick={() => remove(n)}
                      disabled={pending}
                      className="rounded p-0.5 text-zinc-400 opacity-0 transition-opacity hover:bg-rose-500/[0.08] hover:text-rose-600 group-hover/note:opacity-100"
                      aria-label="Delete note"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  add();
                }
              }}
              rows={1}
              placeholder="Add a note… (Enter to save, Shift+Enter for newline)"
              disabled={pending}
              className="min-h-[2rem] flex-1 resize-y rounded-md border border-zinc-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={add}
              disabled={pending || !draft.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 font-medium text-[11px] text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Save
            </button>
          </div>
          {error && <span className="text-[10px] text-rose-600">{error}</span>}
        </div>
      )}
    </div>
  );
}

/** Compact relative time for note timestamps (e.g. "3h ago", "May 2"). */
function formatNoteTime(d: Date): string {
  const date = d instanceof Date ? d : new Date(d);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto",
  });
}

const ROLE_LABEL: Record<SlotRole, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt Final",
};

const ROLE_TONE: Record<SlotRole, string> = {
  wristband: "bg-amber-400 text-amber-950",
  middle: "bg-orange-500 text-orange-50",
  final: "bg-red-500 text-red-50",
  alt_final: "bg-red-500/60 text-red-50 ring-1 ring-inset ring-red-500/30",
};

/**
 * Confirmed slot pill tone — green, applied when a slot's venue is
 * locked in (status='confirmed' or 'contract_signed'). Replaces the
 * role-specific yellow/orange/red so the operator can see at a glance
 * which slots are done and which are still in progress without
 * scanning the Status column.
 *
 * Same shape (alt_final keeps its ring affordance) so the swap reads
 * as a state change rather than a layout change.
 */
const ROLE_TONE_CONFIRMED: Record<SlotRole, string> = {
  wristband: "bg-emerald-500 text-emerald-50",
  middle: "bg-emerald-500 text-emerald-50",
  final: "bg-emerald-500 text-emerald-50",
  alt_final: "bg-emerald-500/70 text-emerald-50 ring-1 ring-inset ring-emerald-500/40",
};

/**
 * Pick the pill tone for a slot. When the slot has a venue assigned
 * AND that venue_event is in a confirmed lifecycle state, return the
 * green confirmed tone. Otherwise return the role-specific
 * yellow/orange/red default.
 *
 * "Confirmed" = status is 'confirmed' or 'contract_signed' (both
 * count as locked — contract_signed is the further-along state).
 */
function slotPillTone(slot: SlotRow): string {
  if (
    slot.venueEventId != null &&
    (slot.status === "confirmed" || slot.status === "contract_signed")
  ) {
    return ROLE_TONE_CONFIRMED[slot.role];
  }
  return ROLE_TONE[slot.role];
}

/**
 * Reuse chip -- shown when this slot's venue is ALSO used elsewhere in the
 * same city_campaign (another crawl and/or another role). Cross-crawl
 * reuse is legitimate in real Halloween ops, so this is informational
 * (sky-tinted, not a warning red). The full list of other usages is in
 * the tooltip.
 */
function ReuseChip({ reuse }: { reuse: SlotRow["reuse"] }) {
  if (!reuse || reuse.length === 0) return null;
  const detail = reuse.map((r) => `${ROLE_LABEL[r.role]} in ${r.crawlLabel}`).join(", ");
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 font-mono text-[9px] text-sky-700 uppercase tracking-[0.08em] dark:bg-sky-500/15 dark:text-sky-300"
      title={`Also used as ${detail} (same city campaign)`}
    >
      <Repeat2 className="h-2.5 w-2.5" aria-hidden />
      {reuse.length}x<span className="sr-only">Also used as {detail}</span>
    </span>
  );
}

/**
 * Single crawl's slot table.
 *
 * Layout — 9 columns, spreadsheet feel:
 *   Slot | Venue | Email | Phone | Scheduled By | Bar Contact | Hours | Capacity |
 *     Drink Specials | Status
 *
 * Each cell is inline editable. Cells without a venue assigned dim
 * gracefully and become active when a venue picks up. The slot label
 * column is non-editable (it's structural).
 *
 * Below the table, two affordances:
 *   + Middle slot (Middle 3, 4, …)
 *   + Alt Final (alternative final venues)
 *
 * Premium polish:
 *   • Hover surfaces invisible borders + subtle bg shift on editable cells
 *   • Saving indicator (spinner → check) appears at the right edge of
 *     each cell on commit
 *   • Slot label cell renders as a tight color chip matching the
 *     dashboard pill palette so the city dashboard and city sheet read
 *     as the same visual system
 */
export function CrawlSlotTable({ crawl, cityId, cityCampaignId, staff }: Props) {
  const [extraSlots, setExtraSlots] = useState<
    Array<{ role: "middle" | "alt_final"; slotPosition: number }>
  >([]);
  // Used for the server round-trip when deleting a slot that already has
  // a persisted venue_event. Adds are now purely local (no server call).
  const [, startSlotMutation] = useTransition();

  // Merge real slots with extras (UI placeholders for newly-added rows),
  // then sort by canonical role order so a just-added Middle 3 lands
  // among the middles rather than appended at the very end (after the
  // final / alt-finals). Mirrors the data-layer ordering.
  const realKeys = new Set(crawl.slots.map((s) => `${s.role}:${s.slotPosition}`));
  const allSlots: SlotRow[] = [
    ...crawl.slots,
    ...extraSlots
      .filter((e) => !realKeys.has(`${e.role}:${e.slotPosition}`))
      .map((e) => emptySlot(e.role, e.slotPosition)),
  ].sort(
    (a, b) => SLOT_ROLE_ORDER[a.role] - SLOT_ROLE_ORDER[b.role] || a.slotPosition - b.slotPosition,
  );

  function handleAddSlot(role: "middle" | "alt_final") {
    // Numbering must be derived on the client: extra slots are UI-only
    // placeholders that aren't persisted until a venue is assigned, so a
    // server-side max(slot_position) query can't see them and returned the
    // same position on every add — the "Alt Final 1" duplicate bug
    // (session-13). The merged slot list here is the source of truth.
    // Middles 1 & 2 are implicit defaults so extra middles start at 3;
    // alt-finals start at 1.
    const baseMin = role === "middle" ? 3 : 1;
    const maxForRole = [...crawl.slots, ...extraSlots]
      .filter((s) => s.role === role)
      .reduce((max, s) => Math.max(max, s.slotPosition), 0);
    const nextPosition = Math.max(maxForRole + 1, baseMin);
    setExtraSlots((s) => [...s, { role, slotPosition: nextPosition }]);
  }

  function handleDeleteSlot(slot: SlotRow) {
    // Drop the local placeholder for this (role, position)...
    setExtraSlots((s) =>
      s.filter((e) => !(e.role === slot.role && e.slotPosition === slot.slotPosition)),
    );
    // ...and if a venue was already persisted into the slot, delete that
    // venue_event so the row doesn't reappear from the server on refresh.
    if (slot.venueEventId) {
      const fd = new FormData();
      fd.set("venueEventId", slot.venueEventId);
      fd.set("cityCampaignId", cityCampaignId);
      startSlotMutation(async () => {
        await clearSlot(null, fd);
      });
    }
  }

  // "All venues confirmed" -- when every required slot row has a
  // venue_event in a confirmed/contract_signed state. Drives a green
  // outline + soft glow around the whole crawl section so the
  // operator can see at a glance which crawls are fully booked.
  //
  // TEMPLATE MODEL: middles are now the crawl's OWN editable
  // venue_events (a shared middle group only SEEDS them), so middle
  // confirmation reads from crawl.slots like every other role -- not
  // from a separate group-member roster. Required rows: wristband
  // always; final always except day_party; all middle rows.
  const isConfirmedStatus = (s: string | null | undefined) =>
    s === "confirmed" || s === "contract_signed" || s === "scheduled";
  const isDayParty = crawl.crawlFormat === "day_party";
  const requiredSlots = crawl.slots.filter((s) => {
    if (s.role === "wristband") return true;
    // Day party crawls don't have a final slot at all.
    if (s.role === "final" && s.slotPosition === 1 && !isDayParty) return true;
    if (s.role === "middle") return true;
    return false;
  });
  // Minimum required-slot counts (middles always count as the crawl's
  // own rows now):
  //   - standard:   wristband + 2 middles + final = 4
  //   - day_party:  wristband + 2 middles         = 3
  // Per operator: "day crawl is just a wristband venue and a minimum
  // of 2 middle venues but you can add more". NO final.
  const minSlots = isDayParty ? 3 : 4;
  const hasMinSlots = requiredSlots.length >= minSlots;
  const allVenuesConfirmed =
    hasMinSlots &&
    requiredSlots.every(
      (s) => !!s.venueEventId && isConfirmedStatus(s.status) && !s.temporarilyDisabled,
    );

  return (
    <section
      className={cn(
        "card-surface overflow-hidden transition-shadow duration-300",
        // Green outline + soft glow when the crawl is fully booked.
        // Uses ring (so the existing card-surface background stays
        // intact) + a same-color shadow for the glow effect.
        allVenuesConfirmed &&
          "shadow-[0_0_24px_-4px_rgba(16,185,129,0.35)] ring-2 ring-emerald-500/60 dark:shadow-[0_0_28px_-2px_rgba(16,185,129,0.4)] dark:ring-emerald-400/50",
      )}
    >
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <CrawlHeader crawl={crawl} cityCampaignId={cityCampaignId} />
        <div className="flex items-center gap-3">
          {allVenuesConfirmed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-700 uppercase tracking-[0.1em] ring-1 ring-emerald-500/30 ring-inset dark:text-emerald-300">
              <CheckCircle2 className="h-2.5 w-2.5" />
              All confirmed
            </span>
          )}
          {crawl.ticketsSold > 0 && (
            <span className="font-mono text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {crawl.ticketsSold}
              </span>{" "}
              tickets
            </span>
          )}
          <MiddleGroupPicker
            eventId={crawl.eventId}
            cityCampaignId={cityCampaignId}
            dayPart={crawl.dayPart}
            currentGroupId={crawl.middleVenueGroupId}
            currentGroupName={crawl.middleVenueGroupName}
          />
        </div>
      </header>

      {/* Shared middle group = TEMPLATE banner. The group no longer
          OWNS the middles -- attaching it copied its venues into this
          crawl's own editable Middle rows below (see
          _middle-group-actions.ts / city-sheet-data.ts). This banner is
          just a reference: which template seeded the middles, and which
          other crawls share it. Editing happens in the slot rows. */}
      {crawl.middleVenueGroupId && (
        <div className="border-zinc-200/60 border-b bg-orange-500/[0.04] px-5 py-2.5 dark:border-zinc-800/40 dark:bg-orange-500/[0.06]">
          <p className="font-mono text-[10px] text-orange-700 uppercase tracking-[0.12em] dark:text-orange-300">
            Middle template: {crawl.middleVenueGroupName}
            <span className="ml-2 text-orange-600/70 normal-case tracking-normal dark:text-orange-300/70">
              seeds the editable Middle rows below; edit them per crawl.
            </span>
          </p>
        </div>
      )}

      {/* Desktop table — hidden on mobile. 9 columns won't fit
          a phone, the cards below cover that case. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
              <th className="w-28 px-3 py-2">Slot</th>
              <th className="w-48 px-2 py-2">Venue</th>
              <th className="w-44 px-2 py-2">Email</th>
              <th className="w-32 px-2 py-2">Phone</th>
              <th className="w-28 px-2 py-2">Scheduled by</th>
              <th className="w-32 px-2 py-2">Bar contact</th>
              <th className="w-32 px-2 py-2">Hours</th>
              <th className="w-16 px-2 py-2 text-right">Cap</th>
              <th className="w-28 px-2 py-2">Drink specials</th>
              <th className="w-24 px-2 py-2">Status</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {allSlots.map((slot, i) => (
              <SlotTableRow
                key={`${slot.role}:${slot.slotPosition}`}
                slot={slot}
                crawl={crawl}
                cityId={cityId}
                cityCampaignId={cityCampaignId}
                staff={staff}
                zebra={i % 2 === 1}
                layout="table"
                onDelete={() => handleDeleteSlot(slot)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card stack — same data + edits, vertical layout */}
      <ul className="divide-y divide-zinc-200/60 md:hidden dark:divide-zinc-800/40">
        {allSlots.map((slot) => (
          <li key={`${slot.role}:${slot.slotPosition}`}>
            <SlotTableRow
              slot={slot}
              crawl={crawl}
              cityId={cityId}
              cityCampaignId={cityCampaignId}
              staff={staff}
              zebra={false}
              layout="card"
              onDelete={() => handleDeleteSlot(slot)}
            />
          </li>
        ))}
      </ul>

      {/* Add-slot affordances */}
      <footer className="flex items-center gap-3 border-zinc-200/60 border-t px-5 py-2.5 dark:border-zinc-800/40">
        <button
          type="button"
          onClick={() => handleAddSlot("middle")}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-orange-500/[0.08] hover:text-orange-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-orange-300"
        >
          <Plus className="h-3 w-3" />
          Middle slot
        </button>
        <button
          type="button"
          onClick={() => handleAddSlot("alt_final")}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-red-500/[0.08] hover:text-red-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-red-300"
        >
          <Plus className="h-3 w-3" />
          Alt final
        </button>
      </footer>
    </section>
  );
}

const CONFIRMED_SLOT_STATUSES = new Set(["confirmed", "contract_signed", "scheduled"]);

/**
 * Temporary disable / restore for a confirmed MIDDLE venue. Renders nothing
 * for any other role/status. Disabling reopens the slot in the outreach lists
 * (without losing the booking); Restore flips it straight back. Wristband and
 * final venues are too central to pause -- they get fully replaced instead.
 */
function DisableToggle({
  slot,
  cityCampaignId,
}: {
  slot: SlotRow;
  cityCampaignId: string;
}) {
  const [pending, startTx] = useTransition();
  const toast = useToast();
  if (
    slot.role !== "middle" ||
    !slot.venueEventId ||
    !CONFIRMED_SLOT_STATUSES.has(slot.status ?? "")
  ) {
    return null;
  }
  const disabled = slot.temporarilyDisabled;
  function toggle() {
    const veId = slot.venueEventId;
    if (!veId) return;
    const next = !disabled;
    const name = slot.venueName ?? "Venue";
    startTx(async () => {
      const res = await setVenueEventDisabled({
        venueEventId: veId,
        cityCampaignId,
        disabled: next,
      });
      if (!res.ok) {
        toast.show({
          kind: "error",
          message: res.error ?? "Couldn't update.",
          tag: "slot.disable",
        });
        return;
      }
      toast.show({
        kind: "success",
        message: next ? `${name} disabled - slot reopened.` : `${name} restored to the crawl.`,
      });
    });
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={
        disabled
          ? "Restore this venue to the crawl"
          : "Temporarily disable - reopens the slot, restore anytime"
      }
      aria-label={disabled ? "Restore venue" : "Temporarily disable venue"}
      className={cn(
        "rounded-md p-1 transition-colors disabled:opacity-50",
        disabled
          ? "text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
          : "text-zinc-400 hover:bg-amber-500/[0.08] hover:text-amber-600 dark:hover:text-amber-400",
      )}
    >
      {disabled ? <RotateCcw className="h-3 w-3" /> : <PauseCircle className="h-3 w-3" />}
    </button>
  );
}

function PausedBadge() {
  return (
    <span
      title="Temporarily disabled - this slot is reopened in outreach until restored"
      className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] text-amber-800 uppercase tracking-[0.08em] dark:bg-amber-950/60 dark:text-amber-200"
    >
      <PauseCircle className="h-2.5 w-2.5" />
      Paused
    </span>
  );
}

function SlotTableRow({
  slot,
  crawl,
  cityId,
  cityCampaignId,
  staff,
  zebra,
  layout,
  onDelete,
}: {
  slot: SlotRow;
  crawl: CrawlCard;
  cityId: string;
  cityCampaignId: string;
  staff: Array<{ id: string; displayName: string }>;
  zebra: boolean;
  layout: "table" | "card";
  /** Remove this slot entirely (extra middles / alt-finals only). */
  onDelete: () => void;
}) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tone = zebra ? "bg-zinc-50/60 dark:bg-zinc-900/30" : "bg-white dark:bg-zinc-900/10";

  function assignVenue(v: { id: string; name: string }) {
    setError(null);
    const fd = new FormData();
    fd.set("eventId", crawl.eventId);
    fd.set("role", slot.role);
    fd.set("slotPosition", String(slot.slotPosition));
    fd.set("venueId", v.id);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      // try/catch hardening — if assignSlotVenue throws (raw-SQL error,
      // auth race), the rejection would otherwise propagate out of the
      // transition and crash the React tree with the "Application
      // error" overlay. Surface it inline instead.
      try {
        const result = await assignSlotVenue(null, fd);
        if (!result.ok && result.error) {
          setError(result.error);
        }
      } catch (err) {
        console.error("[crawl-slot] assignSlotVenue failed", err);
        setError("Couldn't assign venue — try again.");
      }
    });
  }

  // Demote = remove from this slot. Three destinations:
  //   "warm"   — just clear; cold_outreach row (if any) is untouched
  //   "cold"   — restore as cold_outreach_entries with status="interested"
  //   "delete" — remove venue_event row only, no queue changes
  const [demoteOpen, setDemoteOpen] = useState(false);
  const toast = useToast();

  function demote(destination: "warm" | "cold" | "delete") {
    if (!slot.venueEventId) return;
    setDemoteOpen(false);
    // Capture before the closure so the post-render slot update
    // doesn't trip undefined.
    const veId = slot.venueEventId;
    const venueId = slot.venueId;
    const venueName = slot.venueName ?? "venue";
    const role = slot.role;
    const slotPosition = slot.slotPosition;
    const eventId = crawl.eventId;
    startTx(async () => {
      try {
        const res = await demoteVenueFromCrawl({
          venueEventId: veId,
          cityCampaignId,
          destination,
        });
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error || "Couldn't remove from crawl.",
            code: (res as { code?: string }).code,
            tag: "crawl.demote",
          });
          return;
        }
        const msg =
          destination === "delete"
            ? `${venueName} removed from crawl.`
            : destination === "cold"
              ? `${venueName} sent back to cold queue.`
              : `${venueName} demoted to warm leads.`;
        // Undo restores the venue to its original slot via the same
        // assignSlotVenue path the operator uses to fill slots
        // manually. Works for all three destinations — the
        // assignSlotVenue call re-creates the venue_event row;
        // any cold_outreach_entries side-effects from the
        // destination="cold" branch (insert/onConflictDoUpdate)
        // stay put, which is the right behavior: the operator
        // restoring the slot doesn't want their cold queue churn
        // also rolled back.
        toast.show({
          kind: "success",
          message: msg,
          undo:
            venueId && role && slotPosition !== null
              ? async () => {
                  const fd = new FormData();
                  fd.set("eventId", eventId);
                  fd.set("role", role);
                  fd.set("slotPosition", String(slotPosition));
                  fd.set("venueId", venueId);
                  fd.set("cityCampaignId", cityCampaignId);
                  const r = await assignSlotVenue(null, fd);
                  if (!r.ok) throw new Error(r.error ?? "Restore failed.");
                }
              : undefined,
        });
      } catch (err) {
        toast.show({
          kind: "error",
          message: (err as Error)?.message ?? "Couldn't remove from crawl.",
          tag: "crawl.demote",
        });
      }
    });
  }

  function clearVenue() {
    if (!slot.venueEventId) return;
    setDemoteOpen(true);
  }

  const slotLabel =
    slot.role === "middle" || slot.role === "alt_final"
      ? `${ROLE_LABEL[slot.role]} ${slot.slotPosition}`
      : ROLE_LABEL[slot.role];

  // Only operator-added slots can be deleted: alt-finals (any position)
  // and middles beyond the two defaults (position >= 3). Wristband, the
  // two default middles, and the final are fixed parts of every crawl.
  const canDelete = slot.role === "alt_final" || (slot.role === "middle" && slot.slotPosition >= 3);

  function handleDelete() {
    if (
      slot.venueEventId &&
      !confirm(
        `Delete ${slotLabel}${slot.venueName ? ` (${slot.venueName})` : ""}? This removes the slot.`,
      )
    ) {
      return;
    }
    onDelete();
  }

  // ---------------------------------------------------------------
  // Card layout (mobile)
  // ---------------------------------------------------------------
  if (layout === "card") {
    return (
      <article
        className={cn(
          "flex flex-col gap-2.5 px-4 py-3 transition-colors",
          slot.venueEventId == null && "opacity-90",
          pending && "opacity-60",
        )}
      >
        {/* Header: slot chip + reuse chip + status + clear button */}
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
                slotPillTone(slot),
              )}
            >
              {slotLabel}
            </span>
            <ReuseChip reuse={slot.reuse} />
            {slot.temporarilyDisabled && <PausedBadge />}
          </span>
          <div className="flex items-center gap-2">
            <SlotStatusSelect slot={slot} cityCampaignId={cityCampaignId} />
            <DisableToggle slot={slot} cityCampaignId={cityCampaignId} />
            {canDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                aria-label="Delete slot"
                disabled={pending}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ) : (
              slot.venueEventId && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={clearVenue}
                    className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                    aria-label="Demote venue"
                    title="Remove from this slot — choose where it lands"
                    disabled={pending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {demoteOpen && (
                    <DemoteMenu onPick={demote} onClose={() => setDemoteOpen(false)} />
                  )}
                </div>
              )
            )}
          </div>
        </div>

        {/* Venue picker — large, the primary control on this card */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <VenueAutocomplete
              cityId={cityId}
              selectedName={slot.venueName}
              onSelect={assignVenue}
              placeholder={slot.venueEventId ? (slot.venueName ?? "Pick…") : "+ Pick venue"}
            />
          </div>
          {slot.venueId && (
            <Link
              href={`/venues/${slot.venueId}`}
              title="Open venue details"
              aria-label="Open venue details"
              className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {/* Venue metadata — email + capacity, read-only */}
        {slot.venueEventId && (
          <div className="flex items-center gap-4 font-mono text-[10px] text-zinc-500">
            {slot.venueEmail && <span className="truncate">✉ {slot.venueEmail}</span>}
            {slot.venuePhone && <span className="whitespace-nowrap">☎ {slot.venuePhone}</span>}
            {slot.venueCapacity != null && <span>Cap {slot.venueCapacity}</span>}
          </div>
        )}

        {/* Operational fields — inline-editable */}
        {slot.venueEventId && (
          <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 pl-1 text-xs">
            <dt className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Sched by
            </dt>
            <dd>
              <SlotStaffSelect
                slot={slot}
                staff={staff}
                cityCampaignId={cityCampaignId}
                disabled={!slot.venueEventId}
              />
            </dd>

            <dt className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Contact
            </dt>
            <dd>
              <InlineCell
                field="nightOfContactName"
                slot={slot}
                cityCampaignId={cityCampaignId}
                placeholder="—"
                disabled={!slot.venueEventId}
              />
            </dd>

            <dt className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Hours
            </dt>
            <dd>
              <InlineCell
                field="agreedHoursText"
                slot={slot}
                cityCampaignId={cityCampaignId}
                placeholder="e.g. 9-11pm"
                disabled={!slot.venueEventId}
              />
            </dd>

            <dt className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Specials
            </dt>
            <dd>
              <InlineCell
                field="drinkSpecials"
                slot={slot}
                cityCampaignId={cityCampaignId}
                placeholder="—"
                disabled={!slot.venueEventId}
                multiline
              />
            </dd>
          </dl>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-rose-50 px-2 py-1.5 text-rose-700 text-xs dark:bg-rose-950/30 dark:text-rose-300">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em]">Conflict</span>
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-mono text-[10px] uppercase tracking-[0.1em] underline-offset-4 hover:underline"
            >
              dismiss
            </button>
          </div>
        )}
      </article>
    );
  }

  // ---------------------------------------------------------------
  // Table layout (desktop) — original render
  // ---------------------------------------------------------------
  return (
    <>
      <tr
        className={cn(
          tone,
          "border-zinc-200/40 border-b transition-colors duration-150 dark:border-zinc-800/30",
          slot.venueEventId == null && "opacity-90",
          pending && "opacity-60",
        )}
      >
        {/* Slot label color chip + reuse chip */}
        <td className="px-3 py-2 align-middle">
          <span className="inline-flex flex-wrap items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
                slotPillTone(slot),
              )}
            >
              {slotLabel}
            </span>
            <ReuseChip reuse={slot.reuse} />
            {slot.temporarilyDisabled && <PausedBadge />}
          </span>
        </td>

        {/* Venue picker */}
        <td className="px-2 py-2 align-middle">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <VenueAutocomplete
                cityId={cityId}
                selectedName={slot.venueName}
                onSelect={assignVenue}
                placeholder={slot.venueEventId ? (slot.venueName ?? "Pick…") : "+ Pick venue"}
              />
            </div>
            {slot.venueId && (
              <Link
                href={`/venues/${slot.venueId}`}
                title="Open venue details"
                aria-label="Open venue details"
                className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </td>

        {/* Email — read-only, comes from venues table */}
        <td className="px-2 py-2 align-middle">
          <span className="block max-w-[180px] truncate font-mono text-[11px] text-zinc-500">
            {slot.venueEmail ?? "—"}
          </span>
        </td>

        {/* Phone — read-only from venues */}
        <td className="px-2 py-2 align-middle">
          <span className="block whitespace-nowrap font-mono text-[11px] text-zinc-500">
            {slot.venuePhone ?? "—"}
          </span>
        </td>

        {/* Scheduled by */}
        <td className="px-2 py-2 align-middle">
          <SlotStaffSelect
            slot={slot}
            staff={staff}
            cityCampaignId={cityCampaignId}
            disabled={!slot.venueEventId}
          />
        </td>

        {/* Bar contact */}
        <td className="px-2 py-2 align-middle">
          <InlineCell
            field="nightOfContactName"
            slot={slot}
            cityCampaignId={cityCampaignId}
            placeholder="—"
            disabled={!slot.venueEventId}
          />
        </td>

        {/* Hours */}
        <td className="px-2 py-2 align-middle">
          <InlineCell
            field="agreedHoursText"
            slot={slot}
            cityCampaignId={cityCampaignId}
            placeholder="e.g. 9-11pm"
            disabled={!slot.venueEventId}
          />
        </td>

        {/* Capacity — read-only from venues */}
        <td className="px-2 py-2 text-right align-middle">
          <span className="font-mono text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
            {slot.venueCapacity ?? "—"}
          </span>
        </td>

        {/* Drink specials */}
        <td className="px-2 py-2 align-middle">
          <InlineCell
            field="drinkSpecials"
            slot={slot}
            cityCampaignId={cityCampaignId}
            placeholder="—"
            disabled={!slot.venueEventId}
            multiline
          />
        </td>

        {/* Status */}
        <td className="px-2 py-2 align-middle">
          <SlotStatusSelect slot={slot} cityCampaignId={cityCampaignId} />
        </td>

        {/* Clear / delete */}
        <td className="px-1 py-2 align-middle">
          <DisableToggle slot={slot} cityCampaignId={cityCampaignId} />
          {canDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
              aria-label="Delete slot"
              disabled={pending}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : (
            slot.venueEventId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={clearVenue}
                  className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                  aria-label="Demote venue"
                  title="Remove from this slot — choose where it lands"
                  disabled={pending}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                {demoteOpen && <DemoteMenu onPick={demote} onClose={() => setDemoteOpen(false)} />}
              </div>
            )
          )}
        </td>
      </tr>
      {error && (
        <tr className="animate-[fade-in_180ms_ease-out] border-zinc-200/40 border-b bg-rose-50/60 dark:border-zinc-800/30 dark:bg-rose-950/30">
          <td colSpan={11} className="px-3 py-2">
            <div className="flex items-start gap-2 text-rose-700 text-xs dark:text-rose-300">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em]">Conflict</span>
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="font-mono text-[10px] uppercase tracking-[0.1em] underline-offset-4 hover:underline"
              >
                dismiss
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Smart-format shorthand crawl hours into the canonical
 * "H:MMPM-H:MMAM" form used by the map pages + Eventbrite description.
 *
 * Rules (from operator spec):
 *   - Start time is always PM — evening crawls start 9-11pm, and the
 *     earliest day crawl starts 1pm, so a leading 1 or 2 is still PM.
 *   - The end rolls into AM once it reaches 12 (midnight) or wraps past
 *     the start hour (e.g. 10-1 → 1AM, 10-2 → 2AM).
 *   - "9-10" → "9:00PM-10:00PM", "10-12" → "10:00PM-12:00AM",
 *     "1-3" (day) → "1:00PM-3:00PM".
 *
 * Anything already containing am/pm, or not a simple "H[:MM]-H[:MM]"
 * range, is returned untouched so deliberately-typed values are never
 * mangled.
 */
function parseTimeRange(input: string): string {
  const raw = input.trim();
  if (!raw || /[ap]\.?m/i.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return raw;
  const sh = Number(m[1]);
  const eh = Number(m[3]);
  if (sh < 1 || sh > 12 || eh < 1 || eh > 12) return raw;
  const sm = m[2] ?? "00";
  const em = m[4] ?? "00";
  // Start is always PM. End is AM at/after midnight: exactly 12, or a
  // smaller hour than the start (it wrapped past midnight).
  const endMer = eh === 12 || eh < sh ? "AM" : "PM";
  return `${sh}:${sm}PM-${eh}:${em}${endMer}`;
}

function InlineCell({
  field,
  slot,
  cityCampaignId,
  placeholder,
  disabled,
  multiline,
}: {
  field: "agreedHoursText" | "drinkSpecials" | "nightOfContactName";
  slot: SlotRow;
  cityCampaignId: string;
  placeholder: string;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const initial = String(slot[field] ?? "");
  const [committed, setCommitted] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [pending, startTx] = useTransition();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCommitted(initial);
    setDraft(initial);
  }, [initial]);

  function commit() {
    if (!slot.venueEventId) return;
    // Auto-format shorthand hours (e.g. "9-10" → "9:00PM-10:00PM"). Other
    // fields pass through unchanged.
    const normalized = field === "agreedHoursText" ? parseTimeRange(draft) : draft;
    if (normalized !== draft) setDraft(normalized);
    if (normalized === committed) return;
    const fd = new FormData();
    fd.set("venueEventId", slot.venueEventId);
    fd.set("field", field);
    fd.set("value", normalized);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await updateSlotField(null, fd);
      if (result.ok) {
        setCommitted(normalized);
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  }

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Enter / Alt+Enter insert line breaks (drink specials are
            // often multi-line); commit happens on blur. Esc reverts.
            if (e.key === "Escape") {
              setDraft(committed);
              e.currentTarget.blur();
            }
          }}
          disabled={disabled || pending}
          placeholder={disabled ? "—" : placeholder}
          rows={Math.min(8, Math.max(1, draft.split("\n").length))}
          className={cn(
            "block w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 pr-5 text-xs leading-snug transition-colors",
            "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white focus:outline-none",
            "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
            "placeholder:text-zinc-400/60",
            disabled && "cursor-not-allowed opacity-60 hover:border-transparent",
          )}
        />
      ) : (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(committed);
              e.currentTarget.blur();
            }
          }}
          disabled={disabled || pending}
          placeholder={disabled ? "—" : placeholder}
          className={cn(
            "h-7 border-transparent bg-transparent pr-5 text-xs transition-colors",
            "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white",
            "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
            "placeholder:text-zinc-400/60",
            disabled && "cursor-not-allowed opacity-60 hover:border-transparent",
          )}
        />
      )}
      {(pending || saved) && (
        <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5">
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
          ) : (
            <Check className="h-3 w-3 text-emerald-500" />
          )}
        </div>
      )}
    </div>
  );
}

function SlotStaffSelect({
  slot,
  staff,
  cityCampaignId,
  disabled,
}: {
  slot: SlotRow;
  staff: Array<{ id: string; displayName: string }>;
  cityCampaignId: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(slot.scheduledByStaffId ?? "");
  const [pending, startTx] = useTransition();

  function handleChange(v: string) {
    setValue(v);
    if (!slot.venueEventId) return;
    const fd = new FormData();
    fd.set("venueEventId", slot.venueEventId);
    fd.set("field", "ourContactStaffId");
    fd.set("value", v);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      await updateSlotField(null, fd);
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled || pending}
      // Explicit text colour so the trigger label is readable on the white
      // cell; explicit bg+text on the options so the open dropdown isn't
      // white-on-white (the native popup inherits white text otherwise).
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-zinc-900 transition-colors dark:text-zinc-100",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
        "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
        —
      </option>
      {staff.map((s) => (
        <option
          key={s.id}
          value={s.id}
          className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {s.displayName.split(" ")[0]}
        </option>
      ))}
    </select>
  );
}

const STATUS_OPTIONS = [
  { value: "lead", label: "Lead", tone: "text-zinc-500" },
  { value: "contacted", label: "Contacted", tone: "text-blue-600 dark:text-blue-400" },
  { value: "interested", label: "Interested", tone: "text-amber-600 dark:text-amber-400" },
  { value: "negotiating", label: "Negotiating", tone: "text-orange-600 dark:text-orange-400" },
  { value: "confirmed", label: "Confirmed", tone: "text-emerald-600 dark:text-emerald-400" },
  { value: "scheduled", label: "Scheduled", tone: "text-sky-600 dark:text-sky-400" },
  { value: "declined", label: "Declined", tone: "text-rose-600 dark:text-rose-400" },
  { value: "cancelled", label: "Cancelled", tone: "text-zinc-500 line-through" },
];

function SlotStatusSelect({
  slot,
  cityCampaignId,
}: {
  slot: SlotRow;
  cityCampaignId: string;
}) {
  const [value, setValue] = useState(slot.status ?? "lead");
  const [pending, startTx] = useTransition();
  const opt = STATUS_OPTIONS.find((o) => o.value === value);

  function handleChange(v: string) {
    setValue(v);
    if (!slot.venueEventId) return;
    const fd = new FormData();
    fd.set("venueEventId", slot.venueEventId);
    fd.set("field", "status");
    fd.set("value", v);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      await updateSlotField(null, fd);
    });
  }

  if (!slot.venueEventId) {
    return <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">—</span>;
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      disabled={pending}
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 font-medium font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
        "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
        opt?.tone,
      )}
    >
      {STATUS_OPTIONS.map((o) => (
        // The colored tone stays on the closed <select> only. Native option
        // popups render on an OS-controlled (usually light) surface, so the
        // dark-mode tones (e.g. text-emerald-400) were unreadable when open.
        // Force explicit dark-on-white per option so the list is always legible.
        <option
          key={o.value}
          value={o.value}
          style={{ color: "#18181b", backgroundColor: "#ffffff" }}
        >
          {o.label}
        </option>
      ))}
    </select>
  );
}

function emptySlot(role: "middle" | "alt_final", slotPosition: number): SlotRow {
  return {
    venueEventId: null,
    role,
    slotPosition,
    status: null,
    temporarilyDisabled: false,
    venueId: null,
    venueName: null,
    venueEmail: null,
    venuePhone: null,
    venueCapacity: null,
    agreedHoursText: null,
    drinkSpecials: null,
    nightOfContactName: null,
    scheduledByStaffId: null,
    scheduledByStaffName: null,
    reuse: [],
  };
}

/**
 * Small inline popover that pops up when the operator clicks the slot's
 * remove (trash) button. Two destinations: "warm" (just clear; venue stays
 * warm via its outreach history) or "cold" (also re-list as cold outreach
 * with status="interested" so it surfaces for active follow-up again).
 */
function DemoteMenu({
  onPick,
  onClose,
}: {
  onPick: (destination: "warm" | "cold" | "delete") => void;
  onClose: () => void;
}) {
  // Click-outside to dismiss without selecting.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    // Defer to the next tick so the click that opened us doesn't immediately close us.
    const id = window.setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handle);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
    >
      <p className="border-zinc-200/60 border-b px-3 py-1.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.14em] dark:border-zinc-800/60">
        Remove venue from this slot
      </p>
      <button
        type="button"
        onClick={() => onPick("warm")}
        className="block w-full px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
        title="Just clear this slot. The venue's prior cold_outreach_entries row (if any) keeps its status — if it was already warm, it still appears in warm leads."
      >
        <span className="font-medium">Demote to warm leads</span>
        <span className="block text-[10px] text-zinc-500">Clear slot, keep prior interest</span>
      </button>
      <button
        type="button"
        onClick={() => onPick("cold")}
        className="block w-full border-zinc-200/60 border-t px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-900"
        title="Clear and re-list in cold outreach with status='interested' for active follow-up."
      >
        <span className="font-medium">Re-add to cold queue</span>
        <span className="block text-[10px] text-zinc-500">Re-list for follow-up</span>
      </button>
      <button
        type="button"
        onClick={() => onPick("delete")}
        className="block w-full border-zinc-200/60 border-t px-3 py-2 text-left text-rose-700 text-xs hover:bg-rose-50 dark:border-zinc-800/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
        title="Delete this venue_event row entirely. No queue changes. Use when the venue declined this specific crawl but you don't want to re-route it anywhere (e.g. it's still on another day's crawl)."
      >
        <span className="font-medium">Delete from this crawl only</span>
        <span className="block text-[10px] text-rose-600/80 dark:text-rose-400/80">
          Remove row. No queue changes.
        </span>
      </button>
    </div>
  );
}

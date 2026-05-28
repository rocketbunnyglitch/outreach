"use client";

import { Input } from "@/components/ui/input";
import {
  type CrawlCard,
  type CrawlHostRef,
  SLOT_ROLE_ORDER,
  type SlotRole,
  type SlotRow,
} from "@/lib/city-sheet-shared";
import { cn } from "@/lib/cn";
import type { NoteRow } from "@/lib/notes";
import { Check, ExternalLink, Loader2, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { notifyDataChanged } from "../../_components/live-refresh";
import {
  type HostOption,
  assignCrawlHost,
  loadHostOptions,
  removeCrawlHost,
} from "../_host-actions";
import { addCrawlNote, deleteCrawlNote, loadCrawlNotes } from "../_note-actions";
import {
  assignSlotVenue,
  clearSlot,
  deleteCrawl,
  updateCrawl,
  updateSlotField,
} from "../_slot-actions";
import { MiddleGroupPicker } from "./middle-group-picker";
import { VenueAutocomplete } from "./venue-autocomplete";

interface Props {
  crawl: CrawlCard;
  cityId: string;
  cityCampaignId: string;
  staff: Array<{ id: string; displayName: string }>;
}

const DAY_LABEL: Record<CrawlCard["dayPart"], string> = {
  thursday_night: "Thursday",
  friday_night: "Friday",
  saturday_night: "Saturday",
};

/**
 * Editable crawl header — shows "Friday crawl 2 · Downtown loop" with
 * an inline editor (pencil) to rename / renumber, and a delete button.
 * Operators flagged (session 12) they want to manage crawls directly
 * from the city sheet rather than a separate setup screen.
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
        notifyDataChanged();
      } catch (err) {
        console.error("[crawl-header] updateCrawl failed", err);
        setError("Couldn't save — try again.");
      }
    });
  }

  function remove() {
    const name = `${DAY_LABEL[crawl.dayPart]} crawl ${crawl.crawlNumber}`;
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
        notifyDataChanged();
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
            {DAY_LABEL[crawl.dayPart]} crawl
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
          {DAY_LABEL[crawl.dayPart]} crawl {crawl.crawlNumber}
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
      <CrawlHostsControl
        eventId={crawl.eventId}
        cityCampaignId={cityCampaignId}
        hosts={crawl.hosts}
      />
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
 * Host chips + assignment picker for a crawl. Up to 2 hosts, each
 * internal or external. Loads the host roster lazily on first open.
 */
function CrawlHostsControl({
  eventId,
  cityCampaignId,
  hosts,
}: {
  eventId: string;
  cityCampaignId: string;
  hosts: CrawlHostRef[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<HostOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const atCap = hosts.length >= 2;

  function openPicker() {
    setError(null);
    setOpen(true);
    if (options === null) {
      startTx(async () => {
        try {
          setOptions(await loadHostOptions());
        } catch (err) {
          console.error("[crawl-hosts] loadHostOptions failed", err);
          setError("Couldn't load hosts.");
        }
      });
    }
  }

  function assign(opt: HostOption) {
    startTx(async () => {
      try {
        const result = await assignCrawlHost({
          eventId,
          cityCampaignId,
          hostType: opt.type,
          hostId: opt.id,
        });
        if (!result.ok) {
          setError(result.error ?? "Couldn't assign.");
          return;
        }
        setOpen(false);
        router.refresh();
        notifyDataChanged();
      } catch (err) {
        console.error("[crawl-hosts] assign failed", err);
        setError("Couldn't assign — try again.");
      }
    });
  }

  function unassign(h: CrawlHostRef) {
    startTx(async () => {
      try {
        const result = await removeCrawlHost({ crawlHostId: h.id, cityCampaignId });
        if (!result.ok) {
          setError(result.error ?? "Couldn't remove.");
          return;
        }
        router.refresh();
        notifyDataChanged();
      } catch (err) {
        console.error("[crawl-hosts] remove failed", err);
        setError("Couldn't remove — try again.");
      }
    });
  }

  const assignedHostIds = new Set(hosts.map((h) => h.hostId));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.14em]">Hosts</span>
      {hosts.length === 0 && (
        <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">none</span>
      )}
      {hosts.map((h) => (
        <span
          key={h.id}
          className={cn(
            "group/hostchip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset",
            h.type === "internal"
              ? "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300"
              : "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
          )}
        >
          <span className="font-mono text-[8px] uppercase tracking-widest opacity-70">
            {h.type === "internal" ? "INT" : "EXT"}
          </span>
          {h.name}
          <button
            type="button"
            onClick={() => unassign(h)}
            disabled={pending}
            className="opacity-0 transition-opacity hover:text-rose-600 group-hover/hostchip:opacity-100"
            aria-label={`Remove ${h.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {!atCap && (
        <div className="relative">
          <button
            type="button"
            onClick={open ? () => setOpen(false) : openPicker}
            disabled={pending}
            className="inline-flex items-center gap-0.5 rounded-full border border-zinc-300 border-dashed px-2 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:hover:text-zinc-300"
          >
            {pending && options === null ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            host
          </button>
          {open && options !== null && (
            <div className="absolute top-full left-0 z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {options.filter((o) => !assignedHostIds.has(o.id)).length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-zinc-500">
                  No more hosts. Add them under Settings → Internal / External Hosts.
                </p>
              ) : (
                options
                  .filter((o) => !assignedHostIds.has(o.id))
                  .map((o) => (
                    <button
                      key={`${o.type}-${o.id}`}
                      type="button"
                      onClick={() => assign(o)}
                      disabled={pending}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span
                        className={cn(
                          "font-mono text-[8px] uppercase tracking-widest",
                          o.type === "internal" ? "text-blue-500" : "text-violet-500",
                        )}
                      >
                        {o.type === "internal" ? "INT" : "EXT"}
                      </span>
                      {o.name}
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
      )}
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
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
        notifyDataChanged();
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
        notifyDataChanged();
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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <CrawlHeader crawl={crawl} cityCampaignId={cityCampaignId} />
        <div className="flex items-center gap-3">
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

      {/* Shared middle group section — read-only summary of group members */}
      {crawl.middleVenueGroupId && (
        <div className="border-zinc-200/60 border-b bg-orange-500/[0.04] px-5 py-4 dark:border-zinc-800/40 dark:bg-orange-500/[0.06]">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="font-mono text-[10px] text-orange-700 uppercase tracking-[0.12em] dark:text-orange-300">
              Middle venues · {crawl.middleVenueGroupName}
            </p>
            <Link
              href={`/middle-groups/${crawl.middleVenueGroupId}`}
              className="font-mono text-[10px] text-orange-700 uppercase tracking-[0.1em] underline-offset-4 hover:underline dark:text-orange-300"
            >
              manage group →
            </Link>
          </div>
          {crawl.middleGroupMembers.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">
              Group has no venues yet. Add some via{" "}
              <Link
                href={`/middle-groups/${crawl.middleVenueGroupId}`}
                className="underline-offset-2 hover:underline"
              >
                manage group
              </Link>
              .
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {crawl.middleGroupMembers.map((m) => (
                <li
                  key={m.memberId}
                  className="flex items-center gap-2 rounded-md bg-white/60 px-2.5 py-1.5 text-xs dark:bg-zinc-900/40"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                  <span className="flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {m.venueName}
                  </span>
                  {m.venueCapacity != null && (
                    <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                      {m.venueCapacity}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                    {m.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
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

  function clearVenue() {
    if (!slot.venueEventId) return;
    if (!confirm(`Clear ${slot.venueName ?? "this venue"} from this slot?`)) return;
    const fd = new FormData();
    fd.set("venueEventId", slot.venueEventId);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      await clearSlot(null, fd);
    });
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
        {/* Header: slot chip + status + clear button */}
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
              ROLE_TONE[slot.role],
            )}
          >
            {slotLabel}
          </span>
          <div className="flex items-center gap-2">
            <SlotStatusSelect slot={slot} cityCampaignId={cityCampaignId} />
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
                <button
                  type="button"
                  onClick={clearVenue}
                  className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                  aria-label="Clear slot"
                  disabled={pending}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
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
        {/* Slot label — color chip */}
        <td className="px-3 py-2 align-middle">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
              ROLE_TONE[slot.role],
            )}
          >
            {slotLabel}
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
              <button
                type="button"
                onClick={clearVenue}
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                aria-label="Clear slot"
                disabled={pending}
              >
                <Trash2 className="h-3 w-3" />
              </button>
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
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xs transition-colors",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
        "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <option value="">—</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
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
  };
}

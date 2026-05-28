"use client";

import { Input } from "@/components/ui/input";
import {
  type CrawlCard,
  SLOT_ROLE_ORDER,
  type SlotRole,
  type SlotRow,
} from "@/lib/city-sheet-shared";
import { cn } from "@/lib/cn";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  addExtraSlot,
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
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </span>
    </div>
  );
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
  const [adding, startAdd] = useTransition();

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
    const fd = new FormData();
    fd.set("eventId", crawl.eventId);
    fd.set("role", role);
    fd.set("cityCampaignId", cityCampaignId);
    startAdd(async () => {
      const result = await addExtraSlot(null, fd);
      if (result.ok && result.data) {
        setExtraSlots((s) => [...s, { role, slotPosition: result.data.slotPosition }]);
      }
    });
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
            />
          </li>
        ))}
      </ul>

      {/* Add-slot affordances */}
      <footer className="flex items-center gap-3 border-zinc-200/60 border-t px-5 py-2.5 dark:border-zinc-800/40">
        <button
          type="button"
          onClick={() => handleAddSlot("middle")}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-orange-500/[0.08] hover:text-orange-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-orange-300"
        >
          <Plus className="h-3 w-3" />
          Middle slot
        </button>
        <button
          type="button"
          onClick={() => handleAddSlot("alt_final")}
          disabled={adding}
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
}: {
  slot: SlotRow;
  crawl: CrawlCard;
  cityId: string;
  cityCampaignId: string;
  staff: Array<{ id: string; displayName: string }>;
  zebra: boolean;
  layout: "table" | "card";
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
            {slot.venueEventId && (
              <button
                type="button"
                onClick={clearVenue}
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                aria-label="Clear slot"
                disabled={pending}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Venue picker — large, the primary control on this card */}
        <div>
          <VenueAutocomplete
            cityId={cityId}
            selectedName={slot.venueName}
            onSelect={assignVenue}
            placeholder={slot.venueEventId ? (slot.venueName ?? "Pick…") : "+ Pick venue"}
          />
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
          <VenueAutocomplete
            cityId={cityId}
            selectedName={slot.venueName}
            onSelect={assignVenue}
            placeholder={slot.venueEventId ? (slot.venueName ?? "Pick…") : "+ Pick venue"}
          />
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
          />
        </td>

        {/* Status */}
        <td className="px-2 py-2 align-middle">
          <SlotStatusSelect slot={slot} cityCampaignId={cityCampaignId} />
        </td>

        {/* Clear */}
        <td className="px-1 py-2 align-middle">
          {slot.venueEventId && (
            <button
              type="button"
              onClick={clearVenue}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
              aria-label="Clear slot"
              disabled={pending}
            >
              <Trash2 className="h-3 w-3" />
            </button>
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

function InlineCell({
  field,
  slot,
  cityCampaignId,
  placeholder,
  disabled,
}: {
  field: "agreedHoursText" | "drinkSpecials" | "nightOfContactName";
  slot: SlotRow;
  cityCampaignId: string;
  placeholder: string;
  disabled?: boolean;
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
    if (draft === committed || !slot.venueEventId) return;
    const fd = new FormData();
    fd.set("venueEventId", slot.venueEventId);
    fd.set("field", field);
    fd.set("value", draft);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await updateSlotField(null, fd);
      if (result.ok) {
        setCommitted(draft);
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }
    });
  }

  return (
    <div className="relative">
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
        <option key={o.value} value={o.value}>
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

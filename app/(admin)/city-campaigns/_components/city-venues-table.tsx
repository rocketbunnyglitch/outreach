"use client";

/**
 * CityVenuesTable — every venue in the city DB with previously-used
 * venues pinned to the top. Mounts under the cold-outreach worksheet
 * on the city-campaign page.
 *
 * Per row:
 *   - Venue name + (city) on a quiet second line
 *   - Slot-history chips: "Halloween 2025 · Wristband", etc.
 *     Color reservation: emerald for confirmed roles, amber for
 *     non-confirmed-but-tracked.
 *   - Quick contact icons: email / phone / website when present
 *   - "Add to cold outreach" button when not already added
 *     (hidden + replaced with a quiet "Added" badge when already
 *     in the cold worksheet for this campaign)
 *   - Greyed out when do_not_contact is set
 *
 * Filters:
 *   - Free-text search (debounced 150ms) over venue name
 *   - Toggle: "Show only previously used"
 *   - Toggle: "Hide DNC"
 *
 * Server data is preloaded and never re-fetched by the client. The
 * "Add" button triggers a router.refresh() so the parent's
 * cold-outreach table picks up the new row + this table flips
 * the "Added" badge.
 *
 * Sorting on the server: previously-used venues with most-recent
 * event first, then alphabetical. The client doesn't re-sort —
 * it just filters.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { CityVenueRow, SlotHistoryEntry } from "@/lib/city-venues-data";
import { captureClientError } from "@/lib/client-error";
import { cn } from "@/lib/cn";
import {
  Archive,
  Check,
  Globe,
  History,
  Mail,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { archiveVenueNoRedirect, hardDeleteVenue, unarchiveVenue } from "../../venues/_actions";
import { upsertColdOutreachEntry } from "../_cold-outreach-actions";

interface Props {
  cityCampaignId: string;
  cityId: string;
  cityName: string;
  rows: CityVenueRow[];
  totalInCity: number;
  capped: boolean;
  /**
   * Whether the viewer is an admin. Admins get a "Delete
   * permanently" action; non-admins get "Archive" (soft-delete).
   * Per operator: "an admin not just archive" + "Archived Venue
   * tab should be in Admin and allow me to restore if needed".
   */
  currentStaffIsAdmin: boolean;
}

export function CityVenuesTable({
  cityCampaignId,
  cityName,
  rows,
  totalInCity,
  capped,
  currentStaffIsAdmin,
}: Props) {
  const [query, setQuery] = useState("");
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [hideDnc, setHideDnc] = useState(true);
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const [adding, setAdding] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideDnc && r.doNotContact) return false;
      if (onlyUsed && r.slotHistory.length === 0) return false;
      if (!q) return true;
      return r.venueName.toLowerCase().includes(q) || r.address?.toLowerCase().includes(q) || false;
    });
  }, [rows, query, onlyUsed, hideDnc]);

  const usedCount = useMemo(() => rows.filter((r) => r.slotHistory.length > 0).length, [rows]);

  function addToCampaign(venueId: string, venueName: string) {
    setAdding((s) => new Set(s).add(venueId));
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("venueId", venueId);
    startTx(async () => {
      try {
        const res = await upsertColdOutreachEntry(null, fd);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error || "Couldn't add to cold outreach.",
            code: (res as { code?: string }).code,
            tag: "city_venues.add",
          });
          setAdding((s) => {
            const n = new Set(s);
            n.delete(venueId);
            return n;
          });
          return;
        }
        toast.show({ kind: "success", message: `Added ${venueName} to cold outreach.` });
        router.refresh();
      } catch (err) {
        // Client-side capture for ANY thrown error (Next.js
        // "unexpected response", network failure, etc). The
        // server-side op-error system only catches errors inside
        // the action's try/catch — Next.js render-streaming
        // failures or serialization errors bypass that and end
        // up here. captureClientError generates a C-XXXX-YYYY
        // code + logs the underlying error to the browser
        // console so the operator can search there + paste the
        // code into Claude.
        const captured = captureClientError(err, {
          tag: "city_venues.add",
          fallback: "Couldn't add to cold outreach.",
        });
        toast.show({
          kind: "error",
          message: captured.message,
          code: captured.code,
          tag: "city_venues.add",
        });
        setAdding((s) => {
          const n = new Set(s);
          n.delete(venueId);
          return n;
        });
      }
    });
  }

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm tracking-tight">Venues in {cityName}</h3>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] tabular-nums">
            {totalInCity} {totalInCity === 1 ? "venue" : "venues"}
            {usedCount > 0 && ` · ${usedCount} previously used`}
          </span>
        </div>
        <span className="hidden font-mono text-[10px] text-zinc-400 uppercase tracking-[0.1em] md:inline-flex">
          previously-used venues at top
        </span>
      </header>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-2 border-zinc-200/40 border-b bg-zinc-50/30 px-5 py-2 dark:border-zinc-800/30 dark:bg-zinc-950/30">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute top-1.5 left-2 h-3 w-3 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search venue or address…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1 pr-2 pl-7 text-xs outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-300/30 dark:border-zinc-800 dark:bg-zinc-900"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1 right-1 rounded p-0.5 text-zinc-400 hover:text-zinc-700"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <ToggleChip
          active={onlyUsed}
          onClick={() => setOnlyUsed((v) => !v)}
          label={`Only previously used${usedCount > 0 ? ` (${usedCount})` : ""}`}
        />
        <ToggleChip
          active={hideDnc}
          onClick={() => setHideDnc((v) => !v)}
          label="Hide do-not-contact"
        />

        <span className="ml-auto font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] tabular-nums">
          Showing {filtered.length} of {rows.length}
          {capped && " · capped at 500"}
        </span>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-zinc-500">
          {rows.length === 0 ? (
            <>No venues in {cityName} yet. Add one from the cold-outreach panel above.</>
          ) : (
            <>No matches. Try clearing filters.</>
          )}
        </div>
      )}

      {/* Rows */}
      {filtered.length > 0 && (
        <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
          {filtered.map((row) => (
            <CityVenueRowItem
              key={row.venueId}
              row={row}
              isAdding={adding.has(row.venueId)}
              addPending={pending}
              onAdd={() => addToCampaign(row.venueId, row.venueName)}
              currentStaffIsAdmin={currentStaffIsAdmin}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ToggleChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800",
      )}
    >
      {active && <Check className="h-2.5 w-2.5" />}
      {label}
    </button>
  );
}

function CityVenueRowItem({
  row,
  isAdding,
  addPending,
  onAdd,
  currentStaffIsAdmin,
}: {
  row: CityVenueRow;
  isAdding: boolean;
  addPending: boolean;
  onAdd: () => void;
  currentStaffIsAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();

  function handleArchive() {
    // No confirm dialog — operator gets a 6-second undo window
    // via the toast instead. Per "best in class" UX rule: undo
    // beats confirm. Confirm interrupts every action; undo only
    // interrupts when the operator actually made a mistake.
    startTx(async () => {
      try {
        const res = await archiveVenueNoRedirect(row.venueId);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't archive venue.",
            tag: "city_venues.archive",
          });
          return;
        }
        toast.show({
          kind: "success",
          message: `${row.venueName} archived.`,
          undo: async () => {
            const r = await unarchiveVenue(row.venueId);
            if (!r.ok) throw new Error(r.error ?? "Restore failed.");
            router.refresh();
          },
        });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "city_venues.archive",
          fallback: "Couldn't archive venue.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Permanently DELETE ${row.venueName}? This removes the venue + every related record (cold outreach, venue events, history, etc). Cannot be undone.`,
      )
    ) {
      return;
    }
    if (
      !confirm(
        "Are you absolutely sure? Type the venue name to confirm? (You can also just hit OK.)",
      )
    ) {
      return;
    }
    startTx(async () => {
      try {
        const res = await hardDeleteVenue(row.venueId);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't permanently delete venue.",
            tag: "city_venues.hard_delete",
          });
          return;
        }
        toast.show({ kind: "success", message: `${row.venueName} deleted permanently.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "city_venues.hard_delete",
          fallback: "Couldn't permanently delete venue.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <li
      className={cn(
        "group/cvrow flex flex-wrap items-start gap-3 px-5 py-2.5",
        row.doNotContact && "opacity-50",
        pending && "opacity-50",
      )}
    >
      {/* Name + address column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/venues/${row.venueId}`}
            className="truncate font-medium text-sm hover:underline"
          >
            {row.venueName}
          </Link>
          {row.doNotContact && (
            <span className="rounded bg-rose-100 px-1 py-0.5 font-mono text-[9px] text-rose-700 uppercase tracking-[0.1em] dark:bg-rose-950/60 dark:text-rose-200">
              DNC
            </span>
          )}
        </div>
        {row.address && (
          <p className="truncate font-mono text-[10px] text-zinc-500 tracking-tight dark:text-zinc-400">
            {row.address}
          </p>
        )}

        {/* Slot history chips */}
        {row.slotHistory.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <History className="h-2.5 w-2.5 text-zinc-400" />
            {row.slotHistory.slice(0, 3).map((h, i) => (
              <SlotChip key={`${h.campaignSlug}-${h.eventDate}-${i}`} entry={h} />
            ))}
            {row.slotHistory.length > 3 && (
              <span className="font-mono text-[9px] text-zinc-400 tabular-nums">
                +{row.slotHistory.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Contact + meta */}
      <div className="flex shrink-0 items-center gap-2 text-zinc-500">
        {row.email && <Mail className="h-3 w-3" aria-label={`Has email: ${row.email}`} />}
        {row.phoneE164 && <Phone className="h-3 w-3" aria-label={`Has phone: ${row.phoneE164}`} />}
        {row.websiteUrl && (
          <a
            href={row.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={row.websiteUrl}
            className="rounded p-0.5 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <Globe className="h-3 w-3" />
          </a>
        )}
        {row.capacity != null && (
          <span className="font-mono text-[10px] tabular-nums">cap {row.capacity}</span>
        )}
        {row.distanceKm != null && (
          <span className="font-mono text-[10px] tabular-nums" title="Distance from city centre">
            {row.distanceKm}km
          </span>
        )}
      </div>

      {/* Action */}
      <div className="flex shrink-0 items-center gap-2">
        {row.doNotContact ? (
          <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
            blocked
          </span>
        ) : row.inThisCampaign ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50/60 px-2 py-0.5 font-mono text-[10px] text-emerald-800 uppercase tracking-[0.08em] dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Check className="h-2.5 w-2.5" />
            In cold outreach
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAdd}
            disabled={addPending && isAdding}
          >
            {addPending && isAdding ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em]">Adding…</span>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                Add
              </>
            )}
          </Button>
        )}

        {/* Archive / delete actions — appear on hover to keep the
            calm state clean. Admins get a destructive "Permanently
            delete" button in rose; non-admins get just "Archive".
            Per operator: "from the cities tab you should be able
            to permanently delete a city as an admin not just
            archive" (same model for venues per item #9 +
            screenshot text). */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/cvrow:opacity-100">
          <button
            type="button"
            onClick={handleArchive}
            disabled={pending}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label={`Archive ${row.venueName}`}
            title="Archive — hide from list. Restore from Admin → Archived Venues."
          >
            <Archive className="h-3 w-3" />
          </button>
          {currentStaffIsAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="rounded p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600 dark:hover:bg-rose-500/[0.12] dark:hover:text-rose-400"
              aria-label={`Permanently delete ${row.venueName}`}
              title="Permanently DELETE — cascades through outreach/events/history. Cannot be undone."
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function SlotChip({ entry }: { entry: SlotHistoryEntry }) {
  const tone =
    entry.status === "confirmed" || entry.status === "contract_signed"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
      : entry.status === "declined" || entry.status === "cancelled"
        ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 line-through"
        : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200";
  // Compact display: campaign name + role on a single chip
  const campaignShort =
    entry.campaignName.length > 18 ? `${entry.campaignName.slice(0, 16)}…` : entry.campaignName;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em]",
        tone,
      )}
      title={`${entry.campaignName} · ${entry.roleLabel} · ${entry.eventDate} · ${entry.status}`}
    >
      <Sparkles className="h-2 w-2 opacity-50" />
      <span>{campaignShort}</span>
      <span className="opacity-60">·</span>
      <span>{entry.roleLabel}</span>
    </span>
  );
}

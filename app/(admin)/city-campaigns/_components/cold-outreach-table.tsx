"use client";

import { SavedViewsPicker } from "@/app/(admin)/_components/saved-views-picker";
import { ActivityHistoryButton } from "@/components/ui/activity-history-button";
import { Button } from "@/components/ui/button";
import {
  PresenceAvatarStack,
  formatRealtimeAgo,
  usePresenceHeartbeat,
  useRealtimeChannel,
} from "@/components/ui/data-table";
import { InlineCell } from "@/components/ui/inline-cell";
import { Input } from "@/components/ui/input";
import { useShortcut } from "@/components/ui/shortcut-provider";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { parseVenueHours, suggestCallWindow } from "@/lib/parse-venue-hours";
import { useDraft } from "@/lib/use-draft";
import {
  Check,
  ClipboardPaste,
  ExternalLink,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  acceptLeadSuggestions,
  archiveColdOutreachEntry,
  bulkArchiveColdOutreach,
  bulkAssignColdOutreach,
  bulkUnarchiveColdOutreach,
  bulkUpdateColdOutreachStatus,
  commitVenueField,
  generateVenueLeads,
  unarchiveColdOutreachEntry,
  updateColdOutreachField,
  upsertColdOutreachEntry,
} from "../_cold-outreach-actions";
import { AiDraftButton } from "./ai-draft-button";
import { AiSuggestVenuesModal } from "./ai-suggest-venues-modal";
import { BulkAiDraftModal } from "./bulk-ai-draft-modal";
import { BulkPasteModal } from "./bulk-paste-modal";
import { FindEmailButton } from "./find-email-button";
import { QuoDialControls } from "./quo-dial-controls";
import { VenueAutocomplete } from "./venue-autocomplete";

type SortKey = "venue" | "email" | "status" | "assignee" | "zb" | "lastTouch" | "callWindow";

interface ColdEntry {
  entryId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  venuePhone: string | null;
  venueWebsite: string | null;
  venueInstagramHandle: string | null;
  /** Free-text opening hours; drives the "Best call: 2-3 PM" hint. */
  venueHours: string | null;
  /** Tag array (["bar", "club", ...]) — fallback signal for the
   *  call-window heuristic when hours can't be parsed. */
  venueType: string[];
  /**
   * IANA timezone of the venue's city. The call-window suggester
   * uses this to compute "currently open?" against the venue's
   * local time rather than the browser's. cities.timezone is NOT
   * NULL so this is always defined; the data layer defaults to
   * "America/Toronto" if a venue somehow has no city.
   */
  venueTimezone: string;
  cityName: string | null;
  venueUpdatedAt: string;
  zeroBounceStatus: string | null;
  status: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  remarks: string | null;
  lastTouchAt: Date | null;
  /**
   * Unanswered call attempts (60-day window) for this venue. Used to
   * render a "Calls: N/5" badge next to the dial controls so the
   * operator sees how close they are to the auto-cap at 5. Migration
   * 0024 + the cap logic in quo-actions.ts back this.
   */
  callAttempts: number;
}

interface Props {
  cityCampaignId: string;
  cityId: string;
  /** Outreach brand id from the parent campaign — needed for Quo
   * calls + SMS to associate the activity with the right brand line. */
  outreachBrandId: string | null;
  entries: ColdEntry[];
  staff: Array<{ id: string; displayName: string }>;
  /** Current logged-in staff id — used by realtime + presence hooks. */
  currentStaffId: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string; tone: string }> = [
  { value: "not_contacted", label: "Not contacted", tone: "text-zinc-500" },
  { value: "email_sent", label: "Email sent", tone: "text-blue-600 dark:text-blue-400" },
  { value: "follow_up_due", label: "Follow-up due", tone: "text-amber-600 dark:text-amber-400" },
  { value: "called", label: "Called", tone: "text-blue-600 dark:text-blue-400" },
  { value: "voicemail", label: "Voicemail", tone: "text-amber-600 dark:text-amber-400" },
  { value: "no_answer", label: "No answer", tone: "text-amber-600 dark:text-amber-400" },
  { value: "interested", label: "Interested", tone: "text-emerald-600 dark:text-emerald-400" },
  { value: "declined", label: "Declined", tone: "text-rose-600 dark:text-rose-400" },
  { value: "bad_email", label: "Bad email", tone: "text-rose-600 dark:text-rose-400" },
  { value: "wrong_number", label: "Wrong number", tone: "text-rose-600 dark:text-rose-400" },
  { value: "do_not_contact", label: "Do not contact", tone: "text-zinc-500 line-through" },
  // Migration 0024 — auto-set after 5+ unanswered calls in 60 days.
  // Distinct from do_not_contact (operator-set after explicit opt-out).
  { value: "unreachable", label: "Unreachable", tone: "text-zinc-500 italic" },
];

const ZB_TONE: Record<string, string> = {
  valid: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  catch_all: "bg-amber-400/15 text-amber-700 ring-amber-400/25 dark:text-amber-300",
  unknown: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
  invalid: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  spamtrap: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  abuse: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  do_not_mail: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
};

/**
 * Cold outreach table for the city sheet.
 *
 * Each row: Venue · Email · ZeroBounce · Phone · Status · Assigned · Remarks
 *
 * Columns:
 *   • Venue       — name + link to /venues/[id]
 *   • Email       — mono, hover reveals copy/mailto, ZeroBounce pill
 *   • Phone       — mono, hover reveals tel: link
 *   • Status      — inline <select> from spec's status list (color-tinted)
 *   • Assigned    — inline staff <select>
 *   • Remarks     — inline <input>, blur/Enter to commit
 *   • Last touch  — auto-set when any field changes
 *   • Archive     — soft-delete button (row hover reveals)
 *
 * Empty state: prominent "Generate Venue Leads" CTA. When the Google
 * Maps API key isn't configured, the CTA shows a graceful explanation
 * + a "Add venue manually" affordance.
 *
 * Adding a venue: a quiet "+ Add venue" affordance at the table footer
 * triggers the venue autocomplete (re-used from slot picker) → adds an
 * entry with status='not_contacted'.
 */
export function ColdOutreachTable({
  cityCampaignId,
  cityId,
  outreachBrandId,
  entries,
  staff,
  currentStaffId,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteRaw, setPasteRaw] = useState<string>("");
  const router = useRouter();

  // -------------------------------------------------------------
  // Realtime: refresh when teammates edit entries in the same
  // city-campaign. Channel is scoped by cityCampaignId so different
  // campaigns don't fan out to each other.
  // -------------------------------------------------------------
  const realtime = useRealtimeChannel({
    channel: `realtime:cold-outreach-${cityCampaignId}`,
    currentStaffId,
    onEvent: () => router.refresh(),
  });

  // -------------------------------------------------------------
  // Presence: who else is viewing this city sheet?
  // -------------------------------------------------------------
  const presence = usePresenceHeartbeat({
    route: `/city-campaigns/${cityCampaignId}`,
    currentStaffId,
  });

  // -------------------------------------------------------------
  // Global paste handler — intercept document-level paste events
  // when the operator pastes TSV content (≥2 cells per row, ≥2
  // rows). Triggers the bulk paste preview modal. Single-cell or
  // plain-text pastes are left alone so the operator can still
  // paste into individual inputs.
  // -------------------------------------------------------------
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      // Skip if focus is in an input/textarea — those need to receive
      // normal paste behavior
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
      const tabsPerRow = lines.filter((l) => l.includes("\t")).length;
      if (lines.length >= 2 && tabsPerRow >= 1) {
        e.preventDefault();
        setPasteRaw(text);
        setPasteOpen(true);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // -------------------------------------------------------------
  // Sort + filter state. URL-bound so deep-links retain context.
  // -------------------------------------------------------------
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const sortKey = (searchParams.get("sort") ?? "venue") as SortKey;
  const sortDir = (searchParams.get("dir") ?? "asc") as "asc" | "desc";
  const filterStatus = searchParams.get("status") ?? "";
  const filterAssignee = searchParams.get("assignee") ?? "";
  const filterZb = searchParams.get("zb") ?? "";
  /**
   * Hide-unreachable toggle (session 11 follow-up to the 5-attempt
   * cap). DEFAULT ON — operators don't want the call queue cluttered
   * with venues we've already given up on. Stored in the URL as
   * 'showUnreachable=1' so the off-state is the absent param.
   *
   * When status='unreachable' is the explicit filter, this toggle is
   * a no-op (the operator clearly wants to SEE unreachable rows).
   */
  const showUnreachable = searchParams.get("showUnreachable") === "1";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (value === null || value === "") sp.delete(key);
      else sp.set(key, value);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setParam("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      setParam("sort", key);
      setParam("dir", "asc");
    }
  }

  // Compute the displayed entry list: filter → sort
  const displayed = useMemo(() => {
    // Pre-compute call-window suggestion per row when the operator
    // sorts by it. Doing this once per row (rather than inside the
    // comparator, which would parse hours O(n log n) times) keeps the
    // sort cheap on large lists. Map is by entryId so we don't pay
    // the cost when the sort key is something else.
    const now = new Date();
    const callWindowToneByEntry = new Map<string, number>();
    if (sortKey === "callWindow") {
      // Tone → priority. Lower = higher priority (floats to top in asc).
      const tonePriority: Record<string, number> = {
        now: 0,
        ok: 1,
        later: 2,
        unknown: 3,
      };
      for (const e of entries) {
        if (!e.venueHours && (!e.venueType || e.venueType.length === 0)) {
          callWindowToneByEntry.set(e.entryId, 99);
          continue;
        }
        const parsed = parseVenueHours(e.venueHours);
        const suggestion = suggestCallWindow(parsed, now, e.venueType, e.venueTimezone);
        callWindowToneByEntry.set(
          e.entryId,
          suggestion ? (tonePriority[suggestion.tone] ?? 99) : 99,
        );
      }
    }

    const filtered = entries.filter((e) => {
      // Hide-unreachable rule. Skipped when the operator explicitly
      // selected status='unreachable' (they want to see those rows)
      // or when the showUnreachable URL flag is set.
      if (e.status === "unreachable" && !showUnreachable && filterStatus !== "unreachable") {
        return false;
      }
      if (filterStatus && e.status !== filterStatus) return false;
      if (filterAssignee === "__me__") {
        // 'My venues' chip — filtered by client-only since we don't
        // have currentUserId here; staff/{me} chip filter happens
        // elsewhere. Skip the constraint when set to __me__ pending
        // a follow-up to thread session id.
        // For now treat __me__ as 'has assignee'.
        if (!e.assignedStaffId) return false;
      } else if (filterAssignee === "__unassigned__") {
        if (e.assignedStaffId) return false;
      } else if (filterAssignee) {
        if (e.assignedStaffId !== filterAssignee) return false;
      }
      if (filterZb && (e.zeroBounceStatus ?? "") !== filterZb) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      let cmp = 0;
      switch (sortKey) {
        case "venue":
          cmp = a.venueName.localeCompare(b.venueName);
          break;
        case "email":
          cmp = (a.venueEmail ?? "").localeCompare(b.venueEmail ?? "");
          break;
        case "status": {
          // Pipeline-order sort so 'pending' floats to the top in asc
          const order: Record<string, number> = {
            pending: 0,
            attempted: 1,
            email_sent: 2,
            sms_sent: 3,
            interested: 4,
            confirmed: 5,
            declined: 6,
            no_response: 7,
          };
          cmp = (order[a.status] ?? 99) - (order[b.status] ?? 99);
          break;
        }
        case "assignee":
          cmp = (a.assignedStaffName ?? "").localeCompare(b.assignedStaffName ?? "");
          break;
        case "zb":
          cmp = (a.zeroBounceStatus ?? "").localeCompare(b.zeroBounceStatus ?? "");
          break;
        case "lastTouch": {
          const aT = a.lastTouchAt ? new Date(a.lastTouchAt).getTime() : 0;
          const bT = b.lastTouchAt ? new Date(b.lastTouchAt).getTime() : 0;
          cmp = aT - bT;
          break;
        }
        case "callWindow": {
          // 'now' rows first (priority 0), then 'ok' (pre-open),
          // 'later' (closed today), 'unknown', then everything else.
          // Asc puts "call them right now" at the top — the operator's
          // most-actionable rows.
          const aPri = callWindowToneByEntry.get(a.entryId) ?? 99;
          const bPri = callWindowToneByEntry.get(b.entryId) ?? 99;
          cmp = aPri - bPri;
          break;
        }
      }
      // Stable secondary sort by venue name when primary ties
      if (cmp === 0) cmp = a.venueName.localeCompare(b.venueName);
      return cmp * dir;
    });

    return sorted;
  }, [entries, filterStatus, filterAssignee, filterZb, sortKey, sortDir, showUnreachable]);

  // Count of unreachable rows currently hidden by the filter — used to
  // surface a "+ N unreachable" chip operators can click to reveal.
  const hiddenUnreachableCount = useMemo(() => {
    if (showUnreachable || filterStatus === "unreachable") return 0;
    return entries.filter((e) => e.status === "unreachable").length;
  }, [entries, showUnreachable, filterStatus]);

  const hasActiveFilter = !!(filterStatus || filterAssignee || filterZb);

  function clearAllFilters() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("status");
    sp.delete("assignee");
    sp.delete("zb");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Page-scoped keyboard shortcuts. Press '?' to see them all.
  useShortcut({
    keys: "n",
    label: "Add new venue",
    group: "Cold outreach",
    handler: () => setAdding(true),
  });
  useShortcut({
    keys: "v",
    label: "Suggest venues (AI)",
    group: "Cold outreach",
    handler: () => setSuggestOpen(true),
  });
  useShortcut({
    keys: "escape",
    label: hasActiveFilter ? "Clear filters" : "Clear selection",
    group: "Cold outreach",
    handler: () => {
      if (hasActiveFilter) clearAllFilters();
      else setSelected(new Set());
    },
    enabled: selected.size > 0 || hasActiveFilter,
  });

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === displayed.length ? new Set() : new Set(displayed.map((e) => e.entryId)),
    );
  }

  function clearSelection() {
    setSelected(new Set());
  }

  if (entries.length === 0 && !adding) {
    return (
      <EmptyState
        cityCampaignId={cityCampaignId}
        cityId={cityId}
        onManualAdd={() => setAdding(true)}
      />
    );
  }

  const allSelected = selected.size > 0 && selected.size === displayed.length;
  const someSelected = selected.size > 0 && selected.size < displayed.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-4 dark:border-zinc-800/40">
        <div className="flex items-baseline gap-2">
          <Mail className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-lg tracking-tight">
            Cold outreach
            <span className="ml-2 font-mono font-normal text-[11px] text-zinc-500">
              {displayed.length}
              {hasActiveFilter && displayed.length !== entries.length
                ? ` of ${entries.length}`
                : ""}{" "}
              venue{entries.length === 1 ? "" : "s"}
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <PresenceAvatarStack people={presence.others} size={22} />
          {realtime.lastEvent && (
            <span
              className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
              title={`last update from another operator at ${realtime.lastEvent.at}`}
            >
              {realtime.lastEvent.byStaffName ?? "Someone"} edited{" "}
              {formatRealtimeAgo(realtime.lastEvent.at)}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em]",
              realtime.connected
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-400 dark:text-zinc-600",
            )}
            title={
              realtime.connected
                ? "Live — changes from teammates appear automatically"
                : "Realtime disconnected"
            }
          >
            <Wifi className="h-2.5 w-2.5" />
            {realtime.connected ? "live" : "offline"}
          </span>
          <button
            type="button"
            onClick={() => setSuggestOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50/40 px-2.5 py-1 font-mono text-[10px] text-violet-700 uppercase tracking-[0.08em] transition-colors hover:bg-violet-100/60 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50"
            title="Have Claude suggest new venues to add"
          >
            <Sparkles className="h-2.5 w-2.5" />
            Suggest venues
          </button>
          <p className="hidden font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] sm:block">
            status + ZeroBounce auto-tracked
          </p>
        </div>
      </header>

      {selected.size > 0 && (
        <BulkActionBar
          selectedIds={Array.from(selected)}
          selectedEntries={entries.filter((e) => selected.has(e.entryId))}
          cityCampaignId={cityCampaignId}
          staff={staff}
          onComplete={clearSelection}
        />
      )}

      {/* Filter chip strip — visible whenever filters are active OR
          a quick-filter affordance row at the top before any filters
          are applied. Sort + filter state lives in the URL so links
          retain context. */}
      <FilterChipStrip
        entries={entries}
        displayedCount={displayed.length}
        filterStatus={filterStatus}
        filterAssignee={filterAssignee}
        filterZb={filterZb}
        hasActive={hasActiveFilter}
        showUnreachable={showUnreachable}
        hiddenUnreachableCount={hiddenUnreachableCount}
        staff={staff}
        cityCampaignId={cityCampaignId}
        pathname={pathname}
        onChange={setParam}
        onClearAll={clearAllFilters}
      />

      {/* Desktop table — hidden below md so the mobile card stack
          takes over. Cold outreach has 9 columns and that's never
          going to fit on a phone; the card layout below shows the
          same data + same actions vertically. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
              <th className="w-9 px-3 py-2.5">
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              </th>
              <SortableTh
                label="Venue"
                col="venue"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={() => toggleSort("venue")}
                width="w-48 px-3"
              />
              <SortableTh
                label="Email"
                col="email"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={() => toggleSort("email")}
                width="w-44 px-2"
              />
              <SortableTh
                label="ZeroBounce"
                col="zb"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={() => toggleSort("zb")}
                width="w-24 px-2"
              />
              <SortableTh
                label="Phone"
                col="callWindow"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={() => toggleSort("callWindow")}
                width="w-32 px-2"
              />
              <SortableTh
                label="Status"
                col="status"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={() => toggleSort("status")}
                width="w-32 px-2"
              />
              <SortableTh
                label="Assigned"
                col="assignee"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={() => toggleSort("assignee")}
                width="w-28 px-2"
              />
              <th className="px-2 py-2.5">Remarks</th>
              <th className="w-8 px-1 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {displayed.map((e, i) => (
              <ColdRow
                key={e.entryId}
                entry={e}
                staff={staff}
                cityCampaignId={cityCampaignId}
                outreachBrandId={outreachBrandId}
                selected={selected.has(e.entryId)}
                onToggleSelect={() => toggleOne(e.entryId)}
                zebra={i % 2 === 1}
                layout="table"
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card stack. Vertical layout, one card per venue,
          same actions + inline edits available. The sticky-ish
          select-all bar at top doubles as the bulk-target hint. */}
      <div className="md:hidden">
        {entries.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-zinc-200/60 border-b bg-zinc-50/40 px-4 py-2 dark:border-zinc-800/40 dark:bg-zinc-900/30">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex cursor-pointer items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
            >
              <SelectAllCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
              />
              {selected.size > 0 ? `${selected.size} selected` : "Select all"}
            </button>
            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
              {displayed.length} venue{displayed.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
          {displayed.map((e) => (
            <li key={e.entryId}>
              <ColdRow
                entry={e}
                staff={staff}
                cityCampaignId={cityCampaignId}
                outreachBrandId={outreachBrandId}
                selected={selected.has(e.entryId)}
                onToggleSelect={() => toggleOne(e.entryId)}
                zebra={false}
                layout="card"
              />
            </li>
          ))}
        </ul>
      </div>

      <footer className="flex items-center justify-between gap-3 border-zinc-200/60 border-t px-5 py-3 dark:border-zinc-800/40">
        {adding ? (
          <AddVenueRow
            cityId={cityId}
            cityCampaignId={cityCampaignId}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-blue-500/[0.08] hover:text-blue-700 dark:text-zinc-400 dark:hover:text-blue-300"
          >
            <Plus className="h-3 w-3" />
            Add venue
          </button>
        )}
        <span className="hidden font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em] sm:inline-flex">
          <ClipboardPaste className="mr-1 h-3 w-3" />
          Or paste rows from Sheets
        </span>
        <GenerateLeadsButton cityCampaignId={cityCampaignId} cityId={cityId} compact />
      </footer>

      <AiSuggestVenuesModal
        cityCampaignId={cityCampaignId}
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onAdded={() => router.refresh()}
      />

      <BulkPasteModal
        open={pasteOpen}
        rawTsv={pasteRaw}
        cityCampaignId={cityCampaignId}
        cityId={cityId}
        onClose={() => {
          setPasteOpen(false);
          setPasteRaw("");
        }}
      />
    </section>
  );
}

function ColdRow({
  entry,
  staff,
  cityCampaignId,
  outreachBrandId,
  selected,
  onToggleSelect,
  zebra,
  layout,
}: {
  entry: ColdEntry;
  staff: Array<{ id: string; displayName: string }>;
  cityCampaignId: string;
  outreachBrandId: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  zebra: boolean;
  layout: "table" | "card";
}) {
  const [pending, startTx] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const tone = zebra ? "bg-zinc-50/60 dark:bg-zinc-900/30" : "bg-white dark:bg-zinc-900/10";

  function commitField(field: "status" | "assignedStaffId" | "remarks", value: string) {
    // Capture prior value so the undo handler can restore it
    const prior =
      field === "status"
        ? entry.status
        : field === "assignedStaffId"
          ? (entry.assignedStaffId ?? "")
          : (entry.remarks ?? "");

    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("field", field);
    fd.set("value", value);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await updateColdOutreachField(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't save.",
        });
        return;
      }

      // Friendly message per field
      const verb =
        field === "status"
          ? `Status → ${STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value}`
          : field === "assignedStaffId"
            ? value
              ? `Assigned to ${staff.find((s) => s.id === value)?.displayName ?? "someone"}`
              : "Unassigned"
            : "Remarks updated";

      toast.show({
        kind: "success",
        message: `${entry.venueName} · ${verb}`,
        undo: async () => {
          const undoFd = new FormData();
          undoFd.set("entryId", entry.entryId);
          undoFd.set("field", field);
          undoFd.set("value", prior);
          undoFd.set("cityCampaignId", cityCampaignId);
          await updateColdOutreachField(null, undoFd);
        },
      });
    });
  }

  function archive() {
    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await archiveColdOutreachEntry(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Couldn't archive." });
        return;
      }
      toast.show({
        kind: "success",
        message: `Archived ${entry.venueName}`,
        undo: async () => {
          const undoFd = new FormData();
          undoFd.set("entryId", entry.entryId);
          undoFd.set("cityCampaignId", cityCampaignId);
          await unarchiveColdOutreachEntry(null, undoFd);
        },
      });
    });
  }

  // ---------------------------------------------------------------
  // editVenueField — single helper for the 3 inline-editable venue
  // fields (name, email, phone). Sends expectedUpdatedAt for
  // optimistic-lock conflict detection. On conflict, shows a toast,
  // refreshes the page to surface the new value, and returns an
  // error to InlineCell so it reverts the optimistic state.
  // ---------------------------------------------------------------
  function editVenueField(
    field: "name" | "email" | "phoneE164",
  ): (next: string) => Promise<{ ok: boolean; error?: string }> {
    return async (next) => {
      const fd = new FormData();
      fd.set("venueId", entry.venueId);
      fd.set("field", field);
      fd.set("value", next);
      fd.set("cityCampaignId", cityCampaignId);
      fd.set("expectedUpdatedAt", entry.venueUpdatedAt);
      const result = await commitVenueField(null, fd);
      if (result.ok && result.data && "conflict" in result.data) {
        const conflict = result.data;
        const who = conflict.changedByDisplayName ?? "Someone";
        const fieldLabel = field === "phoneE164" ? "phone" : field;
        const currentDisplay =
          conflict.currentValue == null || conflict.currentValue === ""
            ? "(empty)"
            : `"${conflict.currentValue}"`;
        toast.show({
          kind: "error",
          message: `${who} just changed ${entry.venueName}'s ${fieldLabel} to ${currentDisplay}. Refresh and try again.`,
        });
        router.refresh();
        return { ok: false, error: "Conflict — refresh and retry." };
      }
      return { ok: result.ok, error: result.ok ? undefined : result.error };
    };
  }

  // ---------------------------------------------------------------
  // Card layout (mobile). Same fields, same handlers, vertical.
  // ---------------------------------------------------------------
  if (layout === "card") {
    return (
      <article
        className={cn(
          "flex flex-col gap-2.5 px-4 py-3 transition-colors",
          pending && "opacity-60",
          selected && "bg-blue-500/[0.06] dark:bg-blue-400/[0.06]",
        )}
      >
        {/* Header row: checkbox + name + status pill + open link */}
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
            aria-label={`Select ${entry.venueName}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <InlineCell
                  label="Venue name"
                  value={entry.venueName}
                  onCommit={editVenueField("name")}
                />
              </div>
              <Link
                href={`/venues/${entry.venueId}`}
                className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="Open venue detail"
                aria-label="Open venue detail"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusSelect
                current={entry.status}
                pending={pending}
                onChange={(v) => commitField("status", v)}
              />
              <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
                ·
              </span>
              <AssignedSelect
                current={entry.assignedStaffId ?? ""}
                staff={staff}
                pending={pending}
                onChange={(v) => commitField("assignedStaffId", v)}
              />
              {entry.zeroBounceStatus && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset",
                    ZB_TONE[entry.zeroBounceStatus] ??
                      "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
                  )}
                >
                  {entry.zeroBounceStatus.replace("_", " ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Email + AI draft */}
        <div className="flex items-center gap-1.5 pl-6">
          <Mail className="h-3 w-3 shrink-0 text-zinc-400" />
          <div className="min-w-0 flex-1">
            <InlineCell
              label="Venue email"
              value={entry.venueEmail ?? ""}
              placeholder="add email"
              variant="mono"
              inputType="email"
              onCommit={editVenueField("email")}
            />
          </div>
          {entry.venueEmail && (
            <>
              <a
                href={`mailto:${entry.venueEmail}`}
                className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                aria-label="Open in email client"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
              <AiDraftButton
                venueId={entry.venueId}
                venueName={entry.venueName}
                cityCampaignId={cityCampaignId}
                onUseDraft={(draft) => {
                  const subject = encodeURIComponent(draft.subject);
                  const body = encodeURIComponent(draft.body);
                  window.open(
                    `mailto:${entry.venueEmail ?? ""}?subject=${subject}&body=${body}`,
                    "_self",
                  );
                }}
              />
            </>
          )}
          {!entry.venueEmail && (
            <FindEmailButton
              venueId={entry.venueId}
              venueName={entry.venueName}
              venueWebsite={entry.venueWebsite ?? null}
              venueInstagramHandle={entry.venueInstagramHandle ?? null}
              venueCity={entry.cityName ?? null}
              existingEmail={null}
              outreachBrandId={outreachBrandId}
              cityCampaignId={cityCampaignId}
              variant="icon"
            />
          )}
        </div>

        {/* Phone with Quo controls */}
        <div className="pl-6">
          <PhoneCell
            entry={entry}
            cityCampaignId={cityCampaignId}
            outreachBrandId={outreachBrandId}
            editVenueField={editVenueField}
          />
        </div>

        {/* Remarks — full width inline edit */}
        <div className="rounded-md bg-zinc-50/60 px-2 py-1.5 dark:bg-zinc-900/40">
          <p className="mb-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.08em]">
            Remarks
          </p>
          <RemarksInput
            initial={entry.remarks ?? ""}
            pending={pending}
            onCommit={(v) => commitField("remarks", v)}
            draftKey={`remarks:${entry.entryId}`}
          />
        </div>

        {/* History + Archive */}
        <div className="flex items-center justify-between">
          <ActivityHistoryButton
            table="cold_outreach_entries"
            recordId={entry.entryId}
            alsoTable="venues"
            alsoRecordId={entry.venueId}
            compact
          />
          <button
            type="button"
            onClick={archive}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
            aria-label="Archive"
          >
            <Trash2 className="h-3 w-3" />
            Archive
          </button>
        </div>
      </article>
    );
  }

  // ---------------------------------------------------------------
  // Table layout (desktop) — original render below
  // ---------------------------------------------------------------
  return (
    <tr
      className={cn(
        tone,
        "group border-zinc-200/40 border-b transition-colors duration-150 dark:border-zinc-800/30",
        pending && "opacity-60",
        selected && "bg-blue-500/[0.05] dark:bg-blue-400/[0.06]",
      )}
    >
      {/* Selection checkbox */}
      <td className="px-3 py-2 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
          aria-label={`Select ${entry.venueName}`}
        />
      </td>

      {/* Venue — inline-editable name. Operators can rename right from
          the table; the static link to /venues/[id] moves to a small
          arrow that appears on hover so quick edits don't require
          navigating away. */}
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1">
          <InlineCell
            label="Venue name"
            value={entry.venueName}
            variant="default"
            maxWidth={220}
            onCommit={editVenueField("name")}
          />
          <Link
            href={`/venues/${entry.venueId}`}
            className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
            title="Open venue detail"
            aria-label="Open venue detail"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
      </td>

      {/* Email — inline-editable address + AI draft button + mailto link.
          The mailto link only shows when there's a value to send to. */}
      <td className="relative px-2 py-2 align-middle">
        <div className="flex items-center gap-1">
          <InlineCell
            label="Venue email"
            value={entry.venueEmail ?? ""}
            placeholder="add email"
            variant="mono"
            inputType="email"
            maxWidth={150}
            onCommit={editVenueField("email")}
          />
          {entry.venueEmail && (
            <>
              <a
                href={`mailto:${entry.venueEmail}`}
                className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
                title="Open in email client"
                aria-label="Open in email client"
              >
                <Mail className="h-2.5 w-2.5" />
              </a>
              <AiDraftButton
                venueId={entry.venueId}
                venueName={entry.venueName}
                cityCampaignId={cityCampaignId}
                onUseDraft={(draft) => {
                  const subject = encodeURIComponent(draft.subject);
                  const body = encodeURIComponent(draft.body);
                  window.open(
                    `mailto:${entry.venueEmail ?? ""}?subject=${subject}&body=${body}`,
                    "_self",
                  );
                }}
              />
            </>
          )}
          {!entry.venueEmail && (
            <FindEmailButton
              venueId={entry.venueId}
              venueName={entry.venueName}
              venueWebsite={entry.venueWebsite ?? null}
              venueInstagramHandle={entry.venueInstagramHandle ?? null}
              venueCity={entry.cityName ?? null}
              existingEmail={null}
              outreachBrandId={outreachBrandId}
              cityCampaignId={cityCampaignId}
              variant="icon"
            />
          )}
        </div>
      </td>

      {/* ZeroBounce */}
      <td className="px-2 py-2 align-middle">
        {entry.zeroBounceStatus ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset",
              ZB_TONE[entry.zeroBounceStatus] ?? "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
            )}
          >
            {entry.zeroBounceStatus.replace("_", " ")}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-zinc-400">unchecked</span>
        )}
      </td>

      {/* Phone — when present, QuoDialControls handles click-to-call /
          SMS / Viber. When absent or being edited, an inline cell lets
          the operator add or change the number. The pencil affordance
          on hover lets them switch from dial-mode to edit-mode anytime. */}
      <td className="relative px-2 py-2 align-middle">
        <PhoneCell
          entry={entry}
          cityCampaignId={cityCampaignId}
          outreachBrandId={outreachBrandId}
          editVenueField={editVenueField}
        />
      </td>

      {/* Status */}
      <td className="px-2 py-2 align-middle">
        <StatusSelect
          current={entry.status}
          pending={pending}
          onChange={(v) => commitField("status", v)}
        />
      </td>

      {/* Assigned */}
      <td className="px-2 py-2 align-middle">
        <AssignedSelect
          current={entry.assignedStaffId ?? ""}
          staff={staff}
          pending={pending}
          onChange={(v) => commitField("assignedStaffId", v)}
        />
      </td>

      {/* Remarks */}
      <td className="px-2 py-2 align-middle">
        <RemarksInput
          initial={entry.remarks ?? ""}
          pending={pending}
          onCommit={(v) => commitField("remarks", v)}
          draftKey={`remarks:${entry.entryId}`}
        />
      </td>

      {/* History + Archive — both row-hover affordances so the row
          itself reads calm when not interacting. */}
      <td className="px-1 py-2 align-middle">
        <div className="flex items-center gap-0.5">
          <div className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <ActivityHistoryButton
              table="cold_outreach_entries"
              recordId={entry.entryId}
              alsoTable="venues"
              alsoRecordId={entry.venueId}
              compact
            />
          </div>
          <button
            type="button"
            onClick={archive}
            disabled={pending}
            className="rounded-md p-1 text-zinc-400 opacity-0 transition-all duration-150 hover:bg-rose-500/[0.08] hover:text-rose-600 group-hover:opacity-100"
            aria-label="Archive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// =========================================================================
// PhoneCell — dial mode when number present, inline-edit when absent
// =========================================================================

function PhoneCell({
  entry,
  cityCampaignId,
  outreachBrandId,
  editVenueField,
}: {
  entry: ColdEntry;
  cityCampaignId: string;
  outreachBrandId: string | null;
  editVenueField: (
    field: "name" | "email" | "phoneE164",
  ) => (next: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const phoneCommit = editVenueField("phoneE164");

  // No number yet → straight to inline-edit mode so adding a phone is
  // a single interaction
  if (!entry.venuePhone || editing) {
    return (
      <div className="flex items-center gap-1">
        <InlineCell
          label="Venue phone"
          value={entry.venuePhone ?? ""}
          placeholder="add phone"
          variant="mono"
          inputType="tel"
          maxWidth={140}
          onCommit={async (next) => {
            const result = await phoneCommit(next);
            if (result.ok) setEditing(false);
            return result;
          }}
        />
        {entry.venuePhone && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded p-0.5 text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Cancel edit"
            title="Cancel"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    );
  }

  // Number present → show dial controls + a small pencil to switch
  // into edit mode
  return (
    <div className="flex items-center gap-1">
      <QuoDialControls
        venueId={entry.venueId}
        venueName={entry.venueName}
        venuePhone={entry.venuePhone}
        outreachBrandId={outreachBrandId}
        cityCampaignId={cityCampaignId}
        coldEntryId={entry.entryId}
        venueHours={entry.venueHours}
        venueType={entry.venueType}
        venueTimezone={entry.venueTimezone}
      />
      <CallAttemptBadge count={entry.callAttempts} />
      <CallWindowHint
        venueHours={entry.venueHours}
        venueType={entry.venueType}
        venueTimezone={entry.venueTimezone}
      />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
        aria-label="Edit phone"
        title="Edit phone"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function StatusSelect({
  current,
  pending,
  onChange,
}: {
  current: string;
  pending: boolean;
  onChange: (v: string) => void;
}) {
  const opt = STATUS_OPTIONS.find((o) => o.value === current);
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 font-medium font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
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

function AssignedSelect({
  current,
  staff,
  pending,
  onChange,
}: {
  current: string;
  staff: Array<{ id: string; displayName: string }>;
  pending: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xs transition-colors",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
        "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
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

function RemarksInput({
  initial,
  pending,
  onCommit,
  draftKey,
}: {
  initial: string;
  pending: boolean;
  onCommit: (v: string) => void;
  /** Stable key for localStorage persistence. Pass to enable
      'never lose what I typed' behavior. */
  draftKey?: string;
}) {
  const [committed, setCommitted] = useState(initial);
  const [saved, setSaved] = useState(false);
  const {
    value: draft,
    setValue: setDraft,
    clearDraft,
    recovered,
  } = useDraft({
    key: draftKey ?? "",
    initial,
    enabled: !!draftKey,
  });

  useEffect(() => {
    setCommitted(initial);
  }, [initial]);

  function commit() {
    if (draft === committed) return;
    onCommit(draft);
    setCommitted(draft);
    clearDraft(); // Server now has it — drop the local copy
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
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
            clearDraft();
            e.currentTarget.blur();
          }
        }}
        disabled={pending}
        placeholder={recovered ? "Restored draft — Enter to save" : "Add remarks…"}
        className={cn(
          "h-7 border-transparent bg-transparent pr-6 text-xs transition-colors",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white",
          "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
          "placeholder:text-zinc-400/60",
          recovered &&
            "border-amber-400/40 bg-amber-50/30 dark:border-amber-700/40 dark:bg-amber-950/20",
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

function AddVenueRow({
  cityId,
  cityCampaignId,
  onDone,
}: {
  cityId: string;
  cityCampaignId: string;
  onDone: () => void;
}) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSelect(v: { id: string; name: string }) {
    setError(null);
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("venueId", v.id);
    startTx(async () => {
      const result = await upsertColdOutreachEntry(null, fd);
      if (result.ok) onDone();
      else setError(result.error ?? "Add failed.");
    });
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="w-64">
        <VenueAutocomplete
          cityId={cityId}
          selectedName={null}
          onSelect={handleSelect}
          placeholder="Search or create venue…"
          compact={false}
        />
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
        <X className="h-3 w-3" />
      </Button>
      {error && <span className="text-rose-600 text-xs">{error}</span>}
    </div>
  );
}

function EmptyState({
  cityCampaignId,
  cityId,
  onManualAdd,
}: {
  cityCampaignId: string;
  cityId: string;
  onManualAdd: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-8 text-center shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <Mail className="mx-auto h-6 w-6 text-zinc-400" />
      <h2 className="mt-3 font-semibold text-lg tracking-tight">No cold outreach yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-600 leading-relaxed dark:text-zinc-400">
        Generate a starting list of bars / clubs / restaurants in this city's nightlife cluster, or
        add venues one at a time.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <GenerateLeadsButton cityCampaignId={cityCampaignId} cityId={cityId} />
        <Button type="button" variant="outline" onClick={onManualAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add venue manually
        </Button>
      </div>
      <p className="mt-4 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
        cityId · {cityId.slice(0, 8)}…
      </p>
    </section>
  );
}

function GenerateLeadsButton({
  cityCampaignId,
  cityId,
  compact = false,
}: {
  cityCampaignId: string;
  cityId?: string;
  compact?: boolean;
}) {
  const [pending, startTx] = useTransition();
  const [importing, startImport] = useTransition();
  const [suggestions, setSuggestions] = useState<Array<{
    placeId: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    rating: number | null;
    userRatingCount: number | null;
  }> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notConfigured, setNotConfigured] = useState(false);
  const [zeroSuggestions, setZeroSuggestions] = useState<{
    searchedCount: number;
    searchedRadiusKm: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function close() {
    setSuggestions(null);
    setSelected(new Set());
    setNotConfigured(false);
    setZeroSuggestions(null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: close is stable
  useEffect(() => {
    const hasPopover = !!suggestions || notConfigured || !!zeroSuggestions;
    if (!hasPopover) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [suggestions, notConfigured, zeroSuggestions]);

  function run() {
    close();
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await generateVenueLeads(null, fd);
      if (!result.ok || !result.data) return;
      if (result.data.notConfigured) {
        setNotConfigured(true);
        return;
      }
      if (result.data.suggestions.length === 0) {
        setZeroSuggestions({
          searchedCount: result.data.searchedCount ?? 0,
          searchedRadiusKm: result.data.searchedRadiusKm ?? 0,
        });
        return;
      }
      setSuggestions(result.data.suggestions);
      // Pre-select all by default — operator unchecks any rejects
      setSelected(new Set(result.data.suggestions.map((s) => s.placeId)));
    });
  }

  async function importSelected() {
    if (!suggestions || !cityId || selected.size === 0) return;
    const chosen = suggestions.filter((s) => selected.has(s.placeId));
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("cityId", cityId);
    fd.set("suggestionsJson", JSON.stringify(chosen));
    startImport(async () => {
      const result = await acceptLeadSuggestions(null, fd);
      if (result.ok) {
        close();
      }
    });
  }

  function toggle(placeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  const Trigger = compact ? (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-emerald-500/[0.08] hover:text-emerald-700 dark:text-zinc-400 dark:hover:text-emerald-300"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      Generate leads
    </button>
  ) : (
    <Button type="button" onClick={run} disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5" /> Generate venue leads
        </>
      )}
    </Button>
  );

  return (
    <div ref={containerRef} className="relative inline-block">
      {Trigger}

      {notConfigured && (
        <div className="absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-amber-200/80 bg-amber-50/95 p-3 text-xs shadow-lg dark:border-amber-900/40 dark:bg-amber-950/80">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Lead generation isn't configured yet
          </p>
          <p className="mt-1 text-amber-800/80 dark:text-amber-300/80">
            Add{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/40">
              GOOGLE_MAPS_API_KEY
            </code>{" "}
            to the server env and Places nearby-search will populate suggestions automatically.
          </p>
        </div>
      )}

      {zeroSuggestions && (
        <div className="absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {zeroSuggestions.searchedCount === 0 ? (
            <>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                Google returned nothing nearby.
              </p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                Searched bars / nightclubs / restaurants within {zeroSuggestions.searchedRadiusKm}km
                of the city's recorded center. Either the city has no matching venues (unlikely) or
                the city's coordinates are wrong. Open the master city record and verify the lat/lng
                pin.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                {zeroSuggestions.searchedCount} found, all already in your directory.
              </p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                Google returned {zeroSuggestions.searchedCount} venues within{" "}
                {zeroSuggestions.searchedRadiusKm}km, but each matched a venue already in your
                venues table (by place_id). Add venues from a different city, or widen your search
                by moving the city's center pin.
              </p>
            </>
          )}
        </div>
      )}

      {suggestions && (
        <div className="absolute top-full right-0 z-50 mt-1 w-[28rem] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <header className="flex items-baseline justify-between border-zinc-200/60 border-b px-4 py-2.5 dark:border-zinc-800/40">
            <h3 className="font-semibold text-sm tracking-tight">
              {suggestions.length} candidate{suggestions.length === 1 ? "" : "s"}
            </h3>
            <button
              type="button"
              onClick={() => {
                if (selected.size === suggestions.length) setSelected(new Set());
                else setSelected(new Set(suggestions.map((s) => s.placeId)));
              }}
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            >
              {selected.size === suggestions.length ? "Deselect all" : "Select all"}
            </button>
          </header>
          <ul className="max-h-80 divide-y divide-zinc-200/40 overflow-auto dark:divide-zinc-800/30">
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                  <input
                    type="checkbox"
                    checked={selected.has(s.placeId)}
                    onChange={() => toggle(s.placeId)}
                    className="mt-1 h-3.5 w-3.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {s.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {s.address ?? "no address"}
                    </p>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                      {s.rating != null && (
                        <span className="text-amber-600 dark:text-amber-400">
                          ★ {s.rating.toFixed(1)}
                          {s.userRatingCount != null && ` · ${s.userRatingCount}`}
                        </span>
                      )}
                      {s.phone && <span>{s.phone}</span>}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <footer className="flex items-center justify-between border-zinc-200/60 border-t px-4 py-2.5 dark:border-zinc-800/40">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
              {selected.size} of {suggestions.length} selected
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={importSelected}
                disabled={selected.size === 0 || importing || !cityId}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" /> Import {selected.size}
                  </>
                )}
              </Button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Bulk action bar — appears as a sticky strip below the table header when
// at least one row is selected. Three actions: change status, assign, archive.
// =========================================================================

function BulkActionBar({
  selectedIds,
  selectedEntries,
  cityCampaignId,
  staff,
  onComplete,
}: {
  selectedIds: string[];
  selectedEntries: Array<{
    entryId: string;
    venueId: string;
    venueName: string;
    venueEmail: string | null;
  }>;
  cityCampaignId: string;
  staff: Array<{ id: string; displayName: string }>;
  onComplete: () => void;
}) {
  const [pendingStatus, startStatus] = useTransition();
  const [pendingAssign, startAssign] = useTransition();
  const [pendingArchive, startArchive] = useTransition();
  const [bulkAiOpen, setBulkAiOpen] = useState(false);
  const toast = useToast();

  // How many of the selection actually have an email — drives the
  // Draft button label and enabled state.
  const eligibleForAi = selectedEntries.filter((e) => !!e.venueEmail).length;

  function setStatus(status: string) {
    const fd = new FormData();
    fd.set("entryIds", selectedIds.join(","));
    fd.set("status", status);
    fd.set("cityCampaignId", cityCampaignId);
    startStatus(async () => {
      const result = await bulkUpdateColdOutreachStatus(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Status update failed." });
        return;
      }
      const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
      toast.show({
        kind: "success",
        message: `${result.data?.updated ?? 0} venue${result.data?.updated === 1 ? "" : "s"} → ${label}`,
        // Bulk status undo is best-effort — we don't preserve per-row
        // prior statuses (cheap to add later if there's demand). For
        // now the undo button isn't offered on bulk status changes.
      });
      onComplete();
    });
  }

  function assign(staffMemberId: string) {
    const fd = new FormData();
    fd.set("entryIds", selectedIds.join(","));
    fd.set("staffMemberId", staffMemberId);
    fd.set("cityCampaignId", cityCampaignId);
    startAssign(async () => {
      const result = await bulkAssignColdOutreach(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Assignment failed." });
        return;
      }
      const assignee = staff.find((s) => s.id === staffMemberId)?.displayName ?? "unassigned";
      toast.show({
        kind: "success",
        message: `Assigned ${result.data?.updated ?? 0} venue${result.data?.updated === 1 ? "" : "s"} to ${assignee}`,
      });
      onComplete();
    });
  }

  function archive() {
    // No confirm() — the toast's Undo button is the safety net,
    // matching how Sheets handles delete (you can always Cmd+Z).
    const entryIds = [...selectedIds];
    const fd = new FormData();
    fd.set("entryIds", entryIds.join(","));
    fd.set("cityCampaignId", cityCampaignId);
    startArchive(async () => {
      const result = await bulkArchiveColdOutreach(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Archive failed." });
        return;
      }
      const count = result.data?.archived ?? 0;
      toast.show({
        kind: "success",
        message: `Archived ${count} venue${count === 1 ? "" : "s"}`,
        undo: async () => {
          const undoFd = new FormData();
          undoFd.set("entryIds", entryIds.join(","));
          undoFd.set("cityCampaignId", cityCampaignId);
          await bulkUnarchiveColdOutreach(null, undoFd);
        },
      });
      onComplete();
    });
  }

  const busy = pendingStatus || pendingAssign || pendingArchive;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-blue-200/60 border-b bg-blue-50/60 px-5 py-2.5 dark:border-blue-900/40 dark:bg-blue-950/30">
      <div className="flex items-center gap-2">
        <span className="font-medium font-mono text-[11px] text-blue-700 uppercase tracking-[0.08em] dark:text-blue-300">
          {selectedIds.length} selected
        </span>
        <button
          type="button"
          onClick={onComplete}
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Bulk status */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Status →
          </span>
          <select
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v) setStatus(v);
              e.target.value = "";
            }}
            className="h-7 cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-2 pr-6 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="">change…</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {pendingStatus && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
        </div>

        {/* Bulk assign */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Assign →
          </span>
          <select
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== "_skip") assign(v);
              e.target.value = "_skip";
            }}
            className="h-7 cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-2 pr-6 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            defaultValue="_skip"
          >
            <option value="_skip">pick…</option>
            <option value="">— Unassign</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
          {pendingAssign && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
        </div>

        {/* Bulk AI drafts — only meaningful when at least one selected
            row has an email address; we still render the button even
            when 0 are eligible so the operator gets the modal's
            'no emails' explainer instead of a silent disabled state. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setBulkAiOpen(true)}
          disabled={busy}
          className="text-violet-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
        >
          <Sparkles className="h-3 w-3" />
          Draft emails
          {eligibleForAi !== selectedIds.length && (
            <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.08em] opacity-70">
              ({eligibleForAi}/{selectedIds.length})
            </span>
          )}
        </Button>

        {/* Bulk archive */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={archive}
          disabled={busy}
          className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
        >
          {pendingArchive ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Archiving…
            </>
          ) : (
            <>
              <Trash2 className="h-3 w-3" /> Archive
            </>
          )}
        </Button>
      </div>

      <BulkAiDraftModal
        open={bulkAiOpen}
        entries={selectedEntries}
        cityCampaignId={cityCampaignId}
        onClose={() => setBulkAiOpen(false)}
      />
    </div>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  // React doesn't expose "indeterminate" as a prop — set it via ref
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
      aria-label="Select all venues"
    />
  );
}

// =========================================================================
// SortableTh — column header that toggles asc/desc on click
// =========================================================================

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
  width,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: () => void;
  width: string;
}) {
  const active = sortKey === col;
  return (
    <th className={cn(width, "py-2.5")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors hover:text-zinc-900 dark:hover:text-zinc-100",
          active ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500",
        )}
      >
        {label}
        <span className="inline-flex w-2.5 justify-center text-[9px]" aria-hidden>
          {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

// =========================================================================
// FilterChipStrip — quick filters at the top of the table
// =========================================================================

function FilterChipStrip({
  entries,
  displayedCount,
  filterStatus,
  filterAssignee,
  filterZb,
  hasActive,
  showUnreachable,
  hiddenUnreachableCount,
  staff,
  cityCampaignId,
  pathname,
  onChange,
  onClearAll,
}: {
  entries: ColdEntry[];
  displayedCount: number;
  filterStatus: string;
  filterAssignee: string;
  filterZb: string;
  hasActive: boolean;
  /** Whether unreachable-status rows are currently being shown. */
  showUnreachable: boolean;
  /** Number of unreachable rows hidden by the default filter. Drives
   *  the "+ N unreachable" chip's visibility. */
  hiddenUnreachableCount: number;
  staff: Array<{ id: string; displayName: string }>;
  cityCampaignId: string;
  pathname: string;
  onChange: (key: string, value: string | null) => void;
  onClearAll: () => void;
}) {
  // Surface only the statuses that actually exist in the dataset, in
  // pipeline order, so empty buckets don't clutter the strip.
  const statusCounts = new Map<string, number>();
  for (const e of entries) {
    statusCounts.set(e.status, (statusCounts.get(e.status) ?? 0) + 1);
  }
  const orderedStatuses = STATUS_OPTIONS.filter((s) => statusCounts.has(s.value));

  // Same for zerobounce buckets
  const zbCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.zeroBounceStatus) {
      zbCounts.set(e.zeroBounceStatus, (zbCounts.get(e.zeroBounceStatus) ?? 0) + 1);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-zinc-200/60 border-b bg-zinc-50/30 px-4 py-2 dark:border-zinc-800/40 dark:bg-zinc-900/20">
      {/* Status filter — pills, click to toggle */}
      {orderedStatuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {orderedStatuses.map((s) => {
            const selected = filterStatus === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange("status", selected ? null : s.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset transition-colors",
                  selected
                    ? "bg-blue-500/[0.10] text-blue-700 ring-blue-500/30 dark:text-blue-300"
                    : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800",
                )}
              >
                {s.label}
                <span className="font-normal tabular-nums opacity-60">
                  {statusCounts.get(s.value) ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Hide-unreachable toggle. Only renders when at least one
          unreachable row exists in the dataset; otherwise the chip
          would have no purpose. The default state is "hidden" — no
          showUnreachable param in the URL — so most operators never
          see this chip at all. */}
      {hiddenUnreachableCount > 0 && (
        <button
          type="button"
          onClick={() => onChange("showUnreachable", showUnreachable ? null : "1")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset transition-colors",
            showUnreachable
              ? "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600"
              : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800",
          )}
          title={
            showUnreachable
              ? "Showing unreachable venues. Click to hide them again."
              : `${hiddenUnreachableCount} unreachable ${hiddenUnreachableCount === 1 ? "venue is" : "venues are"} hidden. Click to show them.`
          }
        >
          {showUnreachable ? "Hide unreachable" : "+ Show unreachable"}
          <span className="font-normal tabular-nums opacity-60">{hiddenUnreachableCount}</span>
        </button>
      )}

      {/* Assignee dropdown */}
      <div className="ml-auto flex items-center gap-1.5">
        <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          Assignee
        </label>
        <select
          value={filterAssignee}
          onChange={(e) => onChange("assignee", e.target.value || null)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="">All</option>
          <option value="__unassigned__">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* ZeroBounce dropdown — only when at least one entry has ZB data */}
      {zbCounts.size > 0 && (
        <div className="flex items-center gap-1.5">
          <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Email
          </label>
          <select
            value={filterZb}
            onChange={(e) => onChange("zb", e.target.value || null)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="">All</option>
            {[...zbCounts.entries()].map(([k, c]) => (
              <option key={k} value={k}>
                {k.replace("_", " ")} ({c})
              </option>
            ))}
          </select>
        </div>
      )}

      {hasActive && (
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-md px-2 py-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          Clear · {displayedCount}/{entries.length}
        </button>
      )}

      <SavedViewsPicker
        surface="cold_outreach"
        contextId={cityCampaignId}
        filterKeys={["sort", "dir", "status", "assignee", "zb"]}
        pathname={pathname}
      />
    </div>
  );
}

/**
 * CallAttemptBadge — small "Calls: N/5" pill that surfaces the 60-day
 * unanswered-call count so operators see how close they are to the
 * 5-attempt cap that auto-flips status to 'unreachable'.
 *
 * Tone scale:
 *   0     → hidden (no badge — don't add chrome for a venue we've
 *           never called)
 *   1-2   → zinc (informational)
 *   3-4   → amber (approaching cap)
 *   5+    → rose (cap hit; status should already be 'unreachable')
 *
 * Hidden at 0 because the badge would add visual noise to every row
 * on a fresh campaign where nothing's been called yet.
 */
function CallAttemptBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const tone =
    count >= 5
      ? "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300"
      : count >= 3
        ? "bg-amber-400/15 text-amber-700 ring-amber-400/25 dark:text-amber-300"
        : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400";
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-px font-mono text-[9px] ring-1 ring-inset ${tone}`}
      title={`${count} unanswered call ${count === 1 ? "attempt" : "attempts"} in the last 60 days. 5+ auto-flips status to 'unreachable'.`}
    >
      {count}/5
    </span>
  );
}

/**
 * CallWindowHint — small pill suggesting when to call this venue
 * based on its parsed opening hours + venue type.
 *
 * Rendered inline next to the dial controls + attempt badge. Hidden
 * when no useful suggestion can be derived (no hours data + no
 * venue type signal) so we don't add noise.
 *
 * Memoized via useMemo so the parser doesn't re-run on every render
 * — for cold-outreach tables with 100+ rows the cumulative parse
 * cost is non-trivial without it.
 */
function CallWindowHint({
  venueHours,
  venueType,
  venueTimezone,
}: {
  venueHours: string | null;
  venueType: readonly string[];
  venueTimezone?: string;
}) {
  const suggestion = useMemo(() => {
    if (!venueHours && (!venueType || venueType.length === 0)) return null;
    const parsed = parseVenueHours(venueHours);
    return suggestCallWindow(parsed, new Date(), venueType, venueTimezone);
  }, [venueHours, venueType, venueTimezone]);

  if (!suggestion) return null;

  // Tone palette mirrors the rest of the inline pill family in this
  // file (CallAttemptBadge, status pills). 'now' = warm emerald so
  // operators notice the "call them right now" cue; 'ok' = neutral
  // zinc; 'later' = blue for the planned-for-tomorrow case;
  // 'unknown' = ghost zinc to indicate the suggestion is a fallback
  // (hours unparsed).
  const tone =
    suggestion.tone === "now"
      ? "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
      : suggestion.tone === "later"
        ? "bg-blue-500/[0.10] text-blue-700 ring-blue-500/30 dark:text-blue-300"
        : suggestion.tone === "ok"
          ? "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400"
          : "bg-zinc-500/5 text-zinc-500 ring-zinc-500/15 dark:text-zinc-500";

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px font-mono text-[9px] ring-1 ring-inset ${tone}`}
      title={suggestion.detail}
    >
      {suggestion.label}
    </span>
  );
}

"use client";

import { ComposeEmailButton } from "@/app/(admin)/_components/composer/compose-email-button";
import { SavedViewsPicker } from "@/app/(admin)/_components/saved-views-picker";
import { WarmLeadPromoteButton } from "@/app/(admin)/_components/warm-lead-promote-button";
import { ActivityHistoryButton } from "@/components/ui/activity-history-button";
import { Button } from "@/components/ui/button";
import {
  PresenceAvatarStack,
  formatRealtimeAgo,
  usePresenceHeartbeat,
  useRealtimeChannel,
} from "@/components/ui/data-table";
import { useGridArrowNav } from "@/components/ui/data-table/use-grid-arrow-nav";
import { InlineCell } from "@/components/ui/inline-cell";
import { RotChip } from "@/components/ui/rot-chip";
import { useShortcut } from "@/components/ui/shortcut-provider";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { parseVenueHours, suggestCallWindow } from "@/lib/parse-venue-hours";
import { useDraft } from "@/lib/use-draft";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  ExternalLink,
  Flame,
  Loader2,
  Mail,
  Plus,
  Sparkles,
  Trash2,
  Wifi,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  archiveColdOutreachEntry,
  bulkArchiveColdOutreach,
  bulkAssignColdOutreach,
  bulkSetWarmFlag,
  bulkUnarchiveColdOutreach,
  bulkUpdateColdOutreachStatus,
  commitVenueField,
  createFollowUpFromRemark,
  unarchiveColdOutreachEntry,
  updateColdOutreachField,
  upsertColdOutreachEntry,
} from "../_cold-outreach-actions";
import { AiDraftButton } from "./ai-draft-button";
import { AiSuggestVenuesModal } from "./ai-suggest-venues-modal";
import { BulkAiDraftModal } from "./bulk-ai-draft-modal";
import { BulkPasteModal } from "./bulk-paste-modal";
import { ColdAllModal } from "./cold-all-modal";
import { BulkEnrichButton, ContactDot } from "./contact-enrichment";
import { EscalationPopover } from "./escalation-popover";
import { EscalationStatusPopover } from "./escalation-status-popover";
import { FindEmailButton } from "./find-email-button";
import { HandoffButton } from "./handoff-modal";
import { LeadScoreChip, ScoreAllButton } from "./lead-score-ui";
import { QuoDialControls } from "./quo-dial-controls";
import { VenueAutocomplete } from "./venue-autocomplete";
import { VenueEmailsButton } from "./venue-emails-popover";

type SortKey =
  | "venue"
  | "email"
  | "contact"
  | "status"
  | "assignee"
  | "zb"
  | "lastTouch"
  | "callWindow"
  | "engagement";

interface ColdEntry {
  entryId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  /** Additional known addresses (incl. emails promoted from a scrape) so the
   *  compose button can email every known address at once. */
  venueAlternateEmails: string[];
  venuePhone: string | null;
  venueWebsite: string | null;
  venueInstagramHandle: string | null;
  /** Free-text opening hours; drives the "Best call: 2-3 PM" hint. */
  venueHours: string | null;
  /** Tag array (["bar", "club", ...]) — fallback signal for the
   *  call-window heuristic when hours can't be parsed. */
  venueType: string[];
  /** Contact-enrichment signals (E6) for the per-row status dot. */
  hasScrapedEmail: boolean;
  lastEnrichmentStatus: string | null;
  enrichmentAttempted: boolean;
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
  /**
   * Warm-leads flag (migration 0082). Independent of `status`. The
   * warm-mode filter switches on this — see line below. Cold mode
   * shows ALL non-archived rows (mass outreach queue) regardless.
   */
  isWarm: boolean;
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
  /**
   * Escalation workflow (#027 / migration 0027). NULL when not
   * escalated. When set, the row shows an "Escalated to X" pill +
   * feeds the dashboard widget for the assignee.
   */
  escalatedToStaffId: string | null;
  escalatedToName: string | null;
  escalatedAt: string | null;
  escalationNotes: string | null;
  /**
   * AI lead score (0..100) + reason, plus when it was generated.
   * Drives the default sort + the score chip in the row. Null when
   * the entry hasn't been scored yet (operator hasn't run the
   * backfill or the entry is brand new).
   */
  aiLeadScore: number | null;
  aiLeadScoreReason: string | null;
  aiLeadScoreAt: Date | null;
  /** Cadence-aware row state label (Phase 2.12): thread cadence_state for this
   *  campaign (rich) or the cold-outreach status, with relative timing. */
  cadenceLabel: string;
  /** Phase 2.14: cold sequence exhausted -> offer cross-domain handoff. */
  readyForHandoff: boolean;
  /** Closer sent, no reply — handoff unlocks on exhaustion (refdoc 6.2). */
  approachingHandoff: boolean;
  /** Cadence touches used vs the campaign hard cap (refdoc 6.3). */
  touchCount: number;
  touchCap: number;
  /** Per-venue engagement (Tier-2 soft signal, 0-100) + band. Sortable so
   *  genuinely-interested venues rise. Display/sort only -- never a send. */
  engagementScore: number;
  engagementBand: "dead" | "cold" | "warming" | "engaged" | "hot";
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
  /**
   * Whether the viewer is an admin. Drives admin-only affordances:
   *   - Lead-score backfill button (Haiku ROI #5) — only admins
   *     can spend on AI batches; everyone else sees the read-only
   *     score chips that admins have populated.
   */
  currentStaffIsAdmin?: boolean;
  /**
   * Staff eligible to receive an escalation (admin/lead/outreach,
   * not readonly). Loaded server-side and passed through so the
   * EscalationPopover doesn't need its own fetch on open.
   */
  escalationTargets: Array<{
    id: string;
    displayName: string;
    role: string;
    primaryEmail: string;
  }>;
  /** Browser-restricted Maps key — passed through to AiSuggestVenuesModal so
   *  its overview map can render. Optional; if absent the map just hides. */
  googleMapsApiKey?: string;
  /**
   * Which slice of cold_outreach_entries to render:
   *   - "cold" (default): everything EXCEPT status='interested'. The
   *     classic outreach queue.
   *   - "warm": ONLY status='interested'. Promoted leads ready to be
   *     assigned to a crawl slot. Same columns, same features as cold
   *     mode, but the section header reads "Warm leads," the bulk
   *     "Move" button flips to "Move back to cold," and each row
   *     gains an inline Promote-to-crawl affordance.
   *
   * Per operator: "when you promote to warm leads it should have all
   * the same columns and features as the cold outreach table." So
   * this is literally the same component; the mode just tweaks copy
   * + a couple of action labels.
   */
  mode?: "cold" | "warm";
  /**
   * Crawls in this city_campaign, used to populate the per-row
   * Promote button's crawl picker in warm mode. Empty / absent in
   * cold mode — the Promote button doesn't render there.
   */
  crawlsForPromote?: Array<{
    eventId: string;
    dayPart:
      | "thursday_night"
      | "friday_night"
      | "saturday_day"
      | "saturday_night"
      | "sunday_day"
      | "sunday_night";
    crawlNumber: number;
    middleVenueGroupId: string | null;
    filledSlots: Array<{
      role: "wristband" | "middle" | "final" | "alt_final";
      slotPosition: number;
      venueName: string | null;
    }>;
  }>;
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

/** Statuses that mean "don't email this address" regardless of nuance. */
const ZB_INVALID_FAMILY = new Set(["invalid", "spamtrap", "abuse", "do_not_mail"]);

/**
 * Compact icon rendering for the ZB (ZeroBounce) column.
 *
 *   valid         → green CheckCircle2  (tooltip "Valid")
 *   invalid       → red XCircle         (tooltip "Invalid")
 *   spamtrap      → red XCircle         (tooltip "Spamtrap (invalid)")
 *   abuse         → red XCircle         (tooltip "Abuse (invalid)")
 *   do_not_mail   → red XCircle         (tooltip "Do not mail (invalid)")
 *   catch_all     → small amber dot     (tooltip "Catch-all (accepts everything, ambiguous)")
 *   unknown       → small zinc dot      (tooltip "Unknown")
 *   null          → small zinc dash     (tooltip "Unchecked")
 *
 * The column is sized w-10 to match this icon-only width — previously
 * the column had to be w-24 to fit the "do_not_mail" pill text.
 */
function ZbIcon({ status }: { status: string | null }) {
  if (status === null || status === undefined) {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700"
        title="Unchecked"
        aria-label="ZeroBounce: unchecked"
      />
    );
  }
  if (status === "valid") {
    return (
      <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-500" aria-label="ZeroBounce: valid">
        <title>Valid</title>
      </CheckCircle2>
    );
  }
  if (ZB_INVALID_FAMILY.has(status)) {
    const label =
      status === "invalid"
        ? "Invalid"
        : status === "spamtrap"
          ? "Spamtrap (invalid)"
          : status === "abuse"
            ? "Abuse (invalid)"
            : "Do not mail (invalid)";
    return (
      <XCircle className="inline h-3.5 w-3.5 text-rose-500" aria-label={`ZeroBounce: ${status}`}>
        <title>{label}</title>
      </XCircle>
    );
  }
  // catch_all / unknown / anything else → small ambiguous dot
  const isCatchAll = status === "catch_all";
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        isCatchAll ? "bg-amber-400" : "bg-zinc-400",
      )}
      title={isCatchAll ? "Catch-all (accepts everything, ambiguous)" : status.replace("_", " ")}
      aria-label={`ZeroBounce: ${status}`}
    />
  );
}

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
  entries: rawEntries,
  staff,
  currentStaffId,
  currentStaffIsAdmin = false,
  escalationTargets,
  googleMapsApiKey,
  mode = "cold",
  crawlsForPromote,
}: Props) {
  // Partition the input so each mode renders only its own slice.
  // Warm mode = status === 'interested' (everything the operator has
  // moved to the warm-lead queue); cold mode = everything else.
  // Doing the filter at the top means everything downstream — sort,
  // filter chips, selection, displayed count — operates on the
  // already-narrowed list. That makes the two surfaces feel like
  // independent tables even though they share a component.
  const entries = useMemo(() => {
    // Warm panel: rows with is_warm=true.
    // Cold panel: ALL non-archived rows (mass outreach queue).
    //
    // Per operator: "cold should be preserved and then yes warm
    // moves up — a row that shows up in each table. So in warm
    // it's like oh they are interested but haven't said yes, and
    // someone might delete them from warm table but they are
    // still in the cold table as that cold table is used for
    // mass outreach." Pre-0082 the cold panel filtered out
    // status='interested', which meant promoting to warm REMOVED
    // the row from cold — exactly the bug the operator was
    // describing. is_warm is independent of status so promotions
    // preserve the cold-table presence.
    // A venue counts as warm if it carries the is_warm flag OR its
    // status is "interested" -- some interested rows never got the flag
    // set (AI/inbox auto-status writes status directly), and the
    // operator's mental model is "interested == warm".
    if (mode === "warm") return rawEntries.filter((e) => e.isWarm || e.status === "interested");
    // Cold panel: exclude rows that have been promoted to warm (is_warm) or are
    // already 'interested' -- once a venue is warm it lives in the Warm tab, not
    // the cold mass-outreach queue (operator request 2026-06-08, reversing the
    // earlier "show in both tables" behaviour). Warm and cold are now disjoint.
    return rawEntries.filter((e) => !(e.isWarm || e.status === "interested"));
  }, [rawEntries, mode]);

  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [coldAllOpen, setColdAllOpen] = useState(false);
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
   * Escalation filter (#028). When set to a staff id, only rows
   * escalated to that staff member are shown. The special value
   * "__any__" shows all escalations regardless of assignee — useful
   * for "what's currently escalated overall" view.
   *
   * The URL param is the source of truth; staff can share filtered
   * views with each other ("here's everything with Brandon right
   * now") via the URL.
   */
  const filterEscalated = searchParams.get("escalated") ?? "";
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
      // Escalation filter — "__any__" matches any escalation, a staff
      // UUID matches only escalations to that staffer.
      if (filterEscalated === "__any__") {
        if (!e.escalatedToStaffId) return false;
      } else if (filterEscalated) {
        if (e.escalatedToStaffId !== filterEscalated) return false;
      }
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
        case "contact": {
          // Scrapeable-but-not-done first (asc): never -> attempted -> no
          // website -> has email. Floats the actionable rows to the top.
          const rank = (e: ColdEntry): number => {
            if (e.venueEmail || e.hasScrapedEmail) return 3;
            if (!e.venueWebsite?.trim()) return 2;
            if (e.enrichmentAttempted) return 1;
            return 0;
          };
          cmp = rank(a) - rank(b);
          break;
        }
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
        case "engagement":
          // Higher engagement first even in asc (most-engaged is the
          // actionable top, like callWindow). Soft signal -- sort only.
          cmp = b.engagementScore - a.engagementScore;
          break;
      }
      // Stable secondary sort by venue name when primary ties
      if (cmp === 0) cmp = a.venueName.localeCompare(b.venueName);
      return cmp * dir;
    });

    return sorted;
  }, [
    entries,
    filterStatus,
    filterAssignee,
    filterZb,
    filterEscalated,
    sortKey,
    sortDir,
    showUnreachable,
  ]);

  // Count of unreachable rows currently hidden by the filter — used to
  // surface a "+ N unreachable" chip operators can click to reveal.
  const hiddenUnreachableCount = useMemo(() => {
    if (showUnreachable || filterStatus === "unreachable") return 0;
    return entries.filter((e) => e.status === "unreachable").length;
  }, [entries, showUnreachable, filterStatus]);

  const hasActiveFilter = !!(filterStatus || filterAssignee || filterZb || filterEscalated);

  function clearAllFilters() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("status");
    sp.delete("assignee");
    sp.delete("zb");
    sp.delete("escalated");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Page-scoped keyboard shortcuts. Press '?' to see them all.
  //
  // Best-in-class table navigation: J/K moves an "active row" cursor
  // up/down, Space toggles selection on that row, E opens the most
  // common edit (status menu — operator's hottest action), A
  // archives, X clears selection. Operator builds muscle memory in
  // a week and stops needing the mouse for the cold-outreach hot
  // path.
  //
  // activeRowIndex stays in sync with the `displayed` array. -1
  // means "no active row" (initial state). J on -1 jumps to row 0;
  // K on -1 jumps to the last row. Both wrap at the ends.
  const [activeRowIndex, setActiveRowIndex] = useState(-1);
  // Column tabs (operator request 2026-06-10): "Main" hides Engage + Cadence
  // so Remarks gets the width; "Outreach" shows them. Venue stays sticky on
  // both. Applies to the desktop table (cards always show everything).
  const [columnTab, setColumnTab] = useState<"main" | "outreach">("main");
  const activeEntryId =
    activeRowIndex >= 0 && activeRowIndex < displayed.length
      ? displayed[activeRowIndex]?.entryId
      : null;

  // When `displayed` changes shape (filter / sort / search), keep
  // the cursor pointing at the same entry if it's still visible;
  // otherwise reset to 0. Avoids the cursor disappearing into the
  // void when the operator types a search.
  useEffect(() => {
    if (displayed.length === 0) {
      if (activeRowIndex !== -1) setActiveRowIndex(-1);
      return;
    }
    if (activeRowIndex === -1) return;
    // Same entry still in view at a possibly-different index?
    if (activeEntryId) {
      const newIndex = displayed.findIndex((e) => e.entryId === activeEntryId);
      if (newIndex !== -1 && newIndex !== activeRowIndex) {
        setActiveRowIndex(newIndex);
        return;
      }
      if (newIndex === -1) {
        setActiveRowIndex(0);
        return;
      }
    }
    // Out of bounds (display shrank)?
    if (activeRowIndex >= displayed.length) {
      setActiveRowIndex(Math.max(0, displayed.length - 1));
    }
  }, [displayed, activeRowIndex, activeEntryId]);

  // Scroll the active row into view when J/K moves the cursor. Uses
  // data-entry-id on each <tr> as the selector — the row component
  // tags itself.
  useEffect(() => {
    if (!activeEntryId) return;
    const el = document.querySelector<HTMLElement>(`tr[data-entry-id="${activeEntryId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeEntryId]);

  useShortcut({
    keys: "j",
    label: "Next row",
    group: "Cold outreach",
    handler: () => {
      if (displayed.length === 0) return;
      setActiveRowIndex((i) => (i + 1) % displayed.length);
    },
  });
  useShortcut({
    keys: "k",
    label: "Previous row",
    group: "Cold outreach",
    handler: () => {
      if (displayed.length === 0) return;
      setActiveRowIndex((i) => (i <= 0 ? displayed.length - 1 : i - 1));
    },
  });
  useShortcut({
    keys: "space",
    label: "Toggle selection on active row",
    group: "Cold outreach",
    handler: () => {
      if (!activeEntryId) return;
      toggleOne(activeEntryId);
    },
    enabled: !!activeEntryId,
  });
  useShortcut({
    keys: "a",
    label: "Archive active row",
    group: "Cold outreach",
    handler: () => {
      if (!activeEntryId) return;
      // Use the existing archive verb on the entry's row instance —
      // dispatched via a custom event so the per-row component can
      // run its own toast + optimistic update without us needing
      // to lift archive state up to the table.
      window.dispatchEvent(
        new CustomEvent("cold-outreach:archive", { detail: { entryId: activeEntryId } }),
      );
    },
    enabled: !!activeEntryId,
  });
  useShortcut({
    keys: "e",
    label: "Edit status on active row",
    group: "Cold outreach",
    handler: () => {
      if (!activeEntryId) return;
      window.dispatchEvent(
        new CustomEvent("cold-outreach:edit-status", { detail: { entryId: activeEntryId } }),
      );
    },
    enabled: !!activeEntryId,
  });

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

  // Empty-state behavior is mode-specific:
  // Sheets-style arrow-key cell-to-cell navigation. The hook attaches a
  // keydown listener to gridNavRef and moves focus between InlineCell
  // buttons that carry a data-grid-cell attribute (we pass gridRow +
  // gridCol on each editable cell below). Cells without grid coords
  // (StatusSelect, AssignedSelect, RemarksInput's textarea) are
  // unaffected — they participate in normal Tab order as before.
  //
  // MUST live ABOVE the empty-state early return below. Hooks must be
  // called in the same order every render — when the operator clicks
  // "Add venue manually" from the EmptyState, `adding` flips to true,
  // the early return is skipped, and any hooks declared after it would
  // suddenly start running. React then throws #310 (hooks-count
  // mismatch) and the page swaps to the global error boundary.
  const gridNavRef = useRef<HTMLElement>(null);
  useGridArrowNav(gridNavRef);

  //   - cold: full discovery EmptyState (CTAs to add venues / paste /
  //           AI suggest) — that's where outreach starts
  //   - warm: keep the section visible with a short hint. Operators
  //           reported "the warm table disappeared" when a city had no
  //           warm rows yet; an always-present table is the obvious
  //           place to move leads INTO.
  if (entries.length === 0 && !adding) {
    if (mode === "warm") {
      return (
        <section className="card-surface overflow-hidden ring-1 ring-emerald-500/30">
          <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-4 dark:border-zinc-800/40">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold text-lg tracking-tight">Warm leads</h2>
              <span className="font-mono text-[11px] text-zinc-500">0</span>
            </div>
          </header>
          <div className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No warm leads yet. In the cold-outreach table below, select venues that showed interest
            and choose{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Move to warm leads</span>{" "}
            -- or set a venue's status to Interested. They collect here.
          </div>
        </section>
      );
    }
    return <EmptyState onManualAdd={() => setAdding(true)} />;
  }

  const allSelected = selected.size > 0 && selected.size === displayed.length;
  const someSelected = selected.size > 0 && selected.size < displayed.length;

  return (
    <section
      ref={gridNavRef}
      className={cn(
        "card-surface overflow-hidden",
        // Warm-mode visual cue: subtle emerald ring on the section so
        // the operator can spot it without reading the title. Same
        // signal as the "all confirmed" green outline on the crawl
        // table — emerald reserved for "this is the queue of good
        // news."
        mode === "warm" && "ring-1 ring-emerald-500/30",
      )}
    >
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-4 dark:border-zinc-800/40">
        <div className="flex items-baseline gap-2">
          {mode === "warm" ? (
            <Flame className="h-4 w-4 text-emerald-500" />
          ) : (
            <Mail className="h-4 w-4 text-zinc-500" />
          )}
          <h2 className="font-semibold text-lg tracking-tight">
            {mode === "warm" ? "Warm leads" : "Cold outreach"}
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
            onClick={() => setColdAllOpen(true)}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-zinc-900 px-2.5 py-1 font-mono text-[10px] text-white uppercase tracking-[0.08em] transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            title={
              selected.size === 0
                ? "Select venues first, then Cold All sends them a T1 cold email"
                : `Cold-email ${selected.size} selected venue(s)`
            }
          >
            <Mail className="h-2.5 w-2.5" />
            Cold All{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
          {/* AI lead-score backfill (Haiku ROI #5). Renders for
              admins only and only when there are un-scored or stale
              entries. Chained backfill — operator clicks once,
              button loops up to 10 hops with live progress. */}
          <ScoreAllButton
            cityCampaignId={cityCampaignId}
            isAdmin={currentStaffIsAdmin}
            unscoredCount={
              entries.filter((e) => e.aiLeadScore === null || e.aiLeadScoreAt === null).length
            }
          />
          {/* Bulk contact enrichment (E6) — scrapes eligible venues in the
              current filtered view; preview + live progress in a modal. */}
          <BulkEnrichButton venueIds={displayed.map((e) => e.venueId)} />
          <p className="hidden font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] sm:block dark:text-zinc-400">
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
          mode={mode}
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
        filterEscalated={filterEscalated}
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
      <div className="hidden md:block">
        <div className="flex items-center gap-1 border-zinc-200/60 border-b px-3 py-1.5 dark:border-zinc-800/40">
          {(["main", "outreach"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setColumnTab(t)}
              className={`rounded-full px-3 py-1 font-medium text-xs transition-colors ${
                columnTab === t
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t === "main" ? "Main" : "Outreach"}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          {/* min-width: below this the columns crush inline-edit fields into
            slivers -- prefer a deliberate horizontal scroll. */}
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40 dark:text-zinc-400">
                {/* Checkbox + per-row actions stack — row actions
                  (history, escalate, archive) live underneath the
                  checkbox on hover so the right side of the row can
                  give all its width to Remarks. */}
                <th className="w-10 px-2 py-2.5">
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
                  width="w-40 px-2"
                />
                {columnTab === "main" && (
                  <>
                    <SortableTh
                      label="Email"
                      col="email"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={() => toggleSort("email")}
                      width="w-36 px-1"
                    />
                    {/* Contact-enrichment status dot (E6). Sortable; click the
                  dot in a row to scrape that one venue inline. */}
                    <th className="w-10 px-1 py-2.5" title="Contact enrichment status">
                      <button
                        type="button"
                        onClick={() => toggleSort("contact")}
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em]"
                        title="Contact enrichment status — click a dot to scrape that venue"
                        aria-label="Sort by contact enrichment status"
                      >
                        ✉?
                      </button>
                    </th>
                    {/* ZB — abbreviated from "ZeroBounce" so the column can
                  shrink to icon-width. Cell renders a green check
                  (valid), red X (invalid family), or amber/grey
                  marker for catch_all / unknown; tooltips spell out
                  the underlying status. */}
                    <th className="w-10 px-1 py-2.5" title="ZeroBounce email validation">
                      <button
                        type="button"
                        onClick={() => toggleSort("zb")}
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em]"
                        title="ZeroBounce email validation"
                        aria-label="Sort by ZeroBounce email validation"
                      >
                        ZB
                      </button>
                    </th>
                    <SortableTh
                      label="Phone"
                      col="callWindow"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={() => toggleSort("callWindow")}
                      width="w-24 px-2"
                    />
                    <SortableTh
                      label="Status"
                      col="status"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={() => toggleSort("status")}
                      width="w-24 px-2"
                    />
                  </>
                )}
                {columnTab === "outreach" && (
                  <>
                    {/* Engagement (Tier-2). Soft 0-100 signal; sortable so
                  genuinely-interested venues rise. */}
                    <SortableTh
                      label="Engage"
                      col="engagement"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={() => toggleSort("engagement")}
                      width="w-16 px-2"
                    />
                    {/* Cadence-aware row state (Phase 2.12). Read-only column. */}
                    {/* Tightened (w-44 -> w-36) so Remarks -- the flex column --
                  gets the freed width (operator request: wider notes). */}
                    <th className="w-36 px-2 py-2.5">Cadence</th>
                  </>
                )}
                {columnTab === "main" && (
                  <>
                    <SortableTh
                      label="Assigned"
                      col="assignee"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={() => toggleSort("assignee")}
                      width="w-28 px-2"
                    />
                    <th className="px-2 py-2.5">Remarks</th>
                  </>
                )}
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
                  rowIndex={i}
                  layout="table"
                  mode={mode}
                  columnTab={columnTab}
                  escalationTargets={escalationTargets}
                  crawlsForPromote={crawlsForPromote}
                  isActive={i === activeRowIndex}
                />
              ))}
            </tbody>
          </table>
        </div>
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
                mode={mode}
                escalationTargets={escalationTargets}
                crawlsForPromote={crawlsForPromote}
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
      </footer>

      <AiSuggestVenuesModal
        cityCampaignId={cityCampaignId}
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onAdded={() => router.refresh()}
        googleMapsApiKey={googleMapsApiKey}
      />

      <ColdAllModal
        open={coldAllOpen}
        onClose={() => setColdAllOpen(false)}
        entryIds={Array.from(selected)}
        cityCampaignId={cityCampaignId}
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

/** Compact engagement band chip for the cold table (Tier-2). Display only. */
function EngagementChip({
  band,
  score,
}: {
  band: ColdEntry["engagementBand"];
  score: number;
}) {
  const map: Record<ColdEntry["engagementBand"], { label: string; className: string }> = {
    hot: {
      label: "Hot",
      className: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
    },
    engaged: {
      label: "Engaged",
      className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    warming: {
      label: "Warming",
      className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    },
    dead: {
      label: "—",
      className: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
    },
    cold: {
      label: "—",
      className: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
    },
  };
  const m = map[band];
  return (
    <span
      title={`Engagement ${score}/100 (${band})`}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-medium text-[10px] ${m.className}`}
    >
      {m.label}
    </span>
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
  rowIndex,
  layout,
  mode,
  escalationTargets,
  crawlsForPromote,
  isActive = false,
  columnTab = "main",
}: {
  entry: ColdEntry;
  staff: Array<{ id: string; displayName: string }>;
  cityCampaignId: string;
  outreachBrandId: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  zebra: boolean;
  /**
   * Position in the displayed list — feeds the gridRow coord on each
   * editable InlineCell so the table-level arrow-nav can compute
   * adjacent cells. Optional because the mobile card layout doesn't
   * use the grid (each card is independent; arrow-nav within a single
   * card adds confusion, so we leave it off there).
   */
  rowIndex?: number;
  layout: "table" | "card";
  /** Cold vs warm table -- drives the promote button's warm-first chooser. */
  mode: "cold" | "warm";
  /** Desktop column tab: "main" hides Engage+Cadence, "outreach" shows only
   *  them (venue stays sticky on both). Cards ignore this. */
  columnTab?: "main" | "outreach";
  /** Escalation targets list — passed through to the popover. */
  escalationTargets: Array<{
    id: string;
    displayName: string;
    role: string;
    primaryEmail: string;
  }>;
  /** Crawls in this city_campaign for the per-row Promote picker.
   *  Available in both cold + warm modes (per operator: "From cold
   *  outreach you should be able to also instantly assign to a
   *  crawl"). */
  crawlsForPromote?: Array<{
    eventId: string;
    dayPart:
      | "thursday_night"
      | "friday_night"
      | "saturday_day"
      | "saturday_night"
      | "sunday_day"
      | "sunday_night";
    crawlNumber: number;
    middleVenueGroupId: string | null;
    filledSlots: Array<{
      role: "wristband" | "middle" | "final" | "alt_final";
      slotPosition: number;
      venueName: string | null;
    }>;
  }>;
  /**
   * True when this row is the J/K-active cursor target. Drives a
   * subtle left border + slight bg tint so the operator can see
   * which row their next E / A / Space shortcut will affect.
   * Distinct from `selected` (multi-select checkbox state).
   */
  isActive?: boolean;
}) {
  const [pending, startTx] = useTransition();
  const [escalationOpen, setEscalationOpen] = useState(false);
  // Anchor + open state for the "Escalated to X" pill click-through
  // that lets the operator view notes + un-escalate.
  const [escalationStatusAnchor, setEscalationStatusAnchor] = useState<DOMRect | null>(null);
  // Smart-remark follow-up suggestion. Set when a remark commit
  // detects a future-dated time phrase; cleared on schedule/dismiss.
  const [followUp, setFollowUp] = useState<{
    dueAtIso: string;
    label: string;
    matchedText: string;
  } | null>(null);
  const toast = useToast();
  const router = useRouter();
  const tone = zebra ? "bg-zinc-50/60 dark:bg-zinc-900/30" : "bg-white dark:bg-zinc-900/10";

  // Listen for the table-level keyboard shortcuts (A = archive, E =
  // edit status) targeting THIS row's entryId. The parent table
  // dispatches custom events keyed by entryId so per-row state
  // (status menu open, archive transition) stays local to the row
  // — no need to lift it.
  useEffect(() => {
    function handleArchive(e: Event) {
      if (!isActive) return;
      const detail = (e as CustomEvent<{ entryId: string }>).detail;
      if (detail?.entryId !== entry.entryId) return;
      archive();
    }
    function handleEdit(e: Event) {
      if (!isActive) return;
      const detail = (e as CustomEvent<{ entryId: string }>).detail;
      if (detail?.entryId !== entry.entryId) return;
      // Native <select> can't be opened via .click() in any browser.
      // Modern Chromium / Safari Tech Preview support showPicker();
      // everywhere else we fall back to focus(), which lights up the
      // select so the operator can arrow-key or type-to-filter to
      // change status. Falls back gracefully when the cell isn't
      // mounted (mobile card layout, scrolled out of view).
      const el = document.querySelector<HTMLSelectElement>(
        `[data-status-trigger="${entry.entryId}"]`,
      );
      if (!el) return;
      el.focus();
      const withPicker = el as HTMLSelectElement & { showPicker?: () => void };
      if (typeof withPicker.showPicker === "function") {
        try {
          withPicker.showPicker();
        } catch {
          // showPicker can throw if not user-activated — focus is
          // the consolation prize and is enough for the operator
          // to arrow-key through options.
        }
      }
    }
    window.addEventListener("cold-outreach:archive", handleArchive as EventListener);
    window.addEventListener("cold-outreach:edit-status", handleEdit as EventListener);
    return () => {
      window.removeEventListener("cold-outreach:archive", handleArchive as EventListener);
      window.removeEventListener("cold-outreach:edit-status", handleEdit as EventListener);
    };
    // archive is stable enough — only re-bind when active or entry changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, entry.entryId]);

  // ---------------------------------------------------------------
  // Optimistic state — instant visual update while the server
  // roundtrip happens. Best-in-class apps flip the value at click
  // time and roll back on server error. Pre-this-commit the cell
  // waited for router.refresh before showing the new value, which
  // felt sluggish on slow networks. Three fields can be edited
  // (status, assignedStaffId, remarks); only status + assignment
  // benefit from optimism — remarks have their own freeform editor
  // with its own pending state.
  // ---------------------------------------------------------------
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const [optimisticAssigned, setOptimisticAssigned] = useState<string | null>(null);

  // The "resolved" value for render: optimistic if set, else server.
  const displayStatus = optimisticStatus ?? entry.status;
  const displayAssigned = optimisticAssigned ?? entry.assignedStaffId ?? "";

  // Clear optimistic overlay when server value catches up.
  useEffect(() => {
    if (optimisticStatus !== null && entry.status === optimisticStatus) {
      setOptimisticStatus(null);
    }
  }, [entry.status, optimisticStatus]);
  useEffect(() => {
    if (optimisticAssigned !== null && (entry.assignedStaffId ?? "") === optimisticAssigned) {
      setOptimisticAssigned(null);
    }
  }, [entry.assignedStaffId, optimisticAssigned]);

  function commitField(field: "status" | "assignedStaffId" | "remarks", value: string) {
    // Capture prior value so the undo handler can restore it
    const prior =
      field === "status"
        ? entry.status
        : field === "assignedStaffId"
          ? (entry.assignedStaffId ?? "")
          : (entry.remarks ?? "");

    // Optimistic overlay — UI flips immediately. Cleared on server
    // confirm (via the useEffect above) or rolled back on server
    // error (below).
    if (field === "status") setOptimisticStatus(value);
    else if (field === "assignedStaffId") setOptimisticAssigned(value);

    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("field", field);
    fd.set("value", value);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await updateColdOutreachField(null, fd);
      if (!result.ok) {
        // Roll back optimistic overlay — the server rejected.
        if (field === "status") setOptimisticStatus(null);
        else if (field === "assignedStaffId") setOptimisticAssigned(null);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't save.",
        });
        return;
      }

      // Smart follow-up: if the remark contained a future-dated time
      // phrase, the action returns a suggestion. Stash it so the
      // RemarksInput renders a "Schedule follow-up" chip.
      if (field === "remarks") {
        setFollowUp(result.ok && result.data ? (result.data.followUp ?? null) : null);
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

  // Click handler for the "Schedule follow-up" chip. Turns the
  // detected remark date into a real task + bumps status.
  function scheduleFollowUp() {
    if (!followUp) return;
    const captured = followUp;
    startTx(async () => {
      const result = await createFollowUpFromRemark({
        entryId: entry.entryId,
        dueAtIso: captured.dueAtIso,
        note: entry.remarks ?? undefined,
      });
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't schedule.",
          code: result.code,
        });
        return;
      }
      setFollowUp(null);
      toast.show({
        kind: "success",
        message: `Follow-up scheduled · ${captured.label}`,
      });
      router.refresh();
    });
  }

  function archive() {
    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await archiveColdOutreachEntry(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't archive.",
          code: result.code,
        });
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
      <>
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
                  current={displayStatus}
                  pending={pending}
                  onChange={(v) => commitField("status", v)}
                  entryId={entry.entryId}
                />
                {/* AI lead score chip (Haiku ROI #5). Shows score
                    0-100 + tooltip reason; tone scales with score. */}
                <LeadScoreChip score={entry.aiLeadScore} reason={entry.aiLeadScoreReason} />
                {/* Rot chip (CRM plan C2): an ACTIVE outreach row untouched
                    too long shows its age in place — same thresholds as the
                    aging watchdog (warn 7d / late 10d). Terminal + not-yet-
                    started rows stay quiet. */}
                {entry.lastTouchAt &&
                  ["email_sent", "follow_up_due", "called", "voicemail", "no_answer"].includes(
                    displayStatus,
                  ) && (
                    <RotChip
                      kind="cold_outreach"
                      ageHours={(Date.now() - new Date(entry.lastTouchAt).getTime()) / 3_600_000}
                    />
                  )}
                <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
                  ·
                </span>
                <AssignedSelect
                  current={displayAssigned}
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
            <ContactDot
              venueId={entry.venueId}
              venueEmail={entry.venueEmail}
              hasScrapedEmail={entry.hasScrapedEmail}
              venueWebsite={entry.venueWebsite}
              enrichmentAttempted={entry.enrichmentAttempted}
            />
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
            <VenueEmailsButton
              venueId={entry.venueId}
              cityCampaignId={cityCampaignId}
              email={entry.venueEmail}
              alternateEmails={entry.venueAlternateEmails}
            />
            {/* Direct-email compose icon -- ALWAYS shown so the operator can
                email any row in one click (prefilled with the stored address
                when there is one; otherwise an empty To they fill in). */}
            <ComposeEmailButton
              defaultTo={[entry.venueEmail, ...entry.venueAlternateEmails]
                .filter((e): e is string => Boolean(e?.trim()))
                .join(", ")}
              venueId={entry.venueId}
              cityCampaignId={cityCampaignId}
              ariaLabel={
                entry.venueEmail ? `Compose email to ${entry.venueEmail}` : "Compose email"
              }
              className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Mail className="h-3.5 w-3.5" />
            </ComposeEmailButton>
            {entry.venueEmail && (
              <AiDraftButton
                venueId={entry.venueId}
                venueName={entry.venueName}
                cityCampaignId={cityCampaignId}
                onUseDraft={(draft) => {
                  // Open the in-app composer instead of mailto. The
                  // AiDraftButton can't render the modal itself
                  // (its child is a button), so we surface the draft
                  // through window event the composer listens for.
                  window.dispatchEvent(
                    new CustomEvent("compose-email", {
                      detail: {
                        to: [entry.venueEmail, ...entry.venueAlternateEmails]
                          .filter((e): e is string => Boolean(e?.trim()))
                          .join(", "),
                        subject: draft.subject,
                        body: draft.body,
                        venueId: entry.venueId,
                        cityCampaignId,
                      },
                    }),
                  );
                }}
              />
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
              followUp={followUp}
              onSchedule={scheduleFollowUp}
              onDismissFollowUp={() => setFollowUp(null)}
            />
          </div>

          {/* History + Archive + Promote (both cold + warm modes —
              per operator: "From cold outreach you should be able to
              also instantly assign to a crawl not just move to warm
              leads") */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ActivityHistoryButton
                table="cold_outreach_entries"
                recordId={entry.entryId}
                alsoTable="venues"
                alsoRecordId={entry.venueId}
                compact
              />
              {crawlsForPromote && crawlsForPromote.length > 0 && (
                <WarmLeadPromoteButton
                  venueId={entry.venueId}
                  venueName={entry.venueName}
                  cityCampaignId={cityCampaignId}
                  crawls={crawlsForPromote}
                  entryId={entry.entryId}
                  mode={mode}
                />
              )}
            </div>
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
        {/* EscalationPopover renders OUTSIDE the article via fragment so
            its full-screen backdrop overlays the entire viewport rather
            than being constrained to the card. */}
        {escalationOpen && (
          <EscalationPopover
            entryId={entry.entryId}
            venueName={entry.venueName}
            initialNotes={entry.remarks ?? ""}
            targets={escalationTargets}
            onClose={() => setEscalationOpen(false)}
            onEscalated={() => router.refresh()}
          />
        )}
      </>
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
        // Active-row cursor (J/K shortcut target). Quiet inset-left
        // accent line + slight tint so it's findable without
        // shouting. Operator builds muscle memory + then sees the
        // cursor only when they're actually using shortcuts.
        isActive &&
          "bg-violet-500/[0.04] shadow-[inset_2px_0_0_theme(colors.violet.500)] dark:bg-violet-400/[0.05] dark:shadow-[inset_2px_0_0_theme(colors.violet.400)]",
      )}
      data-entry-id={entry.entryId}
    >
      {/* Checkbox + per-row actions (history, escalate, archive) —
          stacked vertically so the right side of the row reclaims
          its width for Remarks. Actions stay hidden until the row
          is hovered, keeping the resting state calm. */}
      <td className="w-10 px-2 py-2 align-middle">
        <div className="flex flex-col items-center gap-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
            aria-label={`Select ${entry.venueName}`}
          />
          <div className="flex flex-col items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {/* Promote-to-crawl available in BOTH cold and warm
                modes. In warm it's the primary verb (operator
                committing an interested venue to a slot). In cold
                it's instant assign — per operator "From cold
                outreach you should be able to also instantly
                assign to a crawl not just move to warm leads".
                Reuses the same WarmLeadPromoteButton popover with
                the two-step crawl + slot picker. */}
            {crawlsForPromote && crawlsForPromote.length > 0 && (
              <WarmLeadPromoteButton
                venueId={entry.venueId}
                venueName={entry.venueName}
                cityCampaignId={cityCampaignId}
                crawls={crawlsForPromote}
                entryId={entry.entryId}
                mode={mode}
              />
            )}
            <ActivityHistoryButton
              table="cold_outreach_entries"
              recordId={entry.entryId}
              alsoTable="venues"
              alsoRecordId={entry.venueId}
              compact
            />
            {!entry.escalatedToName && (
              <button
                type="button"
                onClick={() => setEscalationOpen(true)}
                disabled={pending}
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
                aria-label="Escalate to senior staff"
                title="Escalate to senior staff"
              >
                <AlertTriangle className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={archive}
              disabled={pending}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
              aria-label="Archive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </td>

      {/* Venue — inline-editable name. Operators can rename right from
          the table; the static link to /venues/[id] moves to a small
          arrow that appears on hover so quick edits don't require
          navigating away. Venue name is allowed to wrap so the column
          can stay narrow — long names break across two lines instead
          of stretching the table. */}
      <td className="w-40 px-2 py-2 align-middle">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <InlineCell
              label="Venue name"
              value={entry.venueName}
              variant="default"
              maxWidth={160}
              gridRow={rowIndex}
              gridCol={0}
              onCommit={editVenueField("name")}
              allowWrap
            />
          </div>
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

      {columnTab === "main" && (
        <>
          {/* Email — inline-editable address + AI draft button + mailto link.
          Padding tightened (px-1) so the venue/email pair takes less
          column real estate and Remarks gets more room. */}
          <td className="relative w-36 px-1 py-2 align-middle">
            <div className="flex items-start gap-0.5">
              <div className="min-w-0 flex-1">
                <InlineCell
                  label="Venue email"
                  value={entry.venueEmail ?? ""}
                  placeholder="add email"
                  variant="mono"
                  inputType="email"
                  maxWidth={150}
                  gridRow={rowIndex}
                  gridCol={1}
                  onCommit={editVenueField("email")}
                />
              </div>
              <VenueEmailsButton
                venueId={entry.venueId}
                cityCampaignId={cityCampaignId}
                email={entry.venueEmail}
                alternateEmails={entry.venueAlternateEmails}
              />
              {/* Direct-email compose icon -- ALWAYS visible (was hover-only) so
              every row offers a one-click email. */}
              <ComposeEmailButton
                defaultTo={[entry.venueEmail, ...entry.venueAlternateEmails]
                  .filter((e): e is string => Boolean(e?.trim()))
                  .join(", ")}
                venueId={entry.venueId}
                cityCampaignId={cityCampaignId}
                ariaLabel={
                  entry.venueEmail ? `Compose email to ${entry.venueEmail}` : "Compose email"
                }
                className="rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                <Mail className="h-3 w-3" />
              </ComposeEmailButton>
              {entry.venueEmail && (
                <AiDraftButton
                  venueId={entry.venueId}
                  venueName={entry.venueName}
                  cityCampaignId={cityCampaignId}
                  onUseDraft={(draft) => {
                    window.dispatchEvent(
                      new CustomEvent("compose-email", {
                        detail: {
                          to: [entry.venueEmail, ...entry.venueAlternateEmails]
                            .filter((e): e is string => Boolean(e?.trim()))
                            .join(", "),
                          subject: draft.subject,
                          body: draft.body,
                          venueId: entry.venueId,
                          cityCampaignId,
                        },
                      }),
                    );
                  }}
                />
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

          {/* Contact enrichment dot (E6). Click to scrape this venue inline. */}
          <td className="w-10 px-1 py-2 text-center align-middle">
            <ContactDot
              venueId={entry.venueId}
              venueEmail={entry.venueEmail}
              hasScrapedEmail={entry.hasScrapedEmail}
              venueWebsite={entry.venueWebsite}
              enrichmentAttempted={entry.enrichmentAttempted}
            />
          </td>

          {/* ZB — compact icon-only column. Green check = valid, red X =
          invalid family (invalid / spamtrap / abuse / do_not_mail),
          amber dot = catch_all / unknown, neutral dash = unchecked.
          Hover tooltip reveals the underlying ZeroBounce status name. */}
          <td className="w-10 px-1 py-2 text-center align-middle">
            <ZbIcon status={entry.zeroBounceStatus} />
          </td>

          {/* Phone — when present, QuoDialControls handles click-to-call
          (SMS and Viber were removed 2026-06-10/11; neither works with
          Quo). When absent or being edited, an inline cell lets the
          operator add or change the number. */}
          <td className="relative px-2 py-2 align-middle">
            <PhoneCell
              entry={entry}
              cityCampaignId={cityCampaignId}
              outreachBrandId={outreachBrandId}
              editVenueField={editVenueField}
              rowIndex={rowIndex}
            />
          </td>

          {/* Status */}
          <td className="px-2 py-2 align-middle">
            <StatusSelect
              current={displayStatus}
              pending={pending}
              onChange={(v) => commitField("status", v)}
              entryId={entry.entryId}
            />
          </td>
        </>
      )}

      {columnTab === "outreach" && (
        <>
          {/* Engagement (Tier-2 soft signal). */}
          <td className="px-2 py-2 align-middle">
            <EngagementChip band={entry.engagementBand} score={entry.engagementScore} />
          </td>

          {/* Cadence (Phase 2.12) + cross-domain handoff on exhausted rows (2.14). */}
          <td className="w-44 px-2 py-2 align-middle text-[11px] text-zinc-600 leading-snug dark:text-zinc-400">
            <div
              className={cn(
                // Urgency emphasis (refdoc 6.1): a due/overdue touch must pop
                // out of the column instead of reading like every other row.
                entry.cadenceLabel.includes("overdue") &&
                  "font-medium text-rose-600 dark:text-rose-400",
                entry.cadenceLabel.includes("due today") &&
                  "font-medium text-amber-600 dark:text-amber-400",
              )}
            >
              {entry.cadenceLabel}
            </div>
            {/* Touch budget vs the campaign hard cap (refdoc 6.3) — visible
                BEFORE a surprise exhaustion. Amber from 4, rose at the cap. */}
            {entry.touchCount > 0 && (
              <span
                className={cn(
                  "mt-0.5 inline-flex rounded-full px-1.5 py-px font-mono text-[9px] tabular-nums ring-1 ring-inset",
                  entry.touchCount >= entry.touchCap
                    ? "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300"
                    : entry.touchCount >= entry.touchCap - 2
                      ? "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300"
                      : "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20 dark:text-zinc-400",
                )}
                title={`${entry.touchCount} of ${entry.touchCap} campaign touches used (anti-spam hard cap)`}
              >
                {entry.touchCount}/{entry.touchCap} touches
              </span>
            )}
            {entry.approachingHandoff && !entry.readyForHandoff && (
              <p
                className="mt-0.5 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.06em]"
                title="Closer sent. If the venue stays silent, this row unlocks a cross-domain handoff to a fresh brand."
              >
                final touch sent · handoff next
              </p>
            )}
            {entry.readyForHandoff && (
              <HandoffButton
                entryId={entry.entryId}
                venueId={entry.venueId}
                venueName={entry.venueName}
                venueEmail={entry.venueEmail}
                cityCampaignId={cityCampaignId}
              />
            )}
          </td>
        </>
      )}

      {columnTab === "main" && (
        <>
          {/* Assigned */}
          <td className="px-2 py-2 align-middle">
            <AssignedSelect
              current={displayAssigned}
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
              followUp={followUp}
              onSchedule={scheduleFollowUp}
              onDismissFollowUp={() => setFollowUp(null)}
            />
            {/* Escalation pill — renders only when this entry IS currently
            escalated. Surfaces "with X since DATE" so every staffer can
            see what's parked with whom. Click to view notes + un-escalate. */}
            {entry.escalatedToName && (
              <button
                type="button"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setEscalationStatusAnchor(r);
                }}
                className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/[0.10] px-2 py-0.5 font-mono text-[9px] text-amber-700 uppercase tracking-[0.08em] ring-1 ring-amber-500/30 ring-inset hover:bg-amber-500/[0.18] dark:text-amber-300"
                title={entry.escalationNotes ?? undefined}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Escalated to {entry.escalatedToName}
              </button>
            )}
            {escalationStatusAnchor && entry.escalatedToName && (
              <EscalationStatusPopover
                entryId={entry.entryId}
                escalatedToName={entry.escalatedToName}
                escalatedAt={entry.escalatedAt}
                escalationNotes={entry.escalationNotes}
                anchorRect={escalationStatusAnchor}
                onClose={() => setEscalationStatusAnchor(null)}
                onCleared={() => router.refresh()}
              />
            )}
            {/* EscalationPopover renders via createPortal so it can stay
            in the row's DOM tree (here, attached to the Remarks <td>)
            while visually landing at document.body — no tbody>tr>td
            hierarchy violation. The trailing actions column was
            removed and those affordances moved under the checkbox
            cell on the left so Remarks can take the full remaining
            width. */}
            {escalationOpen && (
              <EscalationPopover
                entryId={entry.entryId}
                venueName={entry.venueName}
                initialNotes={entry.remarks ?? ""}
                targets={escalationTargets}
                onClose={() => setEscalationOpen(false)}
                onEscalated={() => router.refresh()}
              />
            )}
          </td>
        </>
      )}
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
  rowIndex,
}: {
  entry: ColdEntry;
  cityCampaignId: string;
  outreachBrandId: string | null;
  editVenueField: (
    field: "name" | "email" | "phoneE164",
  ) => (next: string) => Promise<{ ok: boolean; error?: string }>;
  /** Forward to the inner InlineCell for grid arrow-nav (col=2). */
  rowIndex?: number;
}) {
  const phoneCommit = editVenueField("phoneE164");

  // No number yet → inline-edit mode so adding a phone is a single
  // interaction. The pencil-to-re-edit affordance was removed at the
  // operator's request (it lived in this cluster and looked like it
  // applied to the action icons instead of the phone number).
  if (!entry.venuePhone) {
    return (
      <InlineCell
        label="Venue phone"
        value=""
        placeholder="add phone"
        variant="mono"
        inputType="tel"
        maxWidth={140}
        gridRow={rowIndex}
        gridCol={2}
        onCommit={phoneCommit}
      />
    );
  }

  // Number present → phone number on its own line (one-line, dynamic
  // font size so international formats don't wrap or get truncated)
  // with the action icons stacked beneath it. The previous layout put
  // everything in a wide row, which was cramped and let long phone
  // numbers wrap.
  //
  // Per operator request the pencil-edit affordance was removed from
  // this cluster — to change a phone number, use the venue's detail
  // page (or clear the field via the InlineCell when it's empty). Only
  // the dial icon remains (SMS + Viber removed 2026-06-10/11).
  const phoneText = entry.venuePhone ?? "";
  const phoneFontClass =
    phoneText.length >= 16
      ? "text-[9px]"
      : phoneText.length >= 14
        ? "text-[10px]"
        : phoneText.length >= 12
          ? "text-[11px]"
          : "text-xs";
  return (
    <div className="flex flex-col items-start gap-0.5">
      {/* Phone number — always one line; font scales by length so
          long international numbers still fit. Click dials. */}
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
        layout="stacked"
        phoneFontClass={phoneFontClass}
      />
      <div className="flex items-center gap-1">
        <CallAttemptBadge count={entry.callAttempts} />
        <CallWindowHint
          venueHours={entry.venueHours}
          venueType={entry.venueType}
          venueTimezone={entry.venueTimezone}
        />
      </div>
    </div>
  );
}

function StatusSelect({
  current,
  pending,
  onChange,
  entryId,
}: {
  current: string;
  pending: boolean;
  onChange: (v: string) => void;
  /** Used as data-status-trigger so the table's E shortcut can find
   *  this select and `.focus() + .click()` to drop the dropdown. */
  entryId?: string;
}) {
  const opt = STATUS_OPTIONS.find((o) => o.value === current);
  return (
    <div className="group/cell relative">
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        data-status-trigger={entryId}
        className={cn(
          "w-full appearance-none rounded-md border border-transparent bg-transparent py-1 pr-5 pl-2 font-medium font-mono text-[9px] uppercase tracking-[0.05em] transition-colors",
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
      <ChevronDown
        aria-hidden="true"
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 h-2.5 w-2.5 text-zinc-400/60 transition-opacity duration-150 group-hover/cell:text-zinc-500 dark:text-zinc-500/60 dark:group-hover/cell:text-zinc-400"
      />
    </div>
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
    <div className="group/cell relative">
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className={cn(
          "w-full appearance-none rounded-md border border-transparent bg-transparent py-1 pr-5 pl-2 text-xs transition-colors",
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
      <ChevronDown
        aria-hidden="true"
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 h-2.5 w-2.5 text-zinc-400/60 transition-opacity duration-150 group-hover/cell:text-zinc-500 dark:text-zinc-500/60 dark:group-hover/cell:text-zinc-400"
      />
    </div>
  );
}

function RemarksInput({
  initial,
  pending,
  onCommit,
  draftKey,
  followUp,
  onSchedule,
  onDismissFollowUp,
}: {
  initial: string;
  pending: boolean;
  onCommit: (v: string) => void;
  /** Stable key for localStorage persistence. Pass to enable
      'never lose what I typed' behavior. */
  draftKey?: string;
  /** Smart follow-up suggestion detected on the last remark commit. */
  followUp?: { dueAtIso: string; label: string; matchedText: string } | null;
  /** Create the follow-up task from the suggestion. */
  onSchedule?: () => void;
  /** Dismiss the suggestion chip without scheduling. */
  onDismissFollowUp?: () => void;
}) {
  const [committed, setCommitted] = useState(initial);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Auto-grow the textarea to fit its content so the full remark is
  // always visible (operator session-12: "remarks can't be cut off,
  // we need to see the whole remark"). Reset height to auto first so
  // it can shrink when text is deleted, then grow to scrollHeight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on draft change to resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

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
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter commits (Sheets-like); Shift+Enter inserts a newline
          // for multi-line remarks.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(committed);
            clearDraft();
            e.currentTarget.blur();
          }
        }}
        disabled={pending}
        rows={1}
        placeholder={recovered ? "Restored draft — Enter to save" : "Add remarks…"}
        className={cn(
          "block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 pr-6 text-[11px] leading-snug transition-colors",
          "whitespace-pre-wrap break-words",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white focus:outline-none",
          "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
          "placeholder:text-zinc-400/60",
          recovered &&
            "border-amber-400/40 bg-amber-50/30 dark:border-amber-700/40 dark:bg-amber-950/20",
        )}
      />
      {(pending || saved) && (
        <div className="pointer-events-none absolute top-1.5 right-1.5">
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
          ) : (
            <Check className="h-3 w-3 text-emerald-500" />
          )}
        </div>
      )}

      {/* Smart follow-up chip — appears when a remark commit detected a
          future-dated time phrase. "Fantastical-style" quick-schedule.
          (operator session-12 ask) */}
      {followUp && (
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSchedule}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full bg-blue-500/[0.10] px-2 py-0.5 font-medium text-[10px] text-blue-700 ring-1 ring-blue-500/30 ring-inset transition-colors hover:bg-blue-500/[0.18] disabled:opacity-50 dark:text-blue-300"
            title={`Detected "${followUp.matchedText}" — create a follow-up task`}
          >
            <CalendarClock className="h-2.5 w-2.5" />
            Schedule follow-up: {followUp.label}
          </button>
          <button
            type="button"
            onClick={onDismissFollowUp}
            className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="Dismiss suggestion"
          >
            <X className="h-2.5 w-2.5" />
          </button>
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

function EmptyState({ onManualAdd }: { onManualAdd: () => void }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-8 text-center shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <Mail className="mx-auto h-6 w-6 text-zinc-400" />
      <h2 className="mt-3 font-semibold text-lg tracking-tight">No cold outreach yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-600 leading-relaxed dark:text-zinc-400">
        Add venues one at a time, paste rows from Sheets, or use the discovery map below to search
        bars / clubs / restaurants in this city and add them.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={onManualAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add venue manually
        </Button>
      </div>
    </section>
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
  mode,
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
  /** Cold vs warm — drives whether the Move button reads "Move to warm
   *  leads" (cold mode → sets status=interested) or "Move back to cold"
   *  (warm mode → sets status=not_contacted). */
  mode: "cold" | "warm";
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
        toast.show({
          kind: "error",
          message: result.error ?? "Status update failed.",
          code: result.code,
        });
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

  // Promote-to-warm / remove-from-warm — flips is_warm without
  // touching status. Per operator: a venue can be both warm AND
  // status='email_sent' (warm signal, still mid-funnel). Distinct
  // from setStatus which DOES change status.
  function setWarmFlag(isWarm: boolean) {
    startStatus(async () => {
      const result = await bulkSetWarmFlag({
        entryIds: selectedIds.join(","),
        isWarm,
        cityCampaignId,
      });
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't update warm flag.",
          code: result.code,
        });
        return;
      }
      const verb = isWarm ? "marked warm" : "moved back to cold-only";
      toast.show({
        kind: "success",
        message: `${result.data?.updated ?? 0} venue${result.data?.updated === 1 ? "" : "s"} ${verb}`,
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
        toast.show({
          kind: "error",
          message: result.error ?? "Assignment failed.",
          code: result.code,
        });
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
        toast.show({
          kind: "error",
          message: result.error ?? "Archive failed.",
          code: result.code,
        });
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

        {/* Move between cold ↔ warm queues — same button, flipped
            destination based on mode.
              - cold mode → "Move to warm leads": flips is_warm=true
                so the row appears in BOTH cold (mass outreach) and
                warm (interested) panels. Status is untouched.
              - warm mode → "Remove from warm leads": flips
                is_warm=false. Cold row stays in cold panel.
            Pre-0082 this changed status to/from 'interested' which
            yanked the row out of the cold view — operator wanted
            the cold row preserved. See bulkSetWarmFlag. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setWarmFlag(mode !== "warm")}
          disabled={busy}
          className={cn(
            mode === "warm"
              ? "text-zinc-600 hover:bg-zinc-500/10 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              : "text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
          )}
        >
          <Flame className="h-3 w-3" />
          {mode === "warm" ? "Remove from warm" : "Move to warm leads"}
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
  filterEscalated,
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
  /** Escalation filter — "", "__any__", or a staff UUID. */
  filterEscalated: string;
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

  // Per-assignee escalation buckets. Only includes staffers who
  // currently have at least one escalation parked with them, so the
  // chip strip stays quiet on city sheets where no one's escalated.
  // Sorted by count descending so the busiest escalation queue
  // surfaces first.
  const escalationBuckets = new Map<string, { name: string; count: number }>();
  for (const e of entries) {
    if (e.escalatedToStaffId && e.escalatedToName) {
      const existing = escalationBuckets.get(e.escalatedToStaffId);
      if (existing) existing.count += 1;
      else escalationBuckets.set(e.escalatedToStaffId, { name: e.escalatedToName, count: 1 });
    }
  }
  const escalationChips = Array.from(escalationBuckets.entries())
    .map(([id, { name, count }]) => ({ id, name, count }))
    .sort((a, b) => b.count - a.count);

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

      {/* Escalation filter chips — one per staffer with active escalations
          in this city sheet, sorted by count desc. The "Escalated to
          Brandon (3)" pattern from the operator's spec — gives every
          staffer visibility into what's parked with whom. Click toggles
          the filter; clicking the active chip clears it. The amber
          color matches the row's escalation pill so the visual link is
          immediate. */}
      {escalationChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {escalationChips.map((chip) => {
            const selected = filterEscalated === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onChange("escalated", selected ? null : chip.id)}
                title={`Show only entries escalated to ${chip.name}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset transition-colors",
                  selected
                    ? "bg-amber-500/[0.15] text-amber-800 ring-amber-500/40 dark:text-amber-200"
                    : "bg-amber-500/[0.06] text-amber-700 ring-amber-500/20 hover:bg-amber-500/[0.12] dark:text-amber-300",
                )}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Escalated to {chip.name}
                <span className="font-normal tabular-nums opacity-70">{chip.count}</span>
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
        <label
          htmlFor="cold-outreach-filter-assignee"
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
        >
          Assignee
        </label>
        <select
          id="cold-outreach-filter-assignee"
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
          <label
            htmlFor="cold-outreach-filter-zb"
            className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
          >
            Email
          </label>
          <select
            id="cold-outreach-filter-zb"
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
  // HOTFIX: the call-window suggestion depends on the current wall clock, which
  // differs between SSR (server UTC) and the client (operator's local tz).
  // Computing it during render produced different HTML server vs client -> React
  // #418 hydration bail on /city-campaigns/[id], which cascaded into a failed
  // lazy chunk load and the composer/templates not loading for 20-30s. Compute
  // it only AFTER mount so the first paint matches the server, then fill in.
  const [suggestion, setSuggestion] = useState<ReturnType<typeof suggestCallWindow> | null>(null);
  useEffect(() => {
    if (!venueHours && (!venueType || venueType.length === 0)) {
      setSuggestion(null);
      return;
    }
    const parsed = parseVenueHours(venueHours);
    setSuggestion(suggestCallWindow(parsed, new Date(), venueType, venueTimezone));
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

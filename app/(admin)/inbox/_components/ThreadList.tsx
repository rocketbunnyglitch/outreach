"use client";

import { cn } from "@/lib/cn";
import type { InboxThreadRow } from "@/lib/inbox-data";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Mail,
  PhoneCall,
  ShieldOff,
  Sparkles,
  UserX,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StarToggle } from "./StarToggle";
import { ThreadRowHoverActions } from "./ThreadRowHoverActions";

/**
 * Middle pane — the thread list. Rows are Gmail-shaped: checkbox /
 * star / sender / subject snippet / timestamp on the right. Below
 * the snippet is a single line of context chips (campaign, city,
 * day_part) so the operator sees the "why this matters" without
 * opening the thread.
 *
 * Optional selection model: when `selectedIds` + `onToggleSelect`
 * are provided, each row carries a checkbox that drives bulk-action
 * selection state. ThreadListWithBulk wraps this and provides those
 * props. The bare component (selectedIds undefined) still works for
 * read-only callers.
 */
export function ThreadList({
  threads,
  activeThreadId,
  folderLabel,
  preservedQuery,
  selectedIds,
  onToggleSelect,
  isTrashView,
}: {
  threads: InboxThreadRow[];
  activeThreadId: string | null;
  folderLabel: string;
  /**
   * Query string to preserve when navigating into a thread (so the
   * "mine only" + folder filters survive the click).
   */
  preservedQuery: string;
  /** Selection state from ThreadListWithBulk; omit for read-only mode. */
  selectedIds?: Set<string>;
  /** Per-row checkbox handler. Omit for read-only mode. */
  onToggleSelect?: (threadId: string) => void;
  /** Trash view shows Restore-style hover actions instead of Archive/Trash. */
  isTrashView?: boolean;
}) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500/80" />
        <h3 className="mt-3 font-semibold text-base tracking-tight">You're all caught up</h3>
        <p className="mt-1 max-w-xs text-sm text-zinc-500">
          Nothing in {folderLabel}. New mail and replies land here as they arrive.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {threads.map((t) => (
        <ThreadRow
          key={t.id}
          thread={t}
          isActive={t.id === activeThreadId}
          preservedQuery={preservedQuery}
          isSelected={selectedIds?.has(t.id) ?? false}
          onToggleSelect={onToggleSelect}
          isTrashView={isTrashView}
        />
      ))}
    </ul>
  );
}

const CLASSIFICATION_ICON: Record<string, React.ReactNode> = {
  interested: <CheckCircle2 className="h-3 w-3" />,
  warm: <CheckCircle2 className="h-3 w-3" />,
  confirmed: <CheckCircle2 className="h-3 w-3" />,
  question: <HelpCircle className="h-3 w-3" />,
  callback_requested: <PhoneCall className="h-3 w-3" />,
  decline: <XCircle className="h-3 w-3" />,
  unsubscribe: <ShieldOff className="h-3 w-3" />,
  auto_reply: <Sparkles className="h-3 w-3" />,
  spam: <ShieldOff className="h-3 w-3" />,
  unclassified: null,
};

const CLASSIFICATION_TONE: Record<string, string> = {
  interested: "text-emerald-500",
  warm: "text-orange-500",
  confirmed: "text-emerald-700 dark:text-emerald-300",
  question: "text-blue-500",
  callback_requested: "text-violet-500",
  decline: "text-rose-500",
  unsubscribe: "text-zinc-500",
  auto_reply: "text-zinc-500",
  spam: "text-zinc-500",
  unclassified: "text-zinc-400",
};

function ThreadRow({
  thread,
  isActive,
  preservedQuery,
  isSelected,
  onToggleSelect,
  isTrashView,
}: {
  thread: InboxThreadRow;
  isActive: boolean;
  preservedQuery: string;
  isSelected: boolean;
  onToggleSelect?: (threadId: string) => void;
  isTrashView?: boolean;
}) {
  const href = preservedQuery ? `/inbox/${thread.id}?${preservedQuery}` : `/inbox/${thread.id}`;

  // Optimistic read-state. Seeded false from a prop (hydration-safe: the
  // initializer reads only props, never storage/clock/window). When the
  // operator opens this thread, ThreadActions broadcasts an
  // "inbox-thread-read" event so the row un-bolds instantly, before the
  // server revalidate from markThreadRead lands. Listener is mount-gated.
  const [locallyRead, setLocallyRead] = useState(false);
  useEffect(() => {
    function onRead(e: Event) {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      if (detail?.threadId === thread.id) setLocallyRead(true);
    }
    document.addEventListener("inbox-thread-read", onRead);
    return () => document.removeEventListener("inbox-thread-read", onRead);
  }, [thread.id]);
  const isUnread = thread.unreadCount > 0 && !locallyRead;

  // Mount gate for the row timestamp. formatTime reads the wall clock
  // (relative buckets) + locale/timezone, which diverges between SSR and
  // client hydration -> #418 freeze. Render a deterministic UTC stamp
  // until mount, then the operator's local relative/short time.
  const [timeMounted, setTimeMounted] = useState(false);
  useEffect(() => setTimeMounted(true), []);

  return (
    <li>
      <Link
        href={href}
        className={cn(
          // Row padding is density-driven via .inbox-row in globals.css
          // (compact / default / comfortable). Keep horizontal padding here.
          "inbox-row group/row block border-zinc-200/60 border-b px-3 transition-colors",
          "dark:border-zinc-800/40",
          // Active (currently-open thread) > selection > unread > read.
          // Gmail conveys unread with a white (vs greyed) row + bold text +
          // a blue dot, not a colored left bar. Selection is blue (palette:
          // blue=info); indigo is not a reserved color.
          isActive
            ? "bg-zinc-100 dark:bg-zinc-900"
            : isSelected
              ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
              : isUnread
                ? "bg-white hover:bg-zinc-50 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
                : "bg-zinc-50/40 hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/40",
        )}
      >
        {/* Line 1: [checkbox + star gutter] [unread dot] sender ... timestamp/actions */}
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-1">
            {onToggleSelect && (
              // -m-1.5 padding gives a >=40px touch target on mobile without
              // enlarging the desktop glyph; sm:m-0 restores tight desktop.
              <label className="-m-1.5 flex cursor-pointer items-center p-1.5 sm:m-0 sm:p-0">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(thread.id)}
                  onClick={(e) => {
                    // preventDefault cancels the surrounding <Link> anchor's
                    // navigation (a click on a control nested in an <a href>
                    // still activates the anchor; stopPropagation alone does
                    // NOT cancel that). This is the select-all bug fix.
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label={`Select thread from ${thread.lastSenderName ?? thread.venueName ?? "unknown"}`}
                  className="h-4 w-4 shrink-0 cursor-pointer"
                />
              </label>
            )}
            <StarToggle threadId={thread.id} initialStarred={thread.isStarred} size="sm" />
          </div>
          {isUnread && (
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-blue-600 dark:bg-blue-500"
            />
          )}
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              isUnread
                ? "font-semibold text-zinc-900 dark:text-zinc-100"
                : "font-normal text-zinc-700 dark:text-zinc-300",
            )}
          >
            {thread.lastSenderName ?? thread.venueName ?? "Unassigned"}
          </p>
          {/* Fixed-width right gutter so the timestamp -> hover-actions swap
              doesn't shift line 1. */}
          <div className="flex shrink-0 justify-end" style={{ minWidth: "5.5rem" }}>
            <time
              dateTime={thread.lastMessageAt.toISOString()}
              suppressHydrationWarning
              className={cn(
                "block text-[11px] tabular-nums group-hover/row:hidden",
                isUnread ? "font-semibold text-zinc-700 dark:text-zinc-300" : "text-zinc-500",
              )}
            >
              {timeMounted
                ? formatTime(thread.lastMessageAt)
                : thread.lastMessageAt.toISOString().slice(11, 16)}
            </time>
            <ThreadRowHoverActions
              threadId={thread.id}
              snoozeUntil={thread.snoozeUntil}
              isTrashView={isTrashView}
            />
          </div>
        </div>

        {/* Line 2: subject + muted snippet on one truncating line (Gmail). */}
        {(thread.subject || thread.snippet) && (
          <p className="mt-0.5 truncate pl-7 text-xs leading-5">
            {thread.subject && (
              <span
                className={cn(
                  isUnread
                    ? "font-semibold text-zinc-800 dark:text-zinc-200"
                    : "text-zinc-600 dark:text-zinc-400",
                )}
              >
                {thread.subject}
              </span>
            )}
            {thread.subject && thread.snippet && <span className="text-zinc-400"> - </span>}
            {thread.snippet && <span className="text-zinc-500">{thread.snippet}</span>}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-7">
          {/* Classification chip */}
          {thread.classification !== "unclassified" && (
            <Chip
              tone={
                CLASSIFICATION_TONE[thread.classification] ?? "text-zinc-500 dark:text-zinc-400"
              }
              icon={CLASSIFICATION_ICON[thread.classification]}
            >
              {thread.classification.replace("_", " ")}
            </Chip>
          )}

          {/* Venue chip — only when matched to a venue AND the venue name
              isn't already the sender (avoids redundant chips). */}
          {thread.venueName && thread.venueName !== thread.lastSenderName && (
            <Chip tone="text-zinc-500">{thread.venueName}</Chip>
          )}

          {/* City + brand */}
          {thread.cityName && <Chip tone="text-zinc-500">{thread.cityName}</Chip>}

          {/* Campaign + daypart */}
          {thread.campaignName && (
            <Chip tone="text-zinc-500">
              {thread.campaignName}
              {thread.eventDayPart && ` · ${formatDayPart(thread.eventDayPart)}`}
              {thread.eventCrawlNumber ? ` #${thread.eventCrawlNumber}` : ""}
            </Chip>
          )}

          {/* Account owner + Gmail address — surfaced as a small
              "sender mailbox" chip so operators can see which
              connected account this thread flows through without
              opening the thread. Matches the Gmail-parity spec
              requirement to show: staff owner + connected email
              chip. The owner glyph is a Mail icon for clarity. */}
          {thread.accountOwnerName && (
            <Chip tone="text-zinc-500">
              <Mail className="mr-0.5 inline h-2.5 w-2.5" />
              {thread.accountOwnerName} · {thread.accountEmail}
            </Chip>
          )}

          {/* =====================================================
              ENGINE STATUS PILLS
              =====================================================
              Operational state of the thread in the engine. Visually
              distinct from Gmail labels (below): square corners
              (rounded-sm, not rounded-md), neutral subtle bg, mono
              uppercase. The shape difference is the at-a-glance
              "this is an engine status, not a Gmail label" cue
              called out in the spec.

              Order: state pill -> SLA -> Stale -> classification
              icon. Each is gated on its own predicate so the row
              only carries the pills that apply. */}
          {thread.state !== "needs_reply" ? (
            // Only surface NON-default engine states (waiting, follow_up_due,
            // closed_*). "Needs Reply" is the default; rendering it on every
            // row was noise, and on SLA-breached rows it duplicated the SLA
            // badge below (both fire off the same breach). The SLA badge now
            // carries the urgency for needs_reply rows.
            <EngineStatusPill state={thread.state} />
          ) : null}

          {/* SLA breach badge (recency-based, ad-hoc heuristic) */}
          {thread.slaBreached && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-rose-50 px-1.5 py-0.5 font-mono text-[9px] text-rose-700 uppercase tracking-widest dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="h-2.5 w-2.5" />
              SLA
            </span>
          )}

          {/* Stale badge -- persisted by the stale-tagger cron.
              Distinct from SLA: SLA is "thread breached its window";
              stale is "tagged stale by background scan with reason
              attached". Shown together when both apply (the rare
              "really overdue" case). The compact duration label
              ("Stale 3h") is precomputed server-side from
              stale_since so the operator can triage at a glance
              without expanding the tooltip. */}
          {thread.isStale && (
            <span
              className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] text-amber-800 uppercase tracking-widest dark:bg-amber-950/40 dark:text-amber-300"
              title={thread.staleReason ?? "Stale"}
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              Stale
              {thread.staleDurationLabel && (
                <span className="font-normal normal-case opacity-80">
                  {thread.staleDurationLabel}
                </span>
              )}
            </span>
          )}

          {/* Unassigned badge -- needs_reply threads with no operator
              assignment. Surfaces nobody-owns-this BEFORE the stale
              tagger picks it up (Rule 5 fires at 1h; this badge
              shows immediately on ingest). Distinct color (zinc,
              not amber/rose) because unassigned alone is a
              workflow signal, not an alert -- amber/rose stay
              reserved for "something is wrong." Once any operator
              clicks Assign on the thread, the badge disappears. */}
          {thread.state === "needs_reply" && thread.assignedStaffId === null && (
            <span
              className="inline-flex items-center gap-1 rounded-sm bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] text-zinc-700 uppercase tracking-widest dark:bg-zinc-800 dark:text-zinc-300"
              title="No operator assigned. Click Assign on the thread to claim it."
            >
              <UserX className="h-2.5 w-2.5" />
              Unassigned
            </span>
          )}

          {/* =====================================================
              GMAIL LABELS
              =====================================================
              Synced from each connected Gmail account. Rounded-md
              (not square like engine pills above) with Gmail's
              bg + text color via inline style — same shape Gmail
              uses for label chips. Cap at 3 visible; "+N" overflow
              chip when more so rows don't blow up. */}
          {thread.gmailLabels.slice(0, 3).map((g) => (
            <span
              key={g.gmailLabelId}
              className="inline-flex items-center rounded-md px-1.5 py-0.5 font-medium text-[10px]"
              style={{
                backgroundColor: g.backgroundColor ?? "#f4f4f5",
                color: g.textColor ?? "#3f3f46",
              }}
              title={`Gmail label: ${g.name}`}
            >
              {g.name}
            </span>
          ))}
          {thread.gmailLabels.length > 3 && (
            <span
              className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 font-medium font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              title={thread.gmailLabels
                .slice(3)
                .map((g) => g.name)
                .join(", ")}
            >
              +{thread.gmailLabels.length - 3}
            </span>
          )}

          {/* Team labels — colored dot + name. Mirrored two-way with Gmail. */}
          {thread.labels.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              title={`Label: ${l.name}`}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  l.color === "emerald" && "bg-emerald-500",
                  l.color === "rose" && "bg-rose-500",
                  l.color === "blue" && "bg-blue-500",
                  l.color === "amber" && "bg-amber-500",
                  l.color === "violet" && "bg-violet-500",
                  l.color === "sky" && "bg-sky-500",
                  l.color === "orange" && "bg-orange-500",
                  l.color === "yellow" && "bg-yellow-500",
                  (!l.color || l.color === "zinc") && "bg-zinc-400",
                )}
              />
              {l.name}
            </span>
          ))}
        </div>
      </Link>
    </li>
  );
}

function Chip({
  tone,
  icon,
  children,
}: {
  tone: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        // Quiet, Gmail-like chip: rounded-full, normal-case, subtle bg.
        // (Was font-mono uppercase tracking-wider, which read like log output.)
        "inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px]",
        "dark:bg-zinc-800/70",
        tone,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * EngineStatusPill — operational state pill for an engine-tracked
 * thread (needs_reply, waiting, follow_up_due, closed_won, etc).
 *
 * Visual treatment is intentionally distinct from Gmail labels:
 *   - rounded-sm corners (vs Gmail's rounded-md)
 *   - subtle tone-on-tone background (vs Gmail's bg+text colors)
 *   - mono uppercase (vs Gmail's mixed case)
 *
 * This is the "engine statuses = operational pills" treatment the
 * spec calls out — at a glance an operator should know "this is the
 * engine's state of the thread" vs "this is a Gmail label."
 *
 * "needs_reply" is the default state so it normally hides; the
 * caller decides when to surface it (SLA breached, etc).
 */
const ENGINE_STATE_LABEL: Record<string, string> = {
  needs_reply: "Needs Reply",
  waiting_on_them: "Waiting",
  follow_up_due: "Follow-Up",
  closed_won: "Won",
  closed_lost: "Lost",
  closed_dnc: "DNC",
  archived: "Archived",
};

const ENGINE_STATE_TONE: Record<string, string> = {
  needs_reply: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  waiting_on_them: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  follow_up_due: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  closed_won: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  closed_lost: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  closed_dnc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  archived: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

function EngineStatusPill({ state }: { state: string }) {
  const label = ENGINE_STATE_LABEL[state];
  const tone = ENGINE_STATE_TONE[state] ?? "bg-zinc-100 text-zinc-600";
  if (!label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest",
        tone,
      )}
      title={`Engine status: ${label}`}
    >
      {label}
    </span>
  );
}

// Only ever called client-side after mount (see timeMounted gate at the
// call site). Locale pinned to en-US so the only runtime variance is the
// operator's timezone, which is correct post-mount.
function formatTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = diffMs / 3_600_000;
  if (diffHours < 24) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const diffDays = diffHours / 24;
  if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDayPart(dp: string): string {
  // friday_night → Fri Night, saturday_day → Sat Day
  return dp
    .split("_")
    .map((p) => p.slice(0, 3))
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ");
}

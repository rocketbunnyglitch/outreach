/**
 * Worklist Section 2: Replies needing attention (Phase 2.3).
 *
 * Inbound replies assigned to the operator (needs_reply / follow_up_due),
 * sorted needs_attention-first then by classification urgency. Each row shows
 * the classification badge, venue + city, the latest snippet, the engine's
 * suggested next action, and an "Open thread" link. Pure server component -- the
 * only interaction is navigation.
 *
 * Colour palette follows the engine's convention (no rose/red unless
 * destructive): engaged -> blue, question -> amber, soft-no -> zinc,
 * cancelled-by-them -> rose (the one fire-drill exception). needs_attention
 * rows get an amber accent so they stand out.
 */

import type { WorklistReplyRow } from "@/lib/worklist-data";
import { MessageSquareReply } from "lucide-react";
import Link from "next/link";
import { WorklistEmpty, WorklistSection } from "./worklist-section";

/** Badge label + colour classes for an effective classification. */
function classificationBadge(classification: string): { label: string; className: string } {
  const label = classification.replace(/_/g, " ");
  switch (classification) {
    case "interested":
    case "warm":
    case "confirmed":
    case "stalled_warm":
      return {
        label,
        className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
      };
    case "question":
    case "callback_requested":
      return {
        label,
        className: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "cancelled_by_them":
      return {
        label,
        className: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
      };
    default:
      // decline / unsubscribe / auto_reply / spam / unclassified -> muted.
      return {
        label,
        className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
      };
  }
}

/** A small engagement chip, shown only for genuinely-engaged venues so the
 *  highest-value replies catch the eye. Soft signal -- display only. */
function engagementChip(band: WorklistReplyRow["engagementBand"]): {
  label: string;
  className: string;
} | null {
  if (band === "hot")
    return {
      label: "Hot lead",
      className: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
    };
  if (band === "engaged")
    return {
      label: "Engaged",
      className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    };
  return null;
}

function ReplyRow({ reply }: { reply: WorklistReplyRow }) {
  const badge = classificationBadge(reply.classification);
  const engagement = engagementChip(reply.engagementBand);
  return (
    <Link
      href={`/inbox/${reply.id}`}
      className={`block rounded-xl border px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
        reply.needsAttention
          ? "border-amber-300 dark:border-amber-700/60"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-sm">
            {reply.venueName ?? "(no venue)"}
            {reply.cityName ? <span className="text-zinc-500"> · {reply.cityName}</span> : null}
          </span>
          {reply.needsAttention ? (
            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 font-medium text-[10px] text-amber-700 uppercase tracking-wide dark:bg-amber-950/50 dark:text-amber-300">
              Needs attention
            </span>
          ) : null}
          {engagement ? (
            <span
              title={`Engagement score ${reply.engagementScore}/100`}
              className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${engagement.className}`}
            >
              {engagement.label}
            </span>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium text-[11px] capitalize ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
      {reply.snippet ? (
        <p className="mt-1 truncate text-xs text-zinc-500">{reply.snippet}</p>
      ) : null}
      {reply.nextActionLabel ? (
        <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-medium">Next:</span> {reply.nextActionLabel}
        </p>
      ) : null}
    </Link>
  );
}

export function RepliesSection({
  replies,
  totalCount,
}: {
  replies: WorklistReplyRow[];
  totalCount?: number;
}) {
  const total = totalCount ?? replies.length;
  return (
    <WorklistSection
      title="Replies needing attention"
      subtitle="Inbound replies the engine flagged for you to triage"
      icon={<MessageSquareReply className="h-4 w-4" />}
      count={total}
    >
      {replies.length === 0 ? (
        <WorklistEmpty message="No replies need attention right now." />
      ) : (
        <div className="flex flex-col gap-2">
          {replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
          {/* Overflow signal — refdoc 8.2: nothing falls through silently. */}
          {total > replies.length && (
            <Link
              href="/inbox"
              className="rounded-xl border border-zinc-200 border-dashed px-3 py-2 text-center font-mono text-[11px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200"
            >
              + {total - replies.length} more — open the inbox to work the rest
            </Link>
          )}
        </div>
      )}
    </WorklistSection>
  );
}

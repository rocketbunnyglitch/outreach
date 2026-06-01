/**
 * VenueCommunicationSection — full email-communication timeline for
 * a venue.
 *
 * Renders below the NotesSection on the venue detail page. Shows
 * every email thread tied to this venue (direct venue_id match,
 * sender-email match, or website-domain match) regardless of which
 * Gmail subject or which connected staff account received them.
 *
 * Sections, top to bottom:
 *
 *   1. Summary strip — six chips: total threads, messages, last
 *      inbound, last outbound, needs-reply count, stale count
 *
 *   2. Staff involved — small chips for each account/owner so the
 *      operator instantly sees "which of us has been talking to
 *      this venue?"
 *
 *   3. Threads list — chronological (newest first) with subject,
 *      last-message timestamp, account chip, owner chip, state
 *      pill, classification chip, match-source badge, and a quick
 *      "Open" link to /inbox/[threadId]
 *
 * Server component; renders nothing when the venue has no
 * communication on record.
 */

import { cn } from "@/lib/cn";
import type { VenueCommunication } from "@/lib/venue-communication";
import { CircleDot, Inbox, Mail, MailCheck, Send, Timer, UserRound } from "lucide-react";
import Link from "next/link";

interface Props {
  data: VenueCommunication;
}

export function VenueCommunicationSection({ data }: Props) {
  const { threads, summary } = data;
  if (threads.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-950">
        <SectionHeader />
        <p className="mt-3 text-sm text-zinc-500">
          No email communication on record yet for this venue. New inbound replies + outbound sends
          will show up here automatically.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-950">
      <SectionHeader />

      {/* Summary strip — Gmail-shaped chips */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SummaryChip
          icon={<Mail className="h-3 w-3" />}
          label="Threads"
          value={summary.totalThreads.toString()}
        />
        <SummaryChip
          icon={<MailCheck className="h-3 w-3" />}
          label="Messages"
          value={summary.totalMessages.toString()}
        />
        <SummaryChip
          icon={<Inbox className="h-3 w-3" />}
          label="Last inbound"
          value={summary.lastInboundAt ? formatTimestamp(summary.lastInboundAt) : "—"}
        />
        <SummaryChip
          icon={<Send className="h-3 w-3" />}
          label="Last outbound"
          value={summary.lastOutboundAt ? formatTimestamp(summary.lastOutboundAt) : "—"}
        />
        <SummaryChip
          icon={<CircleDot className="h-3 w-3 text-rose-500" />}
          label="Needs reply"
          value={summary.needsReplyCount.toString()}
          tone={summary.needsReplyCount > 0 ? "rose" : "zinc"}
        />
        <SummaryChip
          icon={<Timer className="h-3 w-3 text-amber-500" />}
          label="Stale"
          value={summary.staleCount.toString()}
          tone={summary.staleCount > 0 ? "amber" : "zinc"}
        />
      </div>

      {/* Staff involved — surfaces "who's been talking to them" so
          a cross-staff handoff or a duplicate-outreach risk is
          visible at a glance. */}
      {(summary.staffEmails.length > 0 || summary.staffOwnerNames.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-zinc-100 border-t pt-3 dark:border-zinc-900">
          <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Involved
          </span>
          {summary.staffOwnerNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <UserRound className="h-2.5 w-2.5" />
              {name}
            </span>
          ))}
          {summary.staffEmails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            >
              <Mail className="h-2.5 w-2.5" />
              {email}
            </span>
          ))}
        </div>
      )}

      {/* Threads list */}
      <ul className="mt-4 flex flex-col gap-1.5">
        {threads.map((t) => (
          <ThreadRow key={t.threadId} thread={t} />
        ))}
      </ul>
    </section>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold text-lg tracking-tight">Communication timeline</h2>
      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
        Every thread across every account
      </span>
    </div>
  );
}

function SummaryChip({
  icon,
  label,
  value,
  tone = "zinc",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "zinc" | "rose" | "amber";
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
        toneClass,
      )}
    >
      {icon}
      <span className="font-mono text-[9px] uppercase tracking-widest opacity-70">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function ThreadRow({
  thread,
}: {
  thread: VenueCommunication["threads"][number];
}) {
  const stateTone = THREAD_STATE_TONE[thread.state] ?? "border-zinc-200 bg-zinc-50 text-zinc-700";
  const classificationTone =
    CLASSIFICATION_TONE[thread.classification] ?? "text-zinc-500 dark:text-zinc-400";
  const sourceTone =
    thread.source === "venue_id"
      ? null // implicit; don't clutter rows with the most-common badge
      : thread.source === "email_match"
        ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
        : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";

  return (
    <li>
      <Link
        href={`/inbox/${thread.threadId}`}
        className={cn(
          "group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900",
          thread.hasUnread && "font-medium",
        )}
      >
        <span
          className={cn(
            "inline-block h-2 w-2 shrink-0 rounded-full",
            thread.hasUnread ? "bg-blue-500" : "bg-transparent",
          )}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm">{thread.subject ?? "(no subject)"}</span>
            {thread.messageCount > 1 && (
              <span className="shrink-0 font-mono text-[9px] text-zinc-500">
                {thread.messageCount}
              </span>
            )}
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1 py-0 font-mono text-[9px] uppercase tracking-widest",
                stateTone,
              )}
            >
              {THREAD_STATE_LABEL[thread.state] ?? thread.state}
            </span>
            {thread.classification !== "unclassified" && (
              <span
                className={cn(
                  "shrink-0 font-mono text-[9px] uppercase tracking-widest",
                  classificationTone,
                )}
              >
                {thread.classification.replace(/_/g, " ")}
              </span>
            )}
            {sourceTone && (
              <span
                className={cn(
                  "shrink-0 rounded-sm border px-1 py-0 font-mono text-[9px] uppercase tracking-widest",
                  sourceTone,
                )}
                title={
                  thread.source === "email_match"
                    ? "Matched by sender/recipient email — not yet linked"
                    : "Matched by website domain — may need manual review"
                }
              >
                {thread.source === "email_match" ? "Suggested" : "Domain match"}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
            {thread.ownerName && (
              <span className="inline-flex items-center gap-1">
                <UserRound className="h-2.5 w-2.5" />
                {thread.ownerName}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Mail className="h-2.5 w-2.5" />
              {thread.accountEmail}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-zinc-500">
          {formatTimestamp(thread.lastMessageAt)}
        </span>
      </Link>
    </li>
  );
}

const THREAD_STATE_LABEL: Record<string, string> = {
  needs_reply: "Needs reply",
  waiting_on_them: "Waiting",
  follow_up_due: "Follow-up",
  closed_won: "Won",
  closed_lost: "Lost",
  dnc: "DNC",
  archived: "Archived",
  trash: "Trash",
};

const THREAD_STATE_TONE: Record<string, string> = {
  needs_reply:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  waiting_on_them:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  follow_up_due:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  closed_won:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  closed_lost: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900",
  dnc: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900",
  archived: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900",
};

const CLASSIFICATION_TONE: Record<string, string> = {
  interested: "text-emerald-600 dark:text-emerald-400",
  warm: "text-orange-600 dark:text-orange-400",
  confirmed: "text-emerald-700 dark:text-emerald-300",
  question: "text-blue-600 dark:text-blue-400",
  callback_requested: "text-violet-600 dark:text-violet-400",
  decline: "text-rose-600 dark:text-rose-400",
};

/**
 * Compact timestamp matching the inbox row format:
 *   today        -> "3:42 PM"
 *   this year    -> "Jan 15"
 *   prior year   -> "Jan 15, 2024"
 */
function formatTimestamp(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

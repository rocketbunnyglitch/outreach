import type { CampaignSuggestion } from "@/lib/campaign-matcher";
import type { InboxThreadDetail, ThreadTaskRow, VenueOutreachHistoryEntry } from "@/lib/inbox-data";
import { type ThreadState, suggestNextAction } from "@/lib/suggested-next-action";
import type { TeamLabelSummary, ThreadLabelRow } from "@/lib/team-labels";
import type { ThreadNoteRow } from "@/lib/thread-notes";
import type { Classification } from "@/lib/triage-classifier";
import type { VenueCommunication } from "@/lib/venue-communication";
import { ArrowLeft, CalendarClock, Check, MailOpen, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { AssignmentPicker } from "./AssignmentPicker";
import { AttachVenueButton } from "./AttachVenueButton";
import { CampaignSuggestionRow } from "./CampaignSuggestionRow";
import { ClassificationPicker } from "./ClassificationPicker";
import { InlineReplyHost } from "./InlineReplyHost";
import { MessageCard } from "./MessageCard";
import { QuickReplyChips } from "./QuickReplyChips";
import { SuggestedActionRow } from "./SuggestedActionRow";
import { ThreadActions } from "./ThreadActions";
import { ThreadGmailLabelsRow } from "./ThreadGmailLabelsRow";
import { ThreadHeaderReply } from "./ThreadHeaderReply";
import { ThreadHistoryPanel } from "./ThreadHistoryPanel";
import { ThreadLabelsRow } from "./ThreadLabelsRow";
import { ThreadNotesBlock } from "./ThreadNotesBlock";
import { ThreadReplyButtons } from "./ThreadReplyButtons";
import { ThreadViewersPill } from "./ThreadViewersPill";

/**
 * Right pane — full thread conversation + CRM rail below.
 *
 * Layout decision: messages stack top-to-bottom (oldest first, Gmail-style
 * "conversation" view). CRM rail sits below the thread, NOT to the right.
 * On a wide desktop this means the CRM rail is visible without scrolling
 * for short threads; long threads push it below the fold (which is fine —
 * once you're reading a 20-message thread, the CRM context is less urgent).
 *
 * If we later want the CRM rail to stick to the right, refactor InboxShell
 * to take a `rightAside` prop. v1 keeps it simple.
 */
export function ThreadPane({
  detail,
  outreachHistory,
  relatedCommunication,
  threadTasks,
  threadNotes,
  threadLabels,
  allTeamLabels,
  appliedGmailLabels,
  campaignSuggestions,
  isAdmin: _isAdmin,
  currentStaffId,
}: {
  detail: InboxThreadDetail;
  outreachHistory: VenueOutreachHistoryEntry[];
  /** Related threads from the same venue (across every Gmail
   *  account/subject). null when the thread isn't venue-matched
   *  yet — the rail's empty-state covers that case. */
  relatedCommunication: VenueCommunication | null;
  /** Open tasks targeting this thread — both manual and AI-
   *  extracted from inbound messages (Phase A.2). */
  threadTasks: ThreadTaskRow[];
  /** Internal team notes on the thread (Phase D). */
  threadNotes: ThreadNoteRow[];
  threadLabels: ThreadLabelRow[];
  allTeamLabels: TeamLabelSummary[];
  appliedGmailLabels: Array<{
    gmailLabelId: string;
    name: string;
    backgroundColor: string | null;
    textColor: string | null;
  }>;
  campaignSuggestions: CampaignSuggestion[];
  isAdmin: boolean;
  /** For per-row author check on the notes feed. */
  currentStaffId: string;
}) {
  const { thread, messages } = detail;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-zinc-200/80 border-b bg-white/90 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4 dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <div className="flex items-baseline justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Mobile back-arrow — returns to the thread list pane.
                Hidden on lg+ where the list pane is always visible. */}
            <Link
              href="/inbox"
              aria-label="Back to inbox"
              className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 lg:hidden dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            {/* Reply lives on the LEFT so the floating account-switcher
                avatar (top-right of the shell) can't block it on mobile. */}
            <ThreadHeaderReply threadId={thread.id} />
            <h1 className="min-w-0 truncate font-semibold text-base tracking-tight sm:text-lg">
              {thread.subject ?? "(no subject)"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Phase D.3 — soft-lock pill. Renders only when other
                operators are looking at this thread right now. */}
            <ThreadViewersPill threadId={thread.id} currentStaffId={currentStaffId} />
            <span className="hidden font-mono text-[10px] text-zinc-500 uppercase tracking-widest sm:inline">
              {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {thread.venueId && thread.venueName ? (
            <Link
              href={`/venues/${thread.venueId}`}
              className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              {thread.venueName}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2">
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Unassigned · no venue match
              </span>
              <AttachVenueButton threadId={thread.id} />
            </span>
          )}
          {thread.cityName && <span>· {thread.cityName}</span>}
          {thread.brandName && <span>· {thread.brandName}</span>}
          {thread.campaignName && <span>· {thread.campaignName}</span>}
        </p>
        {/* Triage classification + state actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ClassificationPicker
            threadId={thread.id}
            current={
              thread.classification as
                | "interested"
                | "question"
                | "callback_requested"
                | "decline"
                | "unsubscribe"
                | "auto_reply"
                | "spam"
                | "unclassified"
            }
            aiSuggestion={
              thread.suggestedClassification
                ? {
                    classification: thread.suggestedClassification as
                      | "interested"
                      | "warm"
                      | "confirmed"
                      | "question"
                      | "callback_requested"
                      | "decline"
                      | "unsubscribe"
                      | "auto_reply"
                      | "spam"
                      | "unclassified",
                    confidence: thread.suggestedClassificationConfidence
                      ? Number(thread.suggestedClassificationConfidence)
                      : 0,
                  }
                : null
            }
          />
          <ThreadActions
            threadId={thread.id}
            currentState={thread.state}
            unreadCount={thread.unreadCount}
            isStarred={thread.isStarred}
            snoozeUntil={thread.snoozeUntil}
            gmailThreadId={thread.gmailThreadId}
          />
          <AssignmentPicker
            threadId={thread.id}
            currentAssignedStaffId={thread.assignedStaffId}
            currentAssigneeName={thread.assignedStaffName}
          />
        </div>
        {/* Suggested next action — rule-based mapping from
            classification + state. Returns null for closed/
            unclassified threads. Sits high so it's visible
            without scrolling. */}
        <SuggestedActionRow
          threadId={thread.id}
          suggestion={suggestNextAction({
            classification: thread.classification as Classification,
            state: thread.state as ThreadState,
          })}
          subject={thread.subject}
          assignedStaffId={thread.assignedStaffId}
          aiEnrichment={
            thread.aiNextAction
              ? {
                  label: thread.aiNextAction.label,
                  reason: thread.aiNextAction.reason,
                  urgency: thread.aiNextAction.urgency,
                }
              : null
          }
        />
        {/* Team labels — apply / remove inline; also surfaces gmail
            labels that synced in via reconcileGmailLabelsForThread. */}
        <ThreadLabelsRow
          threadId={thread.id}
          applied={threadLabels}
          allTeamLabels={allTeamLabels}
        />
        {/* Gmail labels — applied directly via Gmail API. Distinct
            visual treatment from team labels (rounded-md chips with
            Gmail's bg/text colors). Parallel surface so operators
            can pick either namespace without confusion. */}
        <ThreadGmailLabelsRow threadId={thread.id} appliedGmailLabels={appliedGmailLabels} />
        {/* Smart-detection: rule-based matcher suggests an active
            city_campaign for unattributed threads. Empty list = no
            suggestion meets the confidence threshold; component
            returns null in that case. */}
        <CampaignSuggestionRow threadId={thread.id} suggestions={campaignSuggestions} />
      </header>

      {/* AI-generated 3-line summary for long threads (Phase A.3).
          Renders only when an AI summary exists on the row. The
          page loader fires summarizeThreadAsync in the background
          when the thread is long enough + the cached summary is
          stale; the summary itself materializes on the next view. */}
      {thread.aiSummary && <ThreadSummaryBlock summary={thread.aiSummary} />}

      {/* Messages — NEWEST FIRST (top), like the rest of the app's
          newest-on-top expectation: the loader returns oldest->newest, so
          we reverse for display. The newest stays expanded; older messages
          collapse to a one-line summary when there are 3+. */}
      <ol className="flex flex-col">
        {[...messages].reverse().map((m, i) => {
          // After reverse, the newest message is first (index 0).
          const isNewest = i === 0;
          // Auto-collapse older messages only when there are 3+; single-
          // and two-message threads stay fully expanded.
          const defaultCollapsed = messages.length >= 3 && !isNewest;
          return (
            <MessageCard
              key={m.id}
              message={m}
              isLast={isNewest}
              defaultCollapsed={defaultCollapsed}
            />
          );
        })}
      </ol>

      {/* AI-suggested smart-reply chips (Tier S #1 of the Haiku ROI
          sprint). Render only when chips are cached AND fresh for
          the current message_count. Click a chip → opens a reply
          composer pre-populated with that text. Operator always
          edits before sending.

          Cached on email_threads.ai_quick_replies; the page-level
          hook in [threadId]/page.tsx fires generation lazily so
          this strip appears on the NEXT view after a new inbound
          lands. */}
      {(() => {
        // Cached AND not stale (cache covers the current
        // message_count or was generated AFTER all the messages
        // we have on this thread).
        const cached = thread.aiQuickReplies;
        const cachedAtCount = thread.aiQuickRepliesMessageCount;
        if (!cached || cached.length === 0) return null;
        if (cachedAtCount !== null && cachedAtCount < thread.messageCount) return null;
        return <QuickReplyChips threadId={thread.id} chips={cached} />;
      })()}

      {/* Reply triggers — Reply / Reply All / Forward all hand off
          to the global composer, which carries the full Gmail-style
          surface (popout, fullscreen, undo send, schedule, etc).
          Send still routes through composeAndSendImpl with the
          existing cap + safety + duplicate checks. */}
      <ThreadReplyButtons threadId={thread.id} />

      {/* Inline reply composer — renders when the operator clicked
          Reply (or hit 'r') and the resulting draft is in mode
          "inline". Sits directly below the reply buttons and above
          the history panel so it reads as "the reply for this
          thread." Empty render when no inline draft exists. */}
      <InlineReplyHost threadId={thread.id} />

      {/* History — audit timeline. Collapsed by default; renders
          null when no audited events exist for the thread or
          linked venue. Server component, fires its own DB query. */}
      <ThreadHistoryPanel threadId={thread.id} venueId={thread.venueId} />

      {/* CRM rail */}
      <div className="border-zinc-200/80 border-t bg-zinc-50/50 px-6 py-6 dark:border-zinc-800/60 dark:bg-zinc-950/40">
        <VenueRail
          thread={thread}
          outreachHistory={outreachHistory}
          relatedCommunication={relatedCommunication}
          threadTasks={threadTasks}
          threadNotes={threadNotes}
          currentStaffId={currentStaffId}
        />
      </div>
    </div>
  );
}

// =========================================================================
// CRM rail
// =========================================================================

function VenueRail({
  thread,
  outreachHistory,
  relatedCommunication,
  threadTasks,
  threadNotes,
  currentStaffId,
}: {
  thread: InboxThreadDetail["thread"];
  outreachHistory: VenueOutreachHistoryEntry[];
  relatedCommunication: VenueCommunication | null;
  threadTasks: ThreadTaskRow[];
  threadNotes: ThreadNoteRow[];
  currentStaffId: string;
}) {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Venue card */}
        <section>
          <header className="flex items-center gap-2 text-xs text-zinc-500">
            <User className="h-3.5 w-3.5" />
            <span className="font-mono uppercase tracking-widest">Venue</span>
          </header>
          <h3 className="mt-2 font-semibold text-base tracking-tight">
            {thread.venueId && thread.venueName ? (
              <Link href={`/venues/${thread.venueId}`} className="hover:underline">
                {thread.venueName}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2">
                <span className="text-amber-700 dark:text-amber-300">Unassigned</span>
                <AttachVenueButton threadId={thread.id} />
              </span>
            )}
          </h3>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            {thread.cityName && (
              <>
                <dt className="text-zinc-500">City</dt>
                <dd>{thread.cityName}</dd>
              </>
            )}
            <dt className="text-zinc-500">Outreach brand</dt>
            <dd>{thread.brandName ?? <span className="text-zinc-500 italic">Unassigned</span>}</dd>
            {thread.campaignName && (
              <>
                <dt className="text-zinc-500">Campaign</dt>
                <dd>
                  {thread.cityCampaignId ? (
                    <Link
                      href={`/city-campaigns/${thread.cityCampaignId}`}
                      className="hover:underline"
                    >
                      {thread.campaignName}
                    </Link>
                  ) : (
                    thread.campaignName
                  )}
                </dd>
              </>
            )}
            {thread.eventDayPart && (
              <>
                <dt className="text-zinc-500">Slot</dt>
                <dd>
                  {thread.eventDayPart}
                  {thread.eventCrawlNumber ? ` · crawl #${thread.eventCrawlNumber}` : ""}
                </dd>
              </>
            )}
            {thread.assignedStaffName && (
              <>
                <dt className="text-zinc-500">Owner</dt>
                <dd>{thread.assignedStaffName}</dd>
              </>
            )}
          </dl>
        </section>

        {/* Outreach history */}
        <section>
          <header className="flex items-center gap-2 text-xs text-zinc-500">
            <MailOpen className="h-3.5 w-3.5" />
            <span className="font-mono uppercase tracking-widest">Recent outreach</span>
          </header>
          {outreachHistory.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">No prior outreach logged.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {outreachHistory.slice(0, 6).map((h) => (
                <li
                  key={h.id}
                  className="rounded-md bg-white px-2 py-1.5 text-xs dark:bg-zinc-900/50"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {h.channel} · <span className="text-zinc-600">{h.outcome}</span>
                    </span>
                    <time
                      dateTime={h.createdAt.toISOString()}
                      className="shrink-0 font-mono text-[10px] text-zinc-500"
                    >
                      {h.createdAt.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </div>
                  {h.subject && (
                    <p className="mt-0.5 truncate text-zinc-600 dark:text-zinc-400">{h.subject}</p>
                  )}
                  {h.staffName && (
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                      {h.staffName} · {h.brandName}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {/* Internal team notes (Phase D). Always visible — operators
          use this for any coordination context that doesn't belong
          in the outbound email itself ("called this owner", "they
          want to talk to Mike", etc). @-mentions notify teammates
          and surface in their Mentioned scope. */}
      <ThreadNotesBlock threadId={thread.id} notes={threadNotes} currentStaffId={currentStaffId} />

      {/* Open tasks on this thread — both manual and AI-extracted
          (Phase A.2). Includes auto-tasks the model created from
          inbound messages ("send pricing for the 26th" -> task
          due the 25th). Hidden when the thread has no tasks. */}
      {threadTasks.length > 0 && <ThreadTasksBlock tasks={threadTasks} />}
      {/* Related threads — every OTHER thread from this venue across
        every Gmail subject and connected account. Gmail breaks
        conversation when the subject changes (operator starts
        "Friday details" mid-conversation, etc); the engine
        stitches them back together by venue so the operator sees
        the full relationship history. Rendered below the two-col
        grid so it spans the full rail width. */}
      {relatedCommunication && (
        <RelatedThreadsBlock
          currentThreadId={thread.id}
          venueId={thread.venueId}
          related={relatedCommunication}
        />
      )}
    </>
  );
}

function ThreadSummaryBlock({
  summary,
}: {
  summary: { headline: string; context: string; next: string };
}) {
  return (
    <aside
      // Violet for AI-assisted, per project color convention.
      // Sits between the header and the messages list so it's
      // unmissable when opening a long thread.
      className="border-zinc-200/80 border-b bg-violet-50/40 px-6 py-4 dark:border-zinc-800/60 dark:bg-violet-950/20"
    >
      <div className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] text-violet-700 uppercase tracking-[0.18em] dark:text-violet-300">
        <Sparkles className="h-3 w-3" />
        AI Summary
      </div>
      <p className="font-semibold text-sm text-zinc-900 leading-snug dark:text-zinc-100">
        {summary.headline}
      </p>
      <p className="mt-1.5 text-sm text-zinc-700 leading-relaxed dark:text-zinc-300">
        {summary.context}
      </p>
      <p className="mt-1.5 inline-flex items-start gap-1.5 text-sm text-violet-700 leading-relaxed dark:text-violet-300">
        <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">Next:</span>
        <span>{summary.next}</span>
      </p>
    </aside>
  );
}

function ThreadTasksBlock({ tasks: rows }: { tasks: ThreadTaskRow[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
          <CalendarClock className="h-3 w-3" />
          Tasks on this thread ({rows.length})
        </h3>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((t) => (
          <li
            key={t.id}
            className="flex items-start gap-2 rounded-md border border-zinc-100 px-2 py-1.5 text-xs dark:border-zinc-900"
          >
            <span
              className={`mt-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${
                t.status === "completed"
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {t.status === "completed" && <Check className="h-2 w-2 text-emerald-600" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`leading-tight ${
                    t.status === "completed"
                      ? "text-zinc-400 line-through"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {t.title}
                </p>
                {t.isAi && (
                  <span
                    title="Auto-created by AI from an inbound message"
                    className="inline-flex shrink-0 items-center gap-0.5 rounded border border-violet-300/70 bg-violet-50 px-1 py-0.5 font-mono text-[9px] text-violet-700 uppercase tracking-wider dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200"
                  >
                    <Sparkles className="h-2 w-2" />
                    AI
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                {t.dueAt && (
                  <span className="font-mono">
                    Due{" "}
                    {t.dueAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
                {t.assignedStaffName && <span>· {t.assignedStaffName}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelatedThreadsBlock({
  currentThreadId,
  venueId,
  related,
}: {
  currentThreadId: string;
  venueId: string | null;
  related: VenueCommunication;
}) {
  const others = related.threads.filter((t) => t.threadId !== currentThreadId);
  if (others.length === 0) return null;
  return (
    <section className="mt-6 border-zinc-200 border-t pt-6 dark:border-zinc-800">
      <header className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-2">
          <MailOpen className="h-3.5 w-3.5" />
          <span className="font-mono uppercase tracking-widest">
            Related threads ({others.length})
          </span>
        </span>
        <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
          Same venue · all subjects · all accounts
        </span>
      </header>
      <ul className="mt-2 flex flex-col gap-1">
        {others.slice(0, 8).map((t) => (
          <li key={t.threadId}>
            <Link
              href={`/inbox/${t.threadId}`}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <span
                aria-hidden="true"
                className={
                  t.hasUnread
                    ? "inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500"
                    : "inline-block h-2 w-2 shrink-0 rounded-full bg-transparent"
                }
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={t.hasUnread ? "truncate font-medium" : "truncate"}>
                  {t.subject ?? "(no subject)"}
                </span>
                <span className="truncate font-mono text-[10px] text-zinc-500">
                  {t.ownerName ? `${t.ownerName} · ` : ""}
                  {t.accountEmail}
                </span>
              </div>
              <time
                dateTime={t.lastMessageAt.toISOString()}
                className="shrink-0 font-mono text-[10px] text-zinc-500"
              >
                {t.lastMessageAt.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </Link>
          </li>
        ))}
        {others.length > 8 && venueId && (
          <li>
            <Link
              href={`/venues/${venueId}`}
              className="block px-2 py-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-widest hover:underline"
            >
              + {others.length - 8} more on venue page
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

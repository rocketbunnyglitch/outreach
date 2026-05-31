import type { CampaignSuggestion } from "@/lib/campaign-matcher";
import type { InboxThreadDetail, VenueOutreachHistoryEntry } from "@/lib/inbox-data";
import { type ThreadState, suggestNextAction } from "@/lib/suggested-next-action";
import type { TeamLabelSummary, ThreadLabelRow } from "@/lib/team-labels";
import type { Classification } from "@/lib/triage-classifier";
import type { VenueCommunication } from "@/lib/venue-communication";
import { MailOpen, User } from "lucide-react";
import Link from "next/link";
import { AssignmentPicker } from "./AssignmentPicker";
import { AttachVenueButton } from "./AttachVenueButton";
import { CampaignSuggestionRow } from "./CampaignSuggestionRow";
import { ClassificationPicker } from "./ClassificationPicker";
import { InlineReplyHost } from "./InlineReplyHost";
import { MessageCard } from "./MessageCard";
import { SuggestedActionRow } from "./SuggestedActionRow";
import { ThreadActions } from "./ThreadActions";
import { ThreadGmailLabelsRow } from "./ThreadGmailLabelsRow";
import { ThreadHistoryPanel } from "./ThreadHistoryPanel";
import { ThreadLabelsRow } from "./ThreadLabelsRow";
import { ThreadReplyButtons } from "./ThreadReplyButtons";

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
  threadLabels,
  allTeamLabels,
  appliedGmailLabels,
  campaignSuggestions,
  isAdmin: _isAdmin,
}: {
  detail: InboxThreadDetail;
  outreachHistory: VenueOutreachHistoryEntry[];
  /** Related threads from the same venue (across every Gmail
   *  account/subject). null when the thread isn't venue-matched
   *  yet — the rail's empty-state covers that case. */
  relatedCommunication: VenueCommunication | null;
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
}) {
  const { thread, messages } = detail;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-zinc-200/80 border-b bg-white/90 px-6 py-4 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="min-w-0 truncate font-semibold text-lg tracking-tight">
            {thread.subject ?? "(no subject)"}
          </h1>
          <span className="shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
          </span>
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

      {/* Messages — long threads collapse older messages by default.
          When there are 3+ messages, all but the most recent render
          as a one-line summary; click to expand. Newest message is
          always shown expanded. Matches Gmail's conversation view. */}
      <ol className="flex flex-col">
        {messages.map((m, i) => {
          const isNewest = i === messages.length - 1;
          // Auto-collapse: only when there are 3+ messages, and only
          // for messages that aren't the newest one. Single-message
          // and two-message threads stay fully expanded — collapsing
          // them just hides useful context.
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
}: {
  thread: InboxThreadDetail["thread"];
  outreachHistory: VenueOutreachHistoryEntry[];
  relatedCommunication: VenueCommunication | null;
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

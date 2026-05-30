import type { CampaignSuggestion } from "@/lib/campaign-matcher";
import { cn } from "@/lib/cn";
import type { InboxThreadDetail, VenueOutreachHistoryEntry } from "@/lib/inbox-data";
import type { TeamLabelSummary, ThreadLabelRow } from "@/lib/team-labels";
import { ArrowLeft, ArrowRight, MailOpen, User } from "lucide-react";
import Link from "next/link";
import { AttachVenueButton } from "./AttachVenueButton";
import { CampaignSuggestionRow } from "./CampaignSuggestionRow";
import { ClassificationPicker } from "./ClassificationPicker";
import { ThreadActions } from "./ThreadActions";
import { ThreadLabelsRow } from "./ThreadLabelsRow";

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
  threadLabels,
  allTeamLabels,
  campaignSuggestions,
}: {
  detail: InboxThreadDetail;
  outreachHistory: VenueOutreachHistoryEntry[];
  threadLabels: ThreadLabelRow[];
  allTeamLabels: TeamLabelSummary[];
  campaignSuggestions: CampaignSuggestion[];
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
          />
        </div>
        {/* Team labels — apply / remove inline; also surfaces gmail
            labels that synced in via reconcileGmailLabelsForThread. */}
        <ThreadLabelsRow
          threadId={thread.id}
          applied={threadLabels}
          allTeamLabels={allTeamLabels}
        />
        {/* Smart-detection: rule-based matcher suggests an active
            city_campaign for unattributed threads. Empty list = no
            suggestion meets the confidence threshold; component
            returns null in that case. */}
        <CampaignSuggestionRow threadId={thread.id} suggestions={campaignSuggestions} />
      </header>

      {/* Messages */}
      <ol className="flex flex-col">
        {messages.map((m, i) => (
          <MessageCard key={m.id} message={m} isLast={i === messages.length - 1} />
        ))}
      </ol>

      {/* CRM rail */}
      <div className="border-zinc-200/80 border-t bg-zinc-50/50 px-6 py-6 dark:border-zinc-800/60 dark:bg-zinc-950/40">
        <VenueRail thread={thread} outreachHistory={outreachHistory} />
      </div>
    </div>
  );
}

function MessageCard({
  message,
  isLast,
}: {
  message: InboxThreadDetail["messages"][number];
  isLast: boolean;
}) {
  const isInbound = message.direction === "inbound";
  return (
    <li
      className={cn("border-zinc-200/40 px-6 py-5 dark:border-zinc-800/30", !isLast && "border-b")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm">
            {isInbound ? (
              <ArrowLeft className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
            )}
            <span className="font-medium">{message.fromName ?? message.fromAddress}</span>
            {message.fromName && (
              <span className="text-xs text-zinc-500">&lt;{message.fromAddress}&gt;</span>
            )}
          </p>
          {message.toAddresses.length > 0 && (
            <p className="mt-0.5 text-xs text-zinc-500">
              to {message.toAddresses.join(", ")}
              {message.ccAddresses.length > 0 && (
                <span> · cc {message.ccAddresses.join(", ")}</span>
              )}
            </p>
          )}
        </div>
        <time
          dateTime={message.sentAt.toISOString()}
          className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums"
        >
          {message.sentAt.toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </header>

      <div className="mt-3">
        {/*
          Render priority:
            1. bodySafeHtml — server-sanitized inbound HTML. Newsletters,
               replies with formatting, threaded-quote markup all render
               correctly here. The sanitizer in lib/email-sanitize.ts
               strips scripts/iframes/event-handlers; what reaches the
               client is safe to inject via dangerouslySetInnerHTML.
            2. bodyText — plain-text fallback when HTML is absent or
               stripped to nothing.
            3. "(empty body)" — both null.

          The wrapper applies inbox-prose styles (a minimal hand-rolled
          alternative to @tailwindcss/typography since the plugin isn't
          installed in this project). Constraints:
            - max-width on the body so newsletter tables don't explode
              the right column
            - links inherit our accent colour and underline
            - quoted text (Gmail-style "On ... wrote:") gets a left
              border so the operator can see the boundary
        */}
        {message.bodySafeHtml ? (
          <div
            className="inbox-prose max-w-prose text-sm text-zinc-800 dark:text-zinc-200"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side via DOMPurify; see lib/email-sanitize.ts
            dangerouslySetInnerHTML={{ __html: message.bodySafeHtml }}
          />
        ) : message.bodyText ? (
          <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-800 dark:text-zinc-200">
            {message.bodyText}
          </pre>
        ) : (
          <p className="text-xs text-zinc-500 italic">(empty body)</p>
        )}
      </div>

      {message.sentByStaffName && !isInbound && (
        <p className="mt-3 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Sent by {message.sentByStaffName}
        </p>
      )}
    </li>
  );
}

// =========================================================================
// CRM rail
// =========================================================================

function VenueRail({
  thread,
  outreachHistory,
}: {
  thread: InboxThreadDetail["thread"];
  outreachHistory: VenueOutreachHistoryEntry[];
}) {
  return (
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
  );
}

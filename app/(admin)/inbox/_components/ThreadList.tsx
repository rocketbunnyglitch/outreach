import { cn } from "@/lib/cn";
import type { InboxThreadRow } from "@/lib/inbox-data";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Inbox as InboxIcon,
  PhoneCall,
  ShieldOff,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";

/**
 * Middle pane — the thread list. Rows are Gmail-shaped: sender / subject
 * snippet / timestamp on the right. Below the snippet is a single line
 * of context chips (campaign, city, day_part) so the operator sees the
 * "why this matters" without opening the thread.
 */
export function ThreadList({
  threads,
  activeThreadId,
  folderLabel,
  preservedQuery,
}: {
  threads: InboxThreadRow[];
  activeThreadId: string | null;
  folderLabel: string;
  /**
   * Query string to preserve when navigating into a thread (so the
   * "mine only" + folder filters survive the click).
   */
  preservedQuery: string;
}) {
  if (threads.length === 0) {
    return (
      <div className="p-6 text-center">
        <InboxIcon className="mx-auto h-7 w-7 text-zinc-400" />
        <h3 className="mt-3 font-semibold text-lg tracking-tight">{folderLabel}</h3>
        <p className="mt-1 text-xs text-zinc-500">Nothing here.</p>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-10 bg-white/90 px-4 py-3 backdrop-blur-md dark:bg-zinc-950/80">
        <h2 className="font-semibold text-sm tracking-tight">{folderLabel}</h2>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          {threads.length} thread{threads.length === 1 ? "" : "s"}
        </p>
      </header>
      <ul className="flex flex-col">
        {threads.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            isActive={t.id === activeThreadId}
            preservedQuery={preservedQuery}
          />
        ))}
      </ul>
    </>
  );
}

const CLASSIFICATION_ICON: Record<string, React.ReactNode> = {
  interested: <CheckCircle2 className="h-3 w-3" />,
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
}: {
  thread: InboxThreadRow;
  isActive: boolean;
  preservedQuery: string;
}) {
  const href = preservedQuery ? `/inbox/${thread.id}?${preservedQuery}` : `/inbox/${thread.id}`;

  return (
    <li>
      <Link
        href={href}
        className={cn(
          "block border-zinc-200/60 border-b px-4 py-3 transition-colors",
          "dark:border-zinc-800/40",
          isActive ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50",
          // Unread threads get a slightly heavier left border accent
          thread.unreadCount > 0 && "border-l-2 border-l-indigo-500",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              thread.unreadCount > 0 ? "font-semibold" : "font-medium",
            )}
          >
            {thread.lastSenderName ?? thread.venueName ?? "Unassigned"}
          </p>
          <time
            dateTime={thread.lastMessageAt.toISOString()}
            className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums"
          >
            {formatTime(thread.lastMessageAt)}
          </time>
        </div>

        {thread.subject && (
          <p
            className={cn(
              "mt-0.5 truncate text-xs",
              thread.unreadCount > 0
                ? "text-zinc-800 dark:text-zinc-200"
                : "text-zinc-600 dark:text-zinc-400",
            )}
          >
            {thread.subject}
          </p>
        )}

        {thread.snippet && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{thread.snippet}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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

          {/* SLA breach badge */}
          {thread.slaBreached && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-500 uppercase tracking-widest">
              <AlertTriangle className="h-3 w-3" />
              SLA
            </span>
          )}
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
        "inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px]",
        "uppercase tracking-wider",
        "dark:bg-zinc-900",
        tone,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function formatTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = diffMs / 3_600_000;
  if (diffHours < 24) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const diffDays = diffHours / 24;
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDayPart(dp: string): string {
  // friday_night → Fri Night, saturday_day → Sat Day
  return dp
    .split("_")
    .map((p) => p.slice(0, 3))
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ");
}

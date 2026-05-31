"use client";

/**
 * ThreadViewersPill — shows other operators currently looking at
 * the same thread.
 *
 * Phase D.3 of the email-system audit. Soft-lock UX:
 *   - When you open a thread, your presence heartbeat carries
 *     focusedRowId = threadId.
 *   - usePresenceHeartbeat returns the roster filtered to "others
 *     looking at the same route." The route is /inbox, so
 *     everyone in the inbox shows up. We filter that roster down
 *     to viewers whose focusedRowId matches this thread.
 *   - If the list is non-empty, we render a small violet pill in
 *     the thread header: "JC + 1 other are viewing this."
 *
 * Why soft-lock not hard-lock:
 *   Two operators replying to the same thread at once is rare and
 *   recoverable (Gmail thread accepts both). A hard lock would be
 *   coordination overhead for a problem that almost never happens.
 *   The soft pill is enough to make the coordination visible —
 *   the second operator sees "JC is on this" and waits, or pings
 *   JC in an internal note instead.
 */

import { type PresenceViewer, usePresenceHeartbeat } from "@/components/ui/data-table";
import { Eye } from "lucide-react";

interface Props {
  threadId: string;
  currentStaffId: string;
}

export function ThreadViewersPill({ threadId, currentStaffId }: Props) {
  // Use the same /inbox route as the rest of inbox presence so
  // viewers + folder-list avatars draw from the same bucket.
  // focusedRowId scopes to this thread without claiming a new
  // route bucket.
  const heartbeat = usePresenceHeartbeat({
    route: "/inbox",
    currentStaffId,
    focusedRowId: threadId,
  });

  // others lists everyone but the current user. Narrow further to
  // viewers focused on THIS thread.
  const onThisThread = heartbeat.others.filter((v: PresenceViewer) => v.focusedRowId === threadId);

  if (onThisThread.length === 0) return null;

  const first = onThisThread[0];
  if (!first) return null;

  const extra = onThisThread.length - 1;
  const label =
    extra === 0
      ? `${first.displayName} is viewing this`
      : `${first.displayName} + ${extra} other${extra === 1 ? "" : "s"} are viewing this`;

  return (
    <span
      title={onThisThread.map((v) => v.displayName).join(", ")}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-300/70 bg-violet-50 px-2 py-0.5 font-mono text-[10px] text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200"
    >
      <Eye className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

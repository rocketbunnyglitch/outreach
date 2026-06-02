"use client";

/**
 * ThreadActions — the row of action buttons in the thread header.
 * Mark interested → state closed_won
 * Mark declined → state closed_lost
 * Archive → state archived (also sets archivedAt server-side)
 * Star → toggles is_starred (Gmail-style)
 * Snooze → opens a popover with presets + custom datetime
 * Trash → soft-delete (deleted_at IS NOT NULL; recoverable from Trash)
 *
 * Also auto-fires markThreadRead on mount so the unread badge clears
 * the moment the operator opens the thread. Gmail does this implicitly;
 * doing it on mount matches that mental model.
 */

import { Button } from "@/components/ui/button";
import { AlarmClock, Archive, CheckCircle2, Inbox, Loader2, Trash2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { markThreadRead, setThreadState, setThreadTrash } from "../_actions";
import { SnoozePopover } from "./SnoozePopover";
import { StarToggle } from "./StarToggle";
import { ThreadMoreMenu } from "./ThreadMoreMenu";

interface Props {
  threadId: string;
  currentState: string;
  unreadCount: number;
  isStarred: boolean;
  snoozeUntil: string | null;
  /** Gmail's thread id for "Open in Gmail" deep-link. */
  gmailThreadId: string;
}

export function ThreadActions({
  threadId,
  currentState,
  unreadCount,
  isStarred,
  snoozeUntil,
  gmailThreadId,
}: Props) {
  const [pending, startTx] = useTransition();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const router = useRouter();
  // Only mark-as-read once per mount to avoid noise from re-renders
  const markedRef = useRef(false);

  useEffect(() => {
    if (markedRef.current) return;
    if (unreadCount === 0) return;
    markedRef.current = true;
    // Optimistically clear the row's unread styling in the list pane the
    // instant the thread opens (Gmail does this on open). ThreadRow listens
    // for this event and un-bolds itself; the server revalidate inside
    // markThreadRead then makes it durable across navigations.
    document.dispatchEvent(new CustomEvent("inbox-thread-read", { detail: { threadId } }));
    // Fire-and-forget; markThreadRead now revalidates /inbox + the thread.
    markThreadRead(threadId).catch(() => {});
  }, [threadId, unreadCount]);

  function changeState(state: "closed_won" | "closed_lost" | "archived") {
    // Click the same state again to toggle BACK to needs_reply.
    // Operators reach for these buttons to mark a final outcome;
    // when they realize they misclicked, the cleanest undo is
    // "click the highlighted button to clear it." Matches the
    // Gmail-parity "Important" toggle behavior — second click
    // unsets, not no-ops.
    const next = currentState === state ? "needs_reply" : state;
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("state", next);
      await setThreadState(null, fd);
      router.refresh();
    });
  }

  function handleTrash() {
    if (!confirm("Move this thread to Trash? You can restore it from the Trash view.")) {
      return;
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("trashed", "true");
      const res = await setThreadTrash(null, fd);
      if (res.ok) {
        // Navigate back to the inbox after trashing — the operator
        // has no need to stay on a trashed thread page.
        router.push("/inbox");
      }
    });
  }

  // Keyboard binding bridge: InboxKeyboardNav dispatches a custom
  // event on the document when the operator presses 'e'. We listen
  // here so this thread's archive action runs without ThreadActions
  // needing to be lifted into a parent. The event carries the
  // threadId so multiple panes (unlikely but defensive) don't fire
  // each other's archive.
  useEffect(() => {
    function onArchive(e: Event) {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      if (detail?.threadId !== threadId) return;
      changeState("archived");
    }
    document.addEventListener("inbox-archive", onArchive);
    return () => document.removeEventListener("inbox-archive", onArchive);
    // changeState closes over threadId + currentState, both stable
    // for the lifetime of this component (the parent unmounts the
    // pane on thread change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, currentState]);

  return (
    <div className="flex items-center gap-2">
      <StarToggle threadId={threadId} initialStarred={isStarred} size="md" />
      <Button
        size="sm"
        variant={currentState === "closed_won" ? "default" : "outline"}
        onClick={() => changeState("closed_won")}
        disabled={pending}
        title="They're interested. Move to closed-won."
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3 w-3" />
        )}
        Interested
      </Button>
      <Button
        size="sm"
        variant={currentState === "closed_lost" ? "default" : "outline"}
        onClick={() => changeState("closed_lost")}
        disabled={pending}
        title="They passed."
      >
        <XCircle className="h-3 w-3" />
        Declined
      </Button>
      {currentState === "archived" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Restore from archive — same path the bulk action uses.
            // setThreadState validates the state value; needs_reply is
            // the only sensible default for restoration since the
            // engine doesn't remember the pre-archive state.
            startTx(async () => {
              const fd = new FormData();
              fd.set("threadId", threadId);
              fd.set("state", "needs_reply");
              await setThreadState(null, fd);
              router.refresh();
            });
          }}
          disabled={pending}
          title="Move back to Inbox — unarchive this thread."
        >
          <Inbox className="h-3 w-3" />
          Move to Inbox
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => changeState("archived")}
          disabled={pending}
          title="Archive — out of the active inbox view."
        >
          <Archive className="h-3 w-3" />
          Archive
        </Button>
      )}
      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSnoozeOpen((v) => !v)}
          disabled={pending}
          title={
            snoozeUntil
              ? `Snoozed until ${new Date(snoozeUntil).toLocaleString("en-US")}`
              : "Snooze this thread"
          }
        >
          <AlarmClock className="h-3 w-3" />
          {snoozeUntil ? "Snoozed" : "Snooze"}
        </Button>
        {snoozeOpen && (
          <SnoozePopover
            threadId={threadId}
            currentSnoozeUntil={snoozeUntil}
            onClose={() => setSnoozeOpen(false)}
            onSnoozed={() => router.refresh()}
          />
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleTrash}
        disabled={pending}
        title="Move to Trash"
        className="text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
      >
        <Trash2 className="h-3 w-3" />
        Trash
      </Button>
      <ThreadMoreMenu threadId={threadId} gmailThreadId={gmailThreadId} />
    </div>
  );
}

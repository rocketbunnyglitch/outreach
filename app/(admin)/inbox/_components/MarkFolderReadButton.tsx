"use client";

/**
 * MarkFolderReadButton -- a small filter-bar control that marks
 * every unread thread in the CURRENT view as read in a single
 * batch.
 *
 * Different from the selection-toolbar's mark-read action in
 * ThreadListWithBulk: that requires the operator to click each
 * row's checkbox first. This button hits every visible unread
 * thread without selection -- the "you've reviewed the folder,
 * clear the badges" gesture.
 *
 * Backed by the existing bulkUpdateThreads server action (which
 * gained per-message read_at parity in the same commit as this
 * component). The parent passes the list of unread thread ids
 * already loaded for the visible list view -- no separate query
 * here.
 *
 * Rendering:
 *   - Hidden entirely when there are no unread threads to act on.
 *     A "Mark 0 read" button is just noise.
 *   - For larger batches (over the CONFIRM_THRESHOLD), a native
 *     confirm() prompt guards the click. Operators routinely
 *     mass-mark needs_reply piles; the confirm catches the
 *     accidental-click case without making the common path
 *     hostile.
 *   - Pending state swaps the label to "Marking..." with a
 *     spinner so a slow batch (Gmail mirror takes a moment per
 *     thread) doesn't look broken.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CheckCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { bulkUpdateThreads } from "../_actions";

/** Threshold above which we add a confirm() prompt. Chosen to
 *  guard the "click while not paying attention" mistake without
 *  blocking ordinary triage flows (folders of 10-30 are common). */
const CONFIRM_THRESHOLD = 50;

interface Props {
  /** Thread ids in the current visible view whose unread_count > 0.
   *  Pre-computed by the server page from already-loaded thread rows
   *  -- no extra DB roundtrip just for this prop. */
  unreadThreadIds: string[];
}

export function MarkFolderReadButton({ unreadThreadIds }: Props) {
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (unreadThreadIds.length === 0) return null;

  function run() {
    const n = unreadThreadIds.length;
    if (n > CONFIRM_THRESHOLD) {
      if (
        !confirm(
          `Mark ${n.toLocaleString("en-US")} thread${n === 1 ? "" : "s"} as read? This also clears the unread state in Gmail.`,
        )
      ) {
        return;
      }
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("action", "mark_read");
      fd.set("threadIds", unreadThreadIds.join(","));
      const res = await bulkUpdateThreads(null, fd);
      if (res.ok) {
        toast.show({
          kind: "success",
          message: `Marked ${res.data.updated.toLocaleString("en-US")} thread${res.data.updated === 1 ? "" : "s"} as read.`,
        });
        router.refresh();
      } else {
        toast.show({ kind: "error", message: res.error ?? "Couldn't mark threads as read." });
      }
    });
  }

  return (
    <Button
      type="button"
      onClick={run}
      disabled={pending}
      variant="outline"
      size="sm"
      title={`Mark all ${unreadThreadIds.length} unread thread${unreadThreadIds.length === 1 ? "" : "s"} in this view as read`}
    >
      {pending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCheck className="mr-1 h-3.5 w-3.5" />
      )}
      Mark {unreadThreadIds.length} read
    </Button>
  );
}

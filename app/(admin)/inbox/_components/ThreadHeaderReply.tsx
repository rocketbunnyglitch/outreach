"use client";

/**
 * ThreadHeaderReply — a Reply button in the (sticky) thread header so the
 * reply affordance is reachable at the TOP of a long thread without
 * scrolling all the way down to the reply bar. Reuses the existing
 * "inbox-reply" CustomEvent bridge that ThreadReplyButtons already listens
 * for (same path as the keyboard 'r' shortcut), so it opens the normal
 * reply composer.
 *
 * DESKTOP ONLY (hidden below lg). On mobile the title bar is cramped
 * (back-arrow + subject + floating account avatar) and a header button
 * caused mis-taps; the sticky ThreadReplyBar is the mobile reply entry.
 */

import { Reply } from "lucide-react";

export function ThreadHeaderReply({ threadId }: { threadId: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        document.dispatchEvent(new CustomEvent("inbox-reply", { detail: { threadId } }))
      }
      title="Reply (r)"
      aria-label="Reply"
      className="hidden shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 lg:inline-flex dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      <Reply className="h-3.5 w-3.5" />
      Reply
    </button>
  );
}

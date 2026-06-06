"use client";

/**
 * Gmail-style top-right action cluster on an open thread: star, reply,
 * forward. Desktop-only (mobile uses the sticky bottom ThreadReplyBar).
 * Reply/Forward dispatch the same inbox-reply / inbox-forward
 * CustomEvents that ThreadReplyButtons listens for, so they reuse the
 * single openReplyDraft path + the "reuse existing draft" guard.
 */

import { Forward, Reply } from "lucide-react";
import { StarToggle } from "./StarToggle";

export function ThreadHeaderActions({
  threadId,
  isStarred,
}: {
  threadId: string;
  isStarred: boolean;
}) {
  function dispatch(name: "inbox-reply" | "inbox-forward") {
    document.dispatchEvent(new CustomEvent(name, { detail: { threadId } }));
  }
  const btn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
  return (
    <div className="hidden items-center gap-0.5 lg:flex">
      <StarToggle threadId={threadId} initialStarred={isStarred} size="md" />
      <button
        type="button"
        onClick={() => dispatch("inbox-reply")}
        aria-label="Reply"
        title="Reply"
        className={btn}
      >
        <Reply className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => dispatch("inbox-forward")}
        aria-label="Forward"
        title="Forward"
        className={btn}
      >
        <Forward className="h-4 w-4" />
      </button>
    </div>
  );
}

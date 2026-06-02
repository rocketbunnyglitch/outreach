"use client";

/**
 * ThreadReplyBar — the MOBILE reply entry point. A bar pinned to the
 * bottom of the viewport (Gmail-mobile pattern) so Reply / Reply all /
 * Forward are always within thumb reach regardless of how far the
 * operator has scrolled into a long thread.
 *
 * It carries no composer logic of its own. Each button dispatches a
 * document CustomEvent (inbox-reply / inbox-reply-all / inbox-forward)
 * that ThreadReplyButtons listens for — that component owns the single
 * openReplyDraft path + the "reuse existing draft" guard, so the bar,
 * the desktop header button, and the 'r' shortcut all funnel through
 * one place (no duplicate-draft trap).
 *
 * Hidden on lg+ (desktop uses the header Reply + the under-message
 * row). Hidden while a reply composer for THIS thread is open — the
 * mobile composer is a full-screen overlay, so the bar would just sit
 * uselessly behind it.
 */

import { useComposer } from "@/app/(admin)/_components/composer/composer-store";
import { Forward, Reply, ReplyAll } from "lucide-react";

export function ThreadReplyBar({ threadId }: { threadId: string }) {
  const { composers } = useComposer();

  // While the operator is actively composing a reply to this thread
  // (full-screen on mobile), don't render the bar underneath it.
  const composingHere = Array.from(composers.values()).some(
    (c) => c.replyToThreadId === threadId && (c.mode === "inline" || c.mode === "fullscreen"),
  );
  if (composingHere) return null;

  function fire(name: "inbox-reply" | "inbox-reply-all" | "inbox-forward") {
    document.dispatchEvent(new CustomEvent(name, { detail: { threadId } }));
  }

  return (
    <div
      // pb keeps the buttons clear of the iOS home indicator.
      className="fixed inset-x-0 bottom-0 z-30 border-zinc-200 border-t bg-white/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fire("inbox-reply")}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-zinc-900 font-medium text-sm text-white active:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:active:bg-zinc-300"
        >
          <Reply className="h-4 w-4" />
          Reply
        </button>
        <button
          type="button"
          onClick={() => fire("inbox-reply-all")}
          aria-label="Reply all"
          title="Reply all"
          className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:active:bg-zinc-800"
        >
          <ReplyAll className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => fire("inbox-forward")}
          aria-label="Forward"
          title="Forward"
          className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:active:bg-zinc-800"
        >
          <Forward className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

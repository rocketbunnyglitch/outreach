"use client";

/**
 * ThreadReplyButtons — replaces the inline ReplyComposer with three
 * action buttons (Reply, Reply All, Forward) that hand off to the
 * global Gmail-style composer.
 *
 * Why the swap:
 *   - The global composer already supports the full Gmail surface
 *     (popout, fullscreen, undo send, schedule, signatures, etc).
 *     The inline ReplyComposer was a duplicate textarea that
 *     pre-dated the global composer.
 *   - Reply All and Forward only make sense via the global composer
 *     since their recipient lists are non-trivial.
 *   - Replies routed through the global composer get all the same
 *     send-safety + cap-enforcement + audit + thread-continuation
 *     behavior as new mail, including the 15s undo window.
 *
 * Flow on click:
 *   1. Call openReplyDraft({ threadId, mode }) — creates a new
 *      email_drafts row pre-seeded with the reply context (To, Cc,
 *      subject Re:/Fwd:, quoted body, reply_to_thread_id,
 *      reply_to_message_id).
 *   2. Dispatch a 'compose-email' CustomEvent the ComposerProvider
 *      bridge listens for, with hydrateDraftId set. The bridge
 *      re-fetches via listMyDrafts so the new draft surfaces as a
 *      docked composer.
 *
 * Keyboard binding: 'r' fires Reply (same as the old shortcut).
 */

import { Forward, Reply, ReplyAll } from "lucide-react";
import { useEffect, useTransition } from "react";
import { useComposer } from "../../_components/composer/composer-store";
import { openReplyDraft } from "../_actions";

interface Props {
  threadId: string;
}

export function ThreadReplyButtons({ threadId }: Props) {
  const [pending, startTx] = useTransition();
  const { composers, setMode } = useComposer();

  function open(mode: "reply" | "reply_all" | "forward") {
    // Reuse: if a not-yet-sent draft already exists in the store for
    // this thread, just flip its mode to inline instead of creating
    // another row. Prevents the "click Reply twice -> two drafts"
    // trap. Applies to every mode (Reply / Reply All / Forward) now
    // that all three open inline.
    const existing = Array.from(composers.values()).find((c) => c.replyToThreadId === threadId);
    if (existing) {
      setMode(existing.id, "inline");
      return;
    }
    startTx(async () => {
      const res = await openReplyDraft({ threadId, mode });
      if (!res.ok) {
        alert(res.error);
        return;
      }
      // All three modes (Reply, Reply All, Forward) open INLINE so
      // the operator stays in the thread context. They can still pop
      // out to a docked/expanded/fullscreen window via the composer
      // header's maximize button if they want a wider chrome.
      const initialMode: "inline" | "docked" = "inline";
      window.dispatchEvent(
        new CustomEvent("compose-email", {
          detail: { hydrateDraftId: res.data.draftId, initialMode },
        }),
      );
    });
  }

  // Event bridge — this component owns the single "open the composer"
  // code path. Three sources dispatch into it:
  //   - 'r' keyboard shortcut (InboxKeyboardNav) -> inbox-reply
  //   - the desktop ThreadHeaderReply button     -> inbox-reply
  //   - the mobile sticky ThreadReplyBar         -> inbox-reply /
  //       inbox-reply-all / inbox-forward
  // Routing all of them here keeps openReplyDraft + the
  // "reuse existing draft" guard in one place.
  useEffect(() => {
    function makeHandler(mode: "reply" | "reply_all" | "forward") {
      return (e: Event) => {
        const detail = (e as CustomEvent<{ threadId: string }>).detail;
        if (detail?.threadId !== threadId) return;
        open(mode);
      };
    }
    const onReply = makeHandler("reply");
    const onReplyAll = makeHandler("reply_all");
    const onForward = makeHandler("forward");
    document.addEventListener("inbox-reply", onReply);
    document.addEventListener("inbox-reply-all", onReplyAll);
    document.addEventListener("inbox-forward", onForward);
    return () => {
      document.removeEventListener("inbox-reply", onReply);
      document.removeEventListener("inbox-reply-all", onReplyAll);
      document.removeEventListener("inbox-forward", onForward);
    };
    // 'open' captures threadId which is stable for the component's
    // lifetime; no dep needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return (
    // Desktop-only: on mobile the sticky ThreadReplyBar is the reply
    // entry point (Gmail-mobile pattern). This row stays MOUNTED on
    // mobile (hidden, not unmounted) so the event bridge above keeps
    // working for the bar + keyboard shortcut.
    <div className="hidden items-center gap-2 border-zinc-200 border-y bg-zinc-50/70 px-4 py-3 sm:px-6 lg:flex dark:border-zinc-800 dark:bg-zinc-900/60">
      <ReplyButton
        onClick={() => open("reply")}
        disabled={pending}
        icon={<Reply className="h-4 w-4" />}
        label="Reply"
        primary
      />
      <ReplyButton
        onClick={() => open("reply_all")}
        disabled={pending}
        icon={<ReplyAll className="h-4 w-4" />}
        label="Reply all"
      />
      <ReplyButton
        onClick={() => open("forward")}
        disabled={pending}
        icon={<Forward className="h-4 w-4" />}
        label="Forward"
      />
    </div>
  );
}

function ReplyButton({
  onClick,
  disabled,
  icon,
  label,
  primary,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  const cls = primary
    ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-medium text-sm disabled:opacity-50 ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

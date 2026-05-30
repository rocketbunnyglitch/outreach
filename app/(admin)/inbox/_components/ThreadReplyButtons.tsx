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

import { ArrowRight, Forward, Reply, ReplyAll } from "lucide-react";
import { useEffect, useTransition } from "react";
import { openReplyDraft } from "../_actions";

interface Props {
  threadId: string;
}

export function ThreadReplyButtons({ threadId }: Props) {
  const [pending, startTx] = useTransition();

  function open(mode: "reply" | "reply_all" | "forward") {
    startTx(async () => {
      const res = await openReplyDraft({ threadId, mode });
      if (!res.ok) {
        alert(res.error);
        return;
      }
      // Dispatch the existing CustomEvent the composer bridge
      // listens for. hydrateDraftId triggers useDraftHydration to
      // re-fetch + surface the new draft in the docked stack.
      window.dispatchEvent(
        new CustomEvent("compose-email", {
          detail: { hydrateDraftId: res.data.draftId },
        }),
      );
    });
  }

  // Keyboard bridge: 'r' from InboxKeyboardNav dispatches
  // 'inbox-reply' with the current threadId. We listen here so the
  // shortcut continues to work post-ReplyComposer-retirement.
  useEffect(() => {
    function onReply(e: Event) {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      if (detail?.threadId !== threadId) return;
      open("reply");
    }
    document.addEventListener("inbox-reply", onReply);
    return () => document.removeEventListener("inbox-reply", onReply);
    // 'open' captures threadId which is stable for the component's
    // lifetime; no dep needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return (
    <div className="flex items-center gap-2 border-zinc-200/80 border-y bg-zinc-50/60 px-6 py-3 dark:border-zinc-800/60 dark:bg-zinc-900/40">
      <ReplyButton
        onClick={() => open("reply")}
        disabled={pending}
        icon={<Reply className="h-3 w-3" />}
        label="Reply"
        primary
      />
      <ReplyButton
        onClick={() => open("reply_all")}
        disabled={pending}
        icon={<ReplyAll className="h-3 w-3" />}
        label="Reply all"
      />
      <ReplyButton
        onClick={() => open("forward")}
        disabled={pending}
        icon={<Forward className="h-3 w-3" />}
        label="Forward"
      />
      <span className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
        Opens in composer
        <ArrowRight className="h-2.5 w-2.5" />
      </span>
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
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium text-xs disabled:opacity-50 ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

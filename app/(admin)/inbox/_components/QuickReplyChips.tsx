"use client";

/**
 * QuickReplyChips — Tier S #1 of the Haiku ROI sprint.
 *
 * Renders 3 AI-suggested reply chips above the reply buttons in
 * the thread page. Click a chip → opens an inline reply composer
 * pre-populated with that text. Operator always edits before
 * sending (the composer is the same Gmail-style surface).
 *
 * The chips themselves are generated server-side and cached on
 * email_threads.ai_quick_replies (see lib/ai-quick-replies.ts).
 * This component just renders the strip and handles click → open
 * draft → dispatch compose-email event.
 *
 * Render NOTHING when:
 *   - no chips have been generated yet (page-load hook fires
 *     generation in the background; the chips appear on next view)
 *   - the operator already has a draft open for this thread
 *     (handled at the parent — we only mount when no draft exists)
 *
 * Click handler reuses the existing openReplyDraft action with a
 * new prefillBody param. The action seeds the draft's bodyHtml so
 * the composer hydrates with the suggested text already in the
 * editable surface.
 */

import { Sparkles } from "lucide-react";
import { useTransition } from "react";
import { useComposer } from "../../_components/composer/composer-store";
import { openReplyDraft } from "../_actions";

// normalizeQuickReplies lives in lib/quick-replies-shared (hotfix
// 2026-06-11): ThreadPane (server) value-imported it from this
// "use client" module, and Next throws when a client export is CALLED
// server-side — which crashed thread rendering. Never export pure
// helpers from a client module.

interface Props {
  threadId: string;
  /** The cached chip array from email_threads.ai_quick_replies.
   *  Render nothing if null or empty. */
  chips: string[] | null;
  /** reply_examples ids that grounded the chips (v2 cache) — carried
   *  onto the draft so the send path can record feedback. */
  exampleIds?: string[];
}

export function QuickReplyChips({ threadId, chips, exampleIds = [] }: Props) {
  const [pending, startTx] = useTransition();
  const { composers, setMode } = useComposer();

  if (!chips || chips.length === 0) return null;

  function applyChip(body: string) {
    // Reuse: if a draft already exists for this thread, don't open a
    // second one. Just flip it back to inline mode so the operator
    // sees it. (Could append the chip to existing body, but the
    // operator can copy/paste themselves — avoids surprise overwrites
    // of their in-progress edits.)
    const existing = Array.from(composers.values()).find((c) => c.replyToThreadId === threadId);
    if (existing) {
      setMode(existing.id, "inline");
      return;
    }
    startTx(async () => {
      const res = await openReplyDraft({
        threadId,
        mode: "reply",
        prefillBody: body,
        suggestionExampleIds: exampleIds,
      });
      if (!res.ok) {
        // Soft failure — log + bail. We don't toast because the
        // chip strip is a low-stakes affordance; the operator can
        // still hit the regular Reply button.
        console.warn("[quick-reply-chips] openReplyDraft failed", res.error);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("compose-email", {
          detail: { hydrateDraftId: res.data.draftId, initialMode: "inline" },
        }),
      );
    });
  }

  return (
    <div className="flex flex-col gap-2 border-zinc-200/60 border-t border-b bg-violet-50/30 px-5 py-3 dark:border-zinc-800/60 dark:bg-violet-950/15">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-violet-600 dark:text-violet-400" />
        <span className="font-mono text-[10px] text-violet-700 uppercase tracking-[0.12em] dark:text-violet-300">
          Suggested replies
        </span>
        <span className="font-mono text-[9px] text-zinc-500 lowercase">
          edit before sending · ai-generated
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.slice(0, 3).map((chip, i) => (
          <button
            // Chip text is the natural key — same chip text would
            // resolve to the same suggestion. Using index would
            // collapse duplicates incorrectly on a re-render.
            key={`${i}::${chip.slice(0, 24)}`}
            type="button"
            onClick={() => applyChip(chip)}
            disabled={pending}
            className="group/chip max-w-full overflow-hidden rounded-2xl border border-violet-200 bg-white px-3 py-2 text-left text-zinc-800 text-xs transition-all hover:border-violet-400 hover:bg-violet-50 hover:text-violet-900 disabled:opacity-50 dark:border-violet-900/40 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-500 dark:hover:bg-violet-950/40 dark:hover:text-violet-100"
            title="Click to open a reply with this text pre-filled"
          >
            <span className="line-clamp-2 leading-relaxed">{chip}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

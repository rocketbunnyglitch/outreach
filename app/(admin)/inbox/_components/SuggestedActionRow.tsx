"use client";

/**
 * SuggestedActionRow — renders the rule-based "next action"
 * recommendation for a thread, with a one-click button that fires
 * the matching operator action.
 *
 * Renders null when suggestNextAction returns null (closed threads,
 * unclassified, etc.). Single row, low chrome — sits between the
 * classification picker + the team labels row.
 *
 * Architecture:
 *   - reply / ask_for_manager → dispatch the existing 'inbox-reply'
 *     custom event (the same one the 'r' keyboard shortcut fires).
 *     ReplyComposer listens for it.
 *   - archive / mark_interested / mark_declined → call setThreadState
 *     directly with the matching enum value.
 *   - create_callback_task → call createTask with targetType=email_thread,
 *     targetId=threadId, a sensible default title + due-at +1 business day.
 *
 * Permission model: every underlying action already enforces its own
 * permissions (requireStaff + team-scope on setThreadState; requireStaff
 * on createTask). This component is a UI shortcut, not a privilege
 * boundary.
 */

import type { SuggestedAction } from "@/lib/suggested-next-action";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createTask } from "../../tasks/_actions";
import { setThreadState } from "../_actions";

interface Props {
  threadId: string;
  /** May be null — caller computes suggestNextAction() and passes
   *  the result; row returns null when there's nothing to suggest. */
  suggestion: SuggestedAction | null;
  /** Thread subject — used to title the callback task. */
  subject: string | null;
  /** Optional assignee for the callback task. Defaults to the
   *  thread's assigned staff via the server action's defaults. */
  assignedStaffId?: string | null;
}

export function SuggestedActionRow({ threadId, suggestion, subject, assignedStaffId }: Props) {
  const [pending, startTx] = useTransition();
  const router = useRouter();

  if (!suggestion) return null;

  function runAction() {
    if (!suggestion) return;
    startTx(async () => {
      switch (suggestion.kind) {
        case "reply":
        case "ask_for_manager": {
          // Same custom event ReplyComposer listens for on the
          // keyboard 'r' shortcut. Composer expands + focuses.
          document.dispatchEvent(new CustomEvent("inbox-reply", { detail: { threadId } }));
          break;
        }
        case "mark_interested":
        case "mark_declined":
        case "archive": {
          const state =
            suggestion.kind === "mark_interested"
              ? "closed_won"
              : suggestion.kind === "mark_declined"
                ? "closed_lost"
                : "archived";
          const fd = new FormData();
          fd.set("threadId", threadId);
          fd.set("state", state);
          await setThreadState(null, fd);
          router.refresh();
          break;
        }
        case "create_callback_task": {
          // Title carries thread context. Due tomorrow at 4pm local
          // by default — operator can edit on the resulting task page
          // (createTask redirects there).
          const tomorrow4pm = (() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(16, 0, 0, 0);
            return d.toISOString();
          })();
          const fd = new FormData();
          fd.set("title", `Callback: ${subject ?? "(no subject)"}`);
          fd.set("description", "Auto-suggested follow-up call from the inbox. Linked to thread.");
          fd.set("targetType", "email_thread");
          fd.set("targetId", threadId);
          if (assignedStaffId) fd.set("assignedStaffId", assignedStaffId);
          fd.set("dueAt", tomorrow4pm);
          // createTask redirects to the new task page; this transition
          // throws NEXT_REDIRECT which Next handles.
          await createTask(null, fd);
          break;
        }
      }
    });
  }

  return (
    <div className="mt-3 flex items-center gap-3 rounded-md border border-violet-200/60 bg-violet-50/60 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-400" />
      <p className="flex-1 text-xs text-zinc-700 dark:text-zinc-300">
        <span className="font-mono text-[10px] text-violet-600 uppercase tracking-widest dark:text-violet-300">
          Suggested
        </span>{" "}
        — {suggestion.reason}
      </p>
      <button
        type="button"
        onClick={runAction}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-300 bg-white px-2.5 py-1 font-medium text-violet-700 text-xs hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700/60 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/40"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ArrowRight className="h-3 w-3" />
        )}
        {suggestion.label}
      </button>
    </div>
  );
}

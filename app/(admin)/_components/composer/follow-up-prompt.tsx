"use client";

/**
 * FollowUpPrompt — small toast-like card shown after a successful send.
 * Lets the operator schedule a follow-up task on the linked venue with
 * one click (tomorrow / +3d / +7d / custom / none).
 *
 * Wires into the existing tasks system via createTask. When no venue
 * is attached to the draft, the prompt still renders but the resulting
 * task has targetType='misc' (which the task UI handles fine).
 */

import { Calendar, X } from "lucide-react";
import { useTransition } from "react";
import { createTask } from "../../tasks/_actions";

interface Props {
  /** Linked venue (when present). */
  venueId: string | null;
  /** Linked thread (sent_thread_id). Falls back to misc. */
  threadId?: string | null;
  /** Subject of the email (used as the task title prefix). */
  subject: string;
  /** Recipient address (used in the task description). */
  to: string;
  onClose: () => void;
}

const PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "Tomorrow", days: 1 },
  { label: "+3 days", days: 3 },
  { label: "+7 days", days: 7 },
  { label: "No follow-up", days: null },
];

export function FollowUpPrompt({ venueId, threadId, subject, to, onClose }: Props) {
  const [pending, startTx] = useTransition();

  function schedule(days: number | null) {
    if (days === null) {
      onClose();
      return;
    }
    const due = new Date();
    due.setDate(due.getDate() + days);
    // 4pm local time — same convention as the suggested-action callback flow.
    due.setHours(16, 0, 0, 0);
    startTx(async () => {
      const fd = new FormData();
      fd.set("title", `Follow up: ${subject || to}`);
      fd.set(
        "description",
        `Auto-suggested follow-up after sending to ${to}.${threadId ? "" : " No thread linked."}`,
      );
      if (threadId) {
        fd.set("targetType", "email_thread");
        fd.set("targetId", threadId);
      } else if (venueId) {
        fd.set("targetType", "venue");
        fd.set("targetId", venueId);
      } else {
        fd.set("targetType", "misc");
      }
      fd.set("dueAt", due.toISOString());
      await createTask(null, fd);
      onClose();
    });
  }

  return (
    <div className="border-zinc-200 border-t bg-emerald-50/40 px-3 py-2 dark:border-zinc-800 dark:bg-emerald-950/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5 text-xs">
          <Calendar className="mt-0.5 h-3 w-3 text-emerald-700 dark:text-emerald-300" />
          <span className="text-emerald-900 dark:text-emerald-100">Sent. Follow up?</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss follow-up prompt"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={pending}
            onClick={() => schedule(p.days)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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

import { useToast } from "@/components/ui/toast";
import { Calendar, Check, X } from "lucide-react";
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
  const toast = useToast();

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
      const result = await createTask(null, fd);
      if (result && !result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't schedule follow-up task.",
        });
      } else {
        const dueLabel = due.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        toast.show({
          kind: "success",
          message: `Follow-up task created for ${dueLabel}.`,
        });
      }
      onClose();
    });
  }

  return (
    <div className="border-zinc-200 border-t bg-emerald-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-emerald-950/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-emerald-900 dark:text-emerald-100">Message sent</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-xs text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-emerald-800 text-xs dark:text-emerald-200">
          <Calendar className="h-3.5 w-3.5" />
          Schedule a follow-up?
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={pending}
            onClick={() => schedule(p.days)}
            className="rounded-full border border-emerald-300 bg-white px-3 py-1 font-medium text-emerald-900 text-xs hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-100 dark:hover:bg-zinc-800"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

/**
 * Inline "Acknowledge" button for a single mention card on the
 * /inbox/mentions feed. Calls acknowledgeOneMention for this note and
 * refreshes the server component so the card drops off the list.
 */

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { acknowledgeOneMention } from "../_actions";

export function AcknowledgeMentionButton({ noteId }: { noteId: string }) {
  const [pending, startTx] = useTransition();
  const router = useRouter();

  function ack() {
    startTx(async () => {
      const res = await acknowledgeOneMention(noteId);
      if (res.ok) {
        router.refresh();
      } else {
        alert(res.error ?? "Could not acknowledge mention.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={ack}
      disabled={pending}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Check className="h-3 w-3" aria-hidden="true" />
      )}
      Acknowledge
    </button>
  );
}

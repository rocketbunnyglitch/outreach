"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { autoPauseRisky, clearInboxWarmup, setInboxPaused, startInboxWarmup } from "../_actions";

export function PauseToggle({ id, paused }: { id: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setInboxPaused(id, !paused);
          router.refresh();
        })
      }
      className={
        paused
          ? "rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-[11px] text-emerald-700 disabled:opacity-50 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "rounded-md border border-zinc-300 px-2 py-0.5 font-medium text-[11px] text-zinc-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
      }
    >
      {pending ? "…" : paused ? "Resume cold" : "Pause cold"}
    </button>
  );
}

export function WarmupToggle({ id, warming }: { id: string; warming: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (warming) await clearInboxWarmup(id);
          else await startInboxWarmup(id);
          router.refresh();
        })
      }
      className="rounded-md border border-zinc-300 px-2 py-0.5 font-mono text-[10px] text-zinc-500 hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
      title={warming ? "Skip warm-up (jump to full cap)" : "(Re)start the 3-week warm-up ramp"}
    >
      {pending ? "…" : warming ? "skip warm-up" : "warm up"}
    </button>
  );
}

export function AutoPauseButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await autoPauseRisky();
          router.refresh();
          if (r.paused.length === 0) alert("No at-risk inboxes to pause.");
          else alert(`Paused cold sends on: ${r.paused.join(", ")}`);
        })
      }
      className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 font-medium text-rose-700 text-xs hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
    >
      {pending ? "Pausing…" : "Auto-pause at-risk inboxes"}
    </button>
  );
}

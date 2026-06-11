"use client";

/**
 * Per-action autonomy mode select (admin-only page). Flipping records
 * intent + audit; dispatch stays env-gated server-side regardless.
 */

import { useToast } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateAutonomyMode } from "../_actions";

const MODE_LABELS: Record<string, string> = {
  suggest: "Suggest (human executes)",
  review_window: "Review window (veto before act)",
  auto: "Auto (act + report)",
};

export function ModeSelect({ actionType, current }: { actionType: string; current: string }) {
  const [value, setValue] = useState(current);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function onChange(next: string) {
    const previous = value;
    setValue(next);
    const fd = new FormData();
    fd.set("actionType", actionType);
    fd.set("mode", next);
    startTx(async () => {
      const res = await updateAutonomyMode(null, fd);
      if (!res.ok) {
        setValue(previous);
        toast.show({ kind: "error", message: res.error ?? "Couldn't update the policy." });
        return;
      }
      toast.show({
        kind: "success",
        message: `${actionType} → ${next.replace("_", " ")}. Dispatch stays off until the server flag is set.`,
      });
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        aria-label={`Autonomy mode for ${actionType}`}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs transition-colors hover:border-zinc-400 focus:border-zinc-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {Object.entries(MODE_LABELS).map(([mode, label]) => (
          <option key={mode} value={mode}>
            {label}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
    </span>
  );
}

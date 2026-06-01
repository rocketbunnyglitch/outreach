"use client";

import { updateUserPreferences } from "@/app/(admin)/_actions/user-preferences";
import { useState, useTransition } from "react";

/**
 * Toggle for the daily-digest opt-in/opt-out.
 *
 * Optimistic UI: the switch flips immediately; the server write
 * runs in the background via useTransition. On failure we revert
 * the local state and show an inline error.
 *
 * The server action accepts the explicit boolean (NOT a tristate);
 * we never send null from here. Setting null is reserved for the
 * onboarding default which lives in lib/user-preferences (NULL
 * row = opted-in, the cron honors that).
 */
export function DailyDigestToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      try {
        await updateUserPreferences({ dailyDigestEnabled: next });
      } catch (err) {
        // Revert on failure -- the server write didn't land, so
        // the next page render would show the old value anyway,
        // but the local revert avoids a confusing flicker.
        setEnabled(!next);
        setError(err instanceof Error ? err.message : "Couldn't save preference");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Daily digest"
        disabled={pending}
        onClick={handleToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      {error && <p className="text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}

"use client";

/**
 * useOptimisticMutation — reusable optimistic update with toast-undo.
 *
 * Wraps a server action so callers get:
 *   1. Instant visual update (the new value renders before the server confirms)
 *   2. Pending state for showing spinners
 *   3. Error rollback (revert to prior value on failure)
 *   4. Optional undo toast (success toast with an Undo button that runs the
 *      inverse mutation)
 *
 * This is extracted from the patterns in `cold-outreach-table.tsx` and
 * `InlineCell` so other tables don't have to reinvent the wheel.
 *
 * Example — field-update on a row:
 *   const mutation = useOptimisticMutation<string>({
 *     run: async (next, prior) => {
 *       const fd = new FormData();
 *       fd.set("entryId", entry.id);
 *       fd.set("field", "status");
 *       fd.set("value", next);
 *       const result = await updateColdOutreachField(null, fd);
 *       return { ok: result.ok, error: result.error };
 *     },
 *     undoLabel: "Status changed",
 *     buildUndo: (next, prior) => async () => {
 *       const fd = new FormData();
 *       fd.set("entryId", entry.id);
 *       fd.set("field", "status");
 *       fd.set("value", prior);
 *       await updateColdOutreachField(null, fd);
 *     },
 *   });
 *
 *   // In the UI:
 *   await mutation.commit("interested", currentValue);
 *   mutation.pending   // boolean
 *   mutation.error     // string | null
 *   mutation.value     // optimistic value | last server-confirmed value
 */

import { useToast } from "@/components/ui/toast";
import { useCallback, useRef, useState } from "react";

export interface MutationResult {
  ok: boolean;
  error?: string;
}

export interface UseOptimisticMutationOptions<T> {
  /**
   * Run the actual server mutation. Receives the new value and (for context)
   * the prior server-confirmed value. Must return ok:true on success.
   */
  run: (next: T, prior: T) => Promise<MutationResult>;
  /**
   * Build the inverse mutation for the Undo toast button. Receives the same
   * (next, prior) the forward mutation got. Return a thunk that reverts.
   * If omitted, no Undo button is shown — the success toast is silent.
   */
  buildUndo?: (next: T, prior: T) => () => Promise<void>;
  /** Toast message on success. Default: "Saved." */
  successMessage?: string;
  /**
   * Toast label override. e.g. "Status changed". Used as the body of the
   * success toast when the optimistic value isn't human-friendly to show.
   */
  undoLabel?: string;
  /** Skip showing any toast (silent success). Default false. */
  silent?: boolean;
  /** Called after a successful commit (router.refresh, analytics, etc.) */
  onSuccess?: (next: T, prior: T) => void;
}

export interface UseOptimisticMutationReturn<T> {
  /** Optimistic value (or null if no in-flight change). */
  optimistic: T | null;
  /** Resolved value: optimistic if present, otherwise pass through. */
  resolved: (serverValue: T) => T;
  /** Whether a mutation is currently in-flight. */
  pending: boolean;
  /** Last error message, or null. Auto-clears after a successful commit. */
  error: string | null;
  /**
   * Commit a new value. Returns the MutationResult. Caller is responsible
   * for not double-firing if the value hasn't changed (the hook doesn't
   * de-dupe because it can't compare arbitrary T).
   */
  commit: (next: T, prior: T) => Promise<MutationResult>;
}

export function useOptimisticMutation<T>({
  run,
  buildUndo,
  successMessage,
  undoLabel,
  silent = false,
  onSuccess,
}: UseOptimisticMutationOptions<T>): UseOptimisticMutationReturn<T> {
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the latest call so a stale in-flight commit can't overwrite a newer one
  const callId = useRef(0);

  const resolved = useCallback(
    (serverValue: T): T => {
      return optimistic !== null ? optimistic : serverValue;
    },
    [optimistic],
  );

  const commit = useCallback(
    async (next: T, prior: T): Promise<MutationResult> => {
      const myCallId = ++callId.current;

      setOptimistic(next);
      setPending(true);
      setError(null);

      try {
        const result = await run(next, prior);
        if (myCallId !== callId.current) {
          // A newer commit superseded us; don't touch state
          return result;
        }

        if (!result.ok) {
          setOptimistic(null);
          setError(result.error ?? "Save failed.");
          if (!silent) {
            toast.show({ kind: "error", message: result.error ?? "Save failed." });
          }
          return result;
        }

        // Success path
        setPending(false);
        setError(null);
        // Don't immediately clear optimistic — let the parent's re-render
        // catch up first. This avoids a flicker between "optimistic"
        // and "server-confirmed but-not-yet-propagated".
        // The parent should call router.refresh() in onSuccess.
        onSuccess?.(next, prior);

        if (!silent) {
          toast.show({
            kind: "success",
            message: successMessage ?? undoLabel ?? "Saved.",
            undo: buildUndo ? buildUndo(next, prior) : undefined,
          });
        }
        return result;
      } catch (err) {
        if (myCallId !== callId.current) {
          // Stale, ignore
          return { ok: false, error: "Superseded by newer change." };
        }
        const msg = err instanceof Error ? err.message : "Save failed.";
        setOptimistic(null);
        setError(msg);
        setPending(false);
        if (!silent) {
          toast.show({ kind: "error", message: msg });
        }
        return { ok: false, error: msg };
      }
    },
    [run, buildUndo, successMessage, undoLabel, silent, onSuccess, toast],
  );

  return { optimistic, resolved, pending, error, commit };
}

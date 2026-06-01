"use client";

/**
 * useOptimisticAction — the canonical "click flips UI, server confirms,
 * rollback + toast on error" pattern.
 *
 * Use this instead of useTransition + setState + try/catch boilerplate
 * for any mutation that needs to feel instant. Three guarantees:
 *
 *   1. The next() updater fires synchronously inside startTransition
 *      so React commits the new value before the server roundtrip.
 *   2. If the action returns { ok: false } or throws, the previous
 *      value is restored and an error toast is shown.
 *   3. On success, the optimistic value stays (matching the
 *      authoritative server result), and an optional successToast
 *      is shown.
 *
 * Returns a stable `run` function plus a `pending` boolean (true
 * while the server roundtrip is in flight). The optimistic value
 * lives wherever the caller stores it — this hook does NOT own
 * state.
 *
 * Example:
 *
 *   const [status, setStatus] = useState(entry.status);
 *   const { run, pending } = useOptimisticAction({
 *     action: (next: string) =>
 *       updateColdOutreachField(entry.id, "status", next),
 *     onError: { tag: "cold.status" },
 *   });
 *
 *   function handleChange(next: string) {
 *     run({
 *       next: () => setStatus(next),
 *       rollback: (prev) => setStatus(prev),
 *       prev: status,
 *       arg: next,
 *     });
 *   }
 *
 * That replaces ~15 lines of useTransition + try/catch + toast.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { useCallback, useTransition } from "react";

interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface RunArgs<TPrev, TArg> {
  /** Apply the optimistic state change. Fires immediately. */
  next: () => void;
  /** Rollback if the action fails. Receives the captured prev value. */
  rollback: (prev: TPrev) => void;
  /** Previous value to capture for rollback. */
  prev: TPrev;
  /** Argument to pass to the action. */
  arg: TArg;
  /** Optional success message — toast.show fires on ok=true. */
  successMessage?: string;
}

interface HookOpts<TArg, TResult> {
  action: (arg: TArg) => Promise<ActionResult<TResult>>;
  onError?: {
    tag?: string;
    fallback?: string;
  };
}

export function useOptimisticAction<TPrev, TArg, TResult = unknown>(opts: HookOpts<TArg, TResult>) {
  const toast = useToast();
  const [pending, startTx] = useTransition();

  const run = useCallback(
    ({ next, rollback, prev, arg, successMessage }: RunArgs<TPrev, TArg>) => {
      // Fire the optimistic update FIRST so the UI reflects intent
      // before the server roundtrip starts. React batches this with
      // the transition below.
      next();
      startTx(async () => {
        try {
          const res = await opts.action(arg);
          if (!res.ok) {
            rollback(prev);
            const errorToast: Parameters<typeof toast.show>[0] = {
              kind: "error",
              message: res.error ?? opts.onError?.fallback ?? "Couldn't save.",
              tag: opts.onError?.tag,
            };
            if (res.code) errorToast.code = res.code;
            toast.show(errorToast);
            return;
          }
          if (successMessage) {
            toast.show({ kind: "success", message: successMessage });
          }
        } catch (err) {
          rollback(prev);
          const cap = captureClientError(err, {
            tag: opts.onError?.tag ?? "use-optimistic-action",
            fallback: opts.onError?.fallback ?? "Couldn't save.",
          });
          toast.show({
            kind: "error",
            message: cap.message,
            code: cap.code,
            tag: opts.onError?.tag,
          });
        }
      });
    },
    [opts, toast],
  );

  return { run, pending };
}

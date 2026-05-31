"use client";

import { cn } from "@/lib/cn";
import { CheckCircle2, ClipboardCopy, Loader2, Undo2, X, XCircle } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// =========================================================================
// Toast model
// =========================================================================

export interface Toast {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
  /** Optional undo handler. When set, the toast renders an Undo button
      that runs this handler. After it resolves, the toast morphs to
      'Restored' for a brief beat, then dismisses. */
  undo?: () => Promise<void>;
  /** Auto-dismiss timeout in ms. Default 5000 for success/info,
      6500 for error, ∞ if undo present (so the operator has time
      to react). */
  durationMs?: number;
  /**
   * Operator error code (E-XXXX-YYYY). When present on an error
   * toast, the toast renders the code in monospace + a "Copy"
   * button that puts a Claude-ready blob on the clipboard:
   *
   *   E-2K9P-7F3M · <toast message> · <action tag>
   *   URL: /city-campaigns/abc-123
   *   Time: 2026-05-31T20:42:00.123Z
   *
   * The operator pastes that into Claude / Claude Code with
   * "What does this mean?" and Claude can grep the matching log
   * line via docs/CLAUDE_TROUBLESHOOTING.md.
   */
  code?: string;
  /** Optional tag — short identifier of the action that produced
   *  the error, e.g. "inbox.send_reply". Goes into the copy blob. */
  tag?: string;
}

interface ToastContextValue {
  show: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Render-time fallback when used outside the provider — prevents
    // crashes in tests or accidentally-unwrapped trees. Logs to console
    // so the gap is loud in dev.
    return {
      show: () => {
        console.warn("[toast] used outside ToastProvider");
        return "";
      },
      dismiss: () => {},
    };
  }
  return ctx;
}

// =========================================================================
// Provider — mount once in the admin layout
// =========================================================================

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: Omit<Toast, "id">) => {
    idCounter.current += 1;
    const id = `toast-${idCounter.current}-${Date.now()}`;
    setToasts((prev) => [...prev.slice(-4), { ...input, id }]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// =========================================================================
// Viewport — fixed bottom-right stack
// =========================================================================

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:right-6 sm:left-auto sm:items-end"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

// =========================================================================
// ToastItem — individual toast with optional Undo
// =========================================================================

type ItemState = "showing" | "undoing" | "restored";

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [state, setState] = useState<ItemState>("showing");

  // Auto-dismiss timer. Re-armed any time the state changes.
  useEffect(() => {
    // No auto-dismiss while undo is in flight
    if (state === "undoing") return;

    // After Undo resolves, dismiss quickly so the 'Restored' state
    // doesn't linger.
    if (state === "restored") {
      const t = setTimeout(onDismiss, 1500);
      return () => clearTimeout(t);
    }

    // Default durations
    const defaultMs = toast.undo
      ? 8000 // longer when undo is available
      : toast.kind === "error"
        ? 6500
        : 5000;
    const ms = toast.durationMs ?? defaultMs;
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [state, onDismiss, toast.durationMs, toast.undo, toast.kind]);

  async function handleUndo() {
    if (!toast.undo) return;
    setState("undoing");
    try {
      await toast.undo();
      setState("restored");
    } catch {
      // If undo fails, surface that to the operator briefly
      setState("showing");
      onDismiss();
    }
  }

  const tone =
    state === "restored"
      ? "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      : toast.kind === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-100"
        : toast.kind === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-100"
          : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

  const Icon =
    state === "restored"
      ? Undo2
      : toast.kind === "error"
        ? XCircle
        : toast.kind === "success"
          ? CheckCircle2
          : null;

  return (
    <output
      className={cn(
        "pointer-events-auto flex max-w-[28rem] flex-col gap-1 rounded-lg border px-4 py-2.5 shadow-lg transition-all",
        "translate-y-0 opacity-100",
        tone,
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}

        <p className="flex-1 text-sm leading-snug">
          {state === "restored" ? "Restored." : toast.message}
        </p>

        {state === "showing" && toast.undo && (
          <button
            type="button"
            onClick={handleUndo}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-current/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors hover:bg-current/10"
          >
            <Undo2 className="h-2.5 w-2.5" />
            Undo
          </button>
        )}

        {state === "undoing" && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] opacity-60">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Undoing…
          </span>
        )}

        {state !== "undoing" && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 opacity-40 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Error code row — visible only on error toasts that have a
          code attached. The "Copy" button puts a Claude-ready blob
          on the clipboard so the operator can paste it into a chat
          with the question "what does this mean?". */}
      {toast.code && toast.kind === "error" && state === "showing" && (
        <ErrorCodeRow code={toast.code} message={toast.message} tag={toast.tag} />
      )}
    </output>
  );
}

/**
 * The "code + copy" row on error toasts. Pulled into its own
 * component because the copy handler closes over the toast
 * details + needs its own copied-state for the brief "Copied"
 * confirmation.
 */
function ErrorCodeRow({
  code,
  message,
  tag,
}: {
  code: string;
  message: string;
  tag?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const blob = buildClaudeBlob({ code, message, tag });
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard permission denied or unavailable — fall back to
      // a hidden textarea + execCommand. Best-effort; if both fail
      // the operator can still see + retype the code from the toast.
      try {
        const ta = document.createElement("textarea");
        ta.value = blob;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // Give up silently — the code is visible on the toast either way.
      }
    }
  }

  return (
    <div className="flex items-center gap-2 pl-7">
      <code className="font-mono text-[10px] tracking-[0.05em] opacity-70">{code}</code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded border border-current/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors hover:bg-current/10"
        title="Copy a Claude-ready blob to your clipboard. Paste into a Claude chat with 'what does this mean?'"
      >
        <ClipboardCopy className="h-2.5 w-2.5" />
        {copied ? "Copied" : "Copy for Claude"}
      </button>
    </div>
  );
}

function buildClaudeBlob({
  code,
  message,
  tag,
}: {
  code: string;
  message: string;
  tag?: string;
}): string {
  const url =
    typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
  const time = new Date().toISOString();
  const lines = [
    `Error code: ${code}`,
    `Message: ${message}`,
    tag ? `Action: ${tag}` : null,
    `URL: ${url}`,
    `Time: ${time}`,
    "",
    "Please diagnose this for me. Grep the PM2 logs for the error code to find the matching log entry. See docs/CLAUDE_TROUBLESHOOTING.md in the repo for the codebase tour.",
  ].filter(Boolean);
  return lines.join("\n");
}

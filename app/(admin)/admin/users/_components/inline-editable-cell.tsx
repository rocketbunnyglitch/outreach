"use client";

/**
 * InlineEditableCell — single-line click-to-edit text input that
 * commits on blur or Enter, reverts on Escape, and surfaces server
 * errors inline.
 *
 * Used by the users-table for Name, Email, and Password (with
 * type='password' the value is never displayed; click toggles to
 * empty input and commit sets a new password).
 *
 * Callers pass an async `commit(value)` that returns
 * { ok: true } | { ok: false, error }. On success we adopt the new
 * value as the displayed text. On failure we revert and show the
 * error.
 */

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

export interface InlineCommitResult {
  ok: boolean;
  error?: string;
}

export function InlineEditableCell({
  value,
  type = "text",
  placeholder,
  ariaLabel,
  disabled = false,
  /** Commit handler — should round-trip the value to the server. */
  commit,
  /** Override the visible text (e.g. password shows '••••••••' but
   *  the input field for editing starts empty). */
  displayValue,
  className,
}: {
  value: string;
  type?: "text" | "email" | "password";
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  commit: (newValue: string) => Promise<InlineCommitResult>;
  displayValue?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTx] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    if (disabled) return;
    setError(null);
    // For password fields, start with an empty draft — never echo
    // the existing value, even though we don't have it client-side
    // anyway.
    setDraft(type === "password" ? "" : value);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    setError(null);
  }

  function trySubmit() {
    const next = draft.trim();
    // Empty draft: treat as cancel for non-password fields. Password
    // empty submit also cancels (we don't accept blank passwords).
    if (!next) {
      cancel();
      return;
    }
    if (next === value && type !== "password") {
      // No change, no commit.
      setEditing(false);
      return;
    }
    setError(null);
    startTx(async () => {
      const result = await commit(next);
      if (result.ok) {
        setEditing(false);
      } else {
        setError(result.error ?? "Update failed.");
        // Stay in edit mode so the operator can fix it.
      }
    });
  }

  const shown = displayValue ?? value;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        disabled={disabled}
        aria-label={`Edit ${ariaLabel}`}
        className={`group inline-block max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-text"
        } ${className ?? ""}`}
      >
        <span className="truncate">
          {shown || <span className="text-zinc-400">{placeholder ?? "—"}</span>}
        </span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // Defer so click handlers on adjacent buttons fire first.
          setTimeout(() => {
            if (!editing) return; // already committed
            trySubmit();
          }, 100);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            trySubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder={placeholder}
        disabled={isPending}
        className={`min-w-[10ch] rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900 ${className ?? ""}`}
      />
      {isPending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
      {error && (
        <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </span>
      )}
    </span>
  );
}

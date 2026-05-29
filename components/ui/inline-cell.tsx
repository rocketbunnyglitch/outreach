"use client";

import { cn } from "@/lib/cn";
import { Loader2, Pencil } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

interface Props {
  /** Current value (server-confirmed). Inline edits start from this. */
  value: string;
  /** Placeholder shown when value is empty. */
  placeholder?: string;
  /** Mono font + sizing for email/phone-style cells. */
  variant?: "default" | "mono" | "subtle";
  /** Validate before committing. Return error string to reject; null to accept. */
  validate?: (next: string) => string | null;
  /** Server action. Should resolve to { ok, error? }. */
  onCommit: (next: string) => Promise<{ ok: boolean; error?: string }>;
  /** input type — default text, can be 'email' or 'tel' for validation hints. */
  inputType?: "text" | "email" | "tel" | "url";
  /** Display transformer: format the value differently from how it's stored. */
  format?: (value: string) => string;
  /** Max width — keeps long emails/URLs from blowing out the column. */
  maxWidth?: number;
  /** Disable the edit affordance (e.g. while bulk operations are pending). */
  disabled?: boolean;
  /** Aria-label for the input. */
  label?: string;
  /**
   * Logical cell id, e.g. "venue:abc:capacity". Used for presence/realtime
   * to identify which cell is currently being edited by which staffer.
   * When provided, the parent receives focus change callbacks.
   */
  cellId?: string;
  /**
   * Called when this cell enters or leaves edit mode. The argument is the
   * cellId (entering) or null (leaving). Use to update presence state.
   */
  onFocusChange?: (cellId: string | null) => void;
  /**
   * Another staffer is focused on this cell. Renders a colored border +
   * corner pill in their assigned color so the local user knows not to
   * edit at the same time.
   */
  peerFocus?: {
    displayName: string;
    /** Tailwind classes from colorForStaff() — typically just `ring` and `bg`. */
    color: { bg: string; ring: string; text: string };
  } | null;
  /**
   * Grid coordinates for arrow-key navigation. When BOTH are provided,
   * the cell's trigger button gets a `data-grid-cell="r:c"` attribute
   * which the parent table's useGridArrowNav hook reads to move focus
   * between neighboring cells.
   *
   * After Enter-in-edit commits, focus auto-moves down a row (Sheets
   * convention). After Escape, focus returns to the cell's own button.
   */
  gridRow?: number;
  gridCol?: number;
  /**
   * Allow the displayed value to wrap onto multiple lines instead of
   * being truncated. Defaults to false (single line, truncated with
   * ellipsis) to preserve the existing Sheets-like behavior for every
   * caller that doesn't opt in. Useful for narrow columns where the
   * value is more readable wrapping than truncated (e.g. venue names
   * in the cold-outreach table where the column is sized for the
   * common case but occasional long names should still be visible).
   */
  allowWrap?: boolean;
}

/**
 * Sheets-quality inline cell editor.
 *
 * Click to enter edit mode. Type. Press Enter or Tab to commit. Esc
 * to cancel. Click outside also commits (matches Sheets exactly).
 *
 * Optimistic UI: the new value renders immediately while the server
 * action runs in the background. On error, reverts to the prior
 * server-confirmed value and surfaces the error via a small inline
 * hint.
 *
 * No-op when the value hasn't changed, so accidental click-out
 * doesn't generate noise.
 *
 * Affordance: subtle pencil icon appears on row hover (group-hover)
 * so the cell looks like static text in calm states but signals
 * "I'm editable" when the operator is interacting with that row.
 */
export function InlineCell({
  value,
  placeholder = "—",
  variant = "default",
  validate,
  onCommit,
  inputType = "text",
  format,
  maxWidth,
  disabled,
  label,
  cellId,
  onFocusChange,
  peerFocus,
  gridRow,
  gridCol,
  allowWrap = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Tracks where focus should go after a successful commit. Set in
  // onKeyDown depending on which key the operator pressed.
  const postCommitDirRef = useRef<"down" | "right" | "self" | null>(null);

  // After a successful commit, move focus per postCommitDirRef. Runs
  // when `pending` flips back to false AND there's no error.
  useEffect(() => {
    if (pending) return;
    if (error) return;
    const dir = postCommitDirRef.current;
    if (!dir) return;
    postCommitDirRef.current = null;

    if (dir === "self") {
      buttonRef.current?.focus();
      return;
    }
    if (gridRow == null || gridCol == null) return;
    const nextRow = dir === "down" ? gridRow + 1 : gridRow;
    const nextCol = dir === "right" ? gridCol + 1 : gridCol;
    // Tiny defer so React's commit phase finishes before we hunt for
    // the next button in the DOM (it may have just rendered).
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLButtonElement>(
        `[data-grid-cell="${nextRow}:${nextCol}"]`,
      );
      if (next) next.focus();
      else buttonRef.current?.focus();
    });
  }, [pending, error, gridRow, gridCol]);

  // Sync draft + clear optimistic on incoming prop change (server source-of-truth)
  useEffect(() => {
    setDraft(value);
    setOptimistic(null);
  }, [value]);

  // Focus + select all when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Notify parent on focus enter/leave (for presence tracking)
  useEffect(() => {
    if (!onFocusChange) return;
    onFocusChange(editing ? (cellId ?? null) : null);
  }, [editing, cellId, onFocusChange]);

  // Clear stale error after 4s so the row resettles
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  function startEdit() {
    if (disabled) return;
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const next = draft.trim();

    // No-op when unchanged. Still respect postCommitDirRef so Enter
    // on an unchanged cell still moves focus down (matches Sheets).
    if (next === value.trim()) {
      const dir = postCommitDirRef.current;
      postCommitDirRef.current = null;
      if (dir === "self") {
        requestAnimationFrame(() => buttonRef.current?.focus());
        return;
      }
      if (dir && gridRow != null && gridCol != null) {
        const nextRow = dir === "down" ? gridRow + 1 : gridRow;
        const nextCol = dir === "right" ? gridCol + 1 : gridCol;
        requestAnimationFrame(() => {
          const target = document.querySelector<HTMLButtonElement>(
            `[data-grid-cell="${nextRow}:${nextCol}"]`,
          );
          if (target) target.focus();
          else buttonRef.current?.focus();
        });
      }
      return;
    }

    // Local validation
    if (validate) {
      const verr = validate(next);
      if (verr) {
        setError(verr);
        return;
      }
    }

    // Optimistic update — render the new value instantly
    setOptimistic(next);
    setPending(true);
    setError(null);

    try {
      const result = await onCommit(next);
      if (!result.ok) {
        setOptimistic(null);
        setError(result.error ?? "Save failed.");
      }
      // On success, the parent will re-render with the new value
      // (via router.refresh()) and the useEffect above will clear
      // `optimistic`.
    } catch (err) {
      setOptimistic(null);
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setPending(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    setError(null);
    // Pull focus back to the cell's trigger so arrow nav can continue
    // without an extra Tab. requestAnimationFrame avoids racing the
    // editing→non-editing render.
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      postCommitDirRef.current = "down";
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      postCommitDirRef.current = "self";
      cancel();
    } else if (e.key === "Tab") {
      // Default tab behavior also fires — focus will move to the next
      // tabbable element. We set 'right' so that if the table has a
      // sparse tab order, we still snap to the grid-right cell.
      postCommitDirRef.current = "right";
      commit();
    }
  }

  const displayValue = optimistic ?? value;
  const isEmpty = !displayValue;
  const formatted = format && displayValue ? format(displayValue) : displayValue;

  // Variant styling
  const baseFont =
    variant === "mono"
      ? "font-mono text-[11px]"
      : variant === "subtle"
        ? "text-[11px] text-zinc-600 dark:text-zinc-400"
        : "text-sm";

  if (editing) {
    return (
      <div className="relative flex items-center gap-1">
        <input
          ref={inputRef}
          type={inputType}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          aria-label={label}
          className={cn(
            "w-full rounded-sm border border-blue-500/40 bg-white px-1.5 py-0.5 outline-none ring-2 ring-blue-500/20 transition-all dark:bg-zinc-900",
            baseFont,
          )}
          style={maxWidth ? { maxWidth } : undefined}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/cell relative inline-flex max-w-full items-center gap-1 rounded-sm",
        peerFocus && cn("ring-2 ring-offset-1 dark:ring-offset-zinc-950", peerFocus.color.ring),
      )}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={startEdit}
        onKeyDown={(e) => {
          // Arrow nav happens at the table level via useGridArrowNav.
          // We only handle Enter / F2 here to enter edit mode without
          // a mouse click. (Browsers already fire onClick on Enter for
          // a focused button, so technically only F2 is custom here.)
          if (e.key === "F2") {
            e.preventDefault();
            startEdit();
          }
        }}
        data-grid-cell={gridRow != null && gridCol != null ? `${gridRow}:${gridCol}` : undefined}
        disabled={disabled}
        aria-label={label ?? "Edit"}
        className={cn(
          "block rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-blue-500/[0.07] dark:hover:bg-blue-400/[0.08]",
          // allowWrap: let long values break across lines (e.g. venue
          // names in a narrow column). Default: truncate to a single
          // line with ellipsis (Sheets-like).
          allowWrap ? "whitespace-normal break-words" : "truncate",
          baseFont,
          isEmpty ? "text-zinc-400" : "text-zinc-900 dark:text-zinc-100",
          pending && "opacity-60",
          error && "ring-1 ring-rose-500/40",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
        style={maxWidth ? { maxWidth } : undefined}
        title={
          peerFocus
            ? `${peerFocus.displayName} is editing this cell`
            : (error ?? (isEmpty ? "Click to add" : "Click to edit"))
        }
      >
        {isEmpty ? placeholder : formatted}
      </button>
      {pending && (
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-blue-500" aria-hidden="true" />
      )}
      {!pending && !disabled && !editing && !peerFocus && (
        <Pencil
          className="h-2.5 w-2.5 shrink-0 text-zinc-300 opacity-0 transition-opacity group-hover/cell:opacity-100 dark:text-zinc-600"
          aria-hidden="true"
        />
      )}
      {peerFocus && (
        <span
          className={cn(
            "-top-2 -right-2 pointer-events-none absolute z-10 rounded-full border border-white px-1 font-medium font-mono text-[9px] text-white leading-tight shadow-sm dark:border-zinc-950",
            peerFocus.color.bg,
          )}
          aria-label={`${peerFocus.displayName} is editing`}
          title={`${peerFocus.displayName} is editing this cell`}
        >
          {peerFocus.displayName
            .split(/\s+/)
            .map((p) => p.charAt(0))
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
      )}
      {error && (
        <span
          className="pointer-events-none absolute top-full left-0 z-10 mt-0.5 whitespace-nowrap rounded-md bg-rose-600 px-2 py-1 font-mono text-[10px] text-white shadow-md dark:bg-rose-500"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}

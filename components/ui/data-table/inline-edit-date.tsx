"use client";

/**
 * InlineEditDate — Sheets-style inline date cell.
 *
 * Native <input type="date"> for simplicity — it gives us a calendar UI
 * on every modern browser without bringing in a date-picker library. The
 * value is stored and committed as ISO-8601 date (yyyy-MM-dd); display
 * is locale-formatted.
 *
 * If we later need time-of-day or timezone-aware editing, swap this for
 * a richer picker (react-day-picker + chrono-node — already in deps).
 * For dates like "follow up on", "starts at", "received at" — most
 * outreach work — the native picker is enough.
 *
 * Behavior matches InlineCell:
 *   • Optimistic update
 *   • Pending spinner
 *   • Inline error pill
 *   • No-op when value unchanged
 *   • Clear via empty string commit (parent decides if nullable)
 */

import { cn } from "@/lib/cn";
import { Calendar, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  /** Current value in ISO format (yyyy-MM-dd) or empty string for unset. */
  value: string;
  /** Server action; resolves to { ok, error? }. Receives ISO string or empty. */
  onCommit: (next: string) => Promise<{ ok: boolean; error?: string }>;
  /** Allow clearing the date (renders an X button). Default true. */
  clearable?: boolean;
  /** Placeholder when value is empty. */
  placeholder?: string;
  /** Display format function. Default: locale date string (Apr 17). */
  format?: (iso: string) => string;
  /** Disable the control. */
  disabled?: boolean;
  /** Aria-label. */
  label?: string;
  /** Compact mode for dense tables. */
  compact?: boolean;
  /** Min/max date constraints (ISO format). */
  min?: string;
  max?: string;
}

const DEFAULT_FORMAT = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

export function InlineEditDate({
  value,
  onCommit,
  clearable = true,
  placeholder = "—",
  format = DEFAULT_FORMAT,
  disabled,
  label,
  compact = false,
  min,
  max,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
    setOptimistic(null);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  async function commit(next: string) {
    setEditing(false);
    if (next === value) return; // no-op
    setOptimistic(next);
    setPending(true);
    setError(null);
    try {
      const result = await onCommit(next);
      if (!result.ok) {
        setOptimistic(null);
        setError(result.error ?? "Save failed.");
      }
    } catch (err) {
      setOptimistic(null);
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setPending(false);
    }
  }

  const displayValue = optimistic ?? value;
  const isEmpty = !displayValue;
  const sizeClasses = compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm";

  if (editing) {
    return (
      <div className="relative inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="date"
          value={draft}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value);
              setEditing(false);
            }
          }}
          aria-label={label}
          className={cn(
            "rounded-sm border border-blue-500/40 bg-white outline-none ring-2 ring-blue-500/20 transition-all dark:bg-zinc-900",
            sizeClasses,
          )}
        />
      </div>
    );
  }

  return (
    <div className="group/cell relative inline-flex max-w-full items-center gap-1">
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        aria-label={label ?? "Edit date"}
        className={cn(
          "rounded-sm text-left transition-colors hover:bg-blue-500/[0.07] dark:hover:bg-blue-400/[0.08]",
          sizeClasses,
          isEmpty ? "text-zinc-400" : "text-zinc-900 dark:text-zinc-100",
          pending && "opacity-60",
          error && "ring-1 ring-rose-500/40",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
        title={error ?? (isEmpty ? "Click to set" : "Click to edit")}
      >
        {isEmpty ? placeholder : format(displayValue)}
      </button>
      {pending && (
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-blue-500" aria-hidden="true" />
      )}
      {!pending && !disabled && !isEmpty && clearable && (
        <button
          type="button"
          onClick={() => commit("")}
          aria-label="Clear date"
          className="shrink-0 text-zinc-300 opacity-0 transition-opacity hover:text-rose-500 group-hover/cell:opacity-100 dark:text-zinc-600"
        >
          <X className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
      )}
      {!pending && !disabled && isEmpty && (
        <Calendar
          className="h-2.5 w-2.5 shrink-0 text-zinc-300 opacity-0 transition-opacity group-hover/cell:opacity-100 dark:text-zinc-600"
          aria-hidden="true"
        />
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

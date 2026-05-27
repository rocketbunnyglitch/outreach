"use client";

/**
 * InlineEditSelect — Sheets-style inline dropdown.
 *
 * Matches the visual and behavioral language of InlineCell (the text
 * inline editor). Use for status enums, staff assignment, anything
 * where the operator picks one option from a known list.
 *
 * Behavior:
 *   • Looks like static text until hovered (chevron appears)
 *   • Click → native <select> opens; choosing fires onCommit immediately
 *   • Optimistic: the new label renders before the server confirms
 *   • Pending state shows a spinner; error reverts with an inline pill
 *   • Variant 'pill' renders as a colored chip (status enums); 'plain'
 *     renders as a label (assignee names)
 *
 * Example:
 *   <InlineEditSelect
 *     value={row.status}
 *     options={[
 *       { value: "lead",       label: "Lead",       tone: "text-zinc-500 bg-zinc-100" },
 *       { value: "interested", label: "Interested", tone: "text-emerald-700 bg-emerald-50" },
 *       { value: "declined",   label: "Declined",   tone: "text-rose-700 bg-rose-50" },
 *     ]}
 *     variant="pill"
 *     onCommit={async (next) => await updateStatusAction(row.id, next)}
 *   />
 */

import { cn } from "@/lib/cn";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional Tailwind classes applied when this option is the current value (pill variant). */
  tone?: string;
  /** Disable selection of this option. */
  disabled?: boolean;
}

interface Props {
  /** Current value (server-confirmed). */
  value: string;
  /** Options to choose from. */
  options: SelectOption[];
  /** Server action to run on commit. Resolves to { ok, error? }. */
  onCommit: (next: string) => Promise<{ ok: boolean; error?: string }>;
  /** Visual style: "pill" (status chip) | "plain" (label-like). Default "plain". */
  variant?: "pill" | "plain";
  /** Placeholder label when value is empty / unmatched. */
  placeholder?: string;
  /** Disable the control. */
  disabled?: boolean;
  /** Aria-label for the select. */
  label?: string;
  /** Compact mode reduces padding for dense tables. Default false. */
  compact?: boolean;
}

export function InlineEditSelect({
  value,
  options,
  onCommit,
  variant = "plain",
  placeholder = "—",
  disabled,
  label,
  compact = false,
}: Props) {
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Sync optimistic state when the server value changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the prop that drives the reset
  useEffect(() => {
    setOptimistic(null);
  }, [value]);

  // Auto-clear stale error
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const displayValue = optimistic ?? value;
  const displayOption = options.find((o) => o.value === displayValue);

  async function handleChange(next: string) {
    if (next === value) return;
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

  const sizeClasses = compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm";
  const pillClasses =
    variant === "pill"
      ? cn(
          "rounded-md font-medium font-mono text-[10px] uppercase tracking-[0.08em]",
          displayOption?.tone ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        )
      : "rounded-sm";

  return (
    <div className="group/cell relative inline-flex max-w-full items-center gap-1">
      <select
        ref={selectRef}
        value={displayValue}
        disabled={disabled || pending}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={label}
        className={cn(
          "w-full appearance-none border border-transparent bg-transparent transition-colors",
          "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
          "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
          sizeClasses,
          pillClasses,
          pending && "opacity-70",
          error && "ring-1 ring-rose-500/40",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {!displayOption && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {pending ? (
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-blue-500" aria-hidden="true" />
      ) : (
        !disabled && (
          <ChevronDown
            className="h-2.5 w-2.5 shrink-0 text-zinc-300 opacity-0 transition-opacity group-hover/cell:opacity-100 dark:text-zinc-600"
            aria-hidden="true"
          />
        )
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

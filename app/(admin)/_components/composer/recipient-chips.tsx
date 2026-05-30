"use client";

/**
 * RecipientChips — input that converts typed emails into removable
 * chips. Pressing Enter / Tab / comma commits the typed value as a
 * new chip; Backspace on an empty input removes the previous chip.
 *
 * Validation: each chip is tagged valid/invalid by a simple regex.
 * Invalid chips render rose-tinted with a tooltip explaining the
 * issue. The composer's send-time validation is the source of truth;
 * this is a fast feedback layer so operators notice typos as they
 * type.
 *
 * Why not a heavy dep (react-multi-email, etc.):
 *   The chip pattern is ~80 lines of JSX. Adding a dependency for
 *   it would balloon the bundle for no real gain. We keep it inline
 *   + composable.
 */

import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import { useRef, useState } from "react";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Aria label for the screen reader user. */
  ariaLabel?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RecipientChips({ value, onChange, placeholder, ariaLabel }: Props) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commitTyped() {
    const t = typed.trim().replace(/[,;]+$/, "");
    if (!t) return;
    // Avoid duplicates (case-insensitive). The list itself stores
    // whatever case the operator typed first — most mail servers
    // are case-insensitive on the local part anyway, but we preserve
    // operator intent in display.
    const lower = t.toLowerCase();
    if (value.some((v) => v.toLowerCase() === lower)) {
      setTyped("");
      return;
    }
    onChange([...value, t]);
    setTyped("");
  }

  function removeAt(i: number) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: container click only focuses input
    <div
      className="flex flex-1 flex-wrap items-center gap-1"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((addr) => {
        const valid = EMAIL_RE.test(addr);
        const idx = value.indexOf(addr);
        return (
          <span
            key={addr}
            title={valid ? addr : `Invalid email: ${addr}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]",
              valid
                ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
            )}
          >
            <span className="max-w-[180px] truncate">{addr}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeAt(idx);
              }}
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              aria-label={`Remove ${addr}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        type="text"
        value={typed}
        onChange={(e) => {
          // Commit on comma/semicolon so paste-from-spreadsheet works.
          if (/[,;]/.test(e.target.value)) {
            const parts = e.target.value
              .split(/[,;]/)
              .map((p) => p.trim())
              .filter(Boolean);
            const next: string[] = [...value];
            for (const p of parts) {
              const lower = p.toLowerCase();
              if (!next.some((v) => v.toLowerCase() === lower)) next.push(p);
            }
            onChange(next);
            setTyped("");
            return;
          }
          setTyped(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            if (typed.trim()) {
              e.preventDefault();
              commitTyped();
            }
          } else if (e.key === "Backspace" && !typed && value.length > 0) {
            removeAt(value.length - 1);
          }
        }}
        onBlur={() => commitTyped()}
        placeholder={value.length === 0 ? placeholder : ""}
        aria-label={ariaLabel}
        className="min-w-[120px] flex-1 bg-transparent text-xs outline-none"
      />
    </div>
  );
}

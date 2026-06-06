"use client";

/**
 * RecipientChips — input that converts typed emails into removable
 * chips. Pressing Enter / Tab / comma commits the typed value as a
 * new chip; Backspace on an empty input removes the previous chip.
 *
 * Autocomplete: when a `suggestions` callback is supplied, typing
 * 2+ chars triggers a debounced fetch + renders a popover below the
 * input. Arrow keys navigate, Enter commits the highlighted entry,
 * Esc closes the popover (but doesn't clear the typed value).
 *
 * Validation: each chip is tagged valid/invalid by a simple regex.
 * Invalid chips render rose-tinted with a tooltip explaining the
 * issue. The composer's send-time validation is the source of truth;
 * this is a fast feedback layer so operators notice typos as they
 * type.
 *
 * Why not a heavy dep (react-multi-email, etc.):
 *   The chip pattern is ~150 lines of JSX. Adding a dependency for
 *   it would balloon the bundle for no real gain. We keep it inline
 *   + composable.
 */

import { cn } from "@/lib/cn";
import { Mail, MailQuestion, UserCircle, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface RecipientSuggestion {
  email: string;
  source: "venue_primary" | "venue_alt" | "venue_thread" | "team_recent" | "gmail_contact";
  label?: string | null;
}

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Aria label for the screen reader user. */
  ariaLabel?: string;
  /** Optional async callback that returns address suggestions for
   *  the operator's current typed query. When provided, a popover
   *  appears once the typed value is 2+ chars. */
  suggestions?: (query: string) => Promise<RecipientSuggestion[]>;
  /** Mirror of the not-yet-committed typed text. The composer reads this on
   *  send so a recipient typed-but-not-Entered still goes out -- otherwise
   *  clicking Send before committing the chip dropped the address ("add at
   *  least one recipient"). Kept in sync every render. */
  pendingRef?: { current: string };
  /** Optional email -> display-name map. When an address has a known name
   *  (venue / the name the mail came in as), the chip shows the NAME with
   *  the email on hover, Gmail-style, instead of the raw address. */
  names?: Record<string, string>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUGGESTION_DEBOUNCE_MS = 180;

export function RecipientChips({
  value,
  onChange,
  placeholder,
  ariaLabel,
  suggestions,
  pendingRef,
  names,
}: Props) {
  const [typed, setTyped] = useState("");
  // Keep the parent's mirror current with whatever is half-typed in the input.
  if (pendingRef) pendingRef.current = typed;
  const [showPopover, setShowPopover] = useState(false);
  const [matches, setMatches] = useState<RecipientSuggestion[]>([]);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside closes popover (but doesn't clear typed).
  useEffect(() => {
    if (!showPopover) return;
    function onDoc(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showPopover]);

  // Debounced suggestion fetch.
  useEffect(() => {
    if (!suggestions) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = typed.trim();
    if (q.length < 2) {
      setMatches([]);
      setShowPopover(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const fresh = await suggestions(q);
        // Filter out addresses already in the chip list.
        const lowerValue = new Set(value.map((v) => v.toLowerCase()));
        const filtered = fresh.filter((s) => !lowerValue.has(s.email.toLowerCase()));
        setMatches(filtered);
        setShowPopover(filtered.length > 0);
        setHighlightedIdx(0);
      } catch {
        // Non-fatal — the operator can still type the address manually.
      }
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [typed, suggestions, value]);

  function commitTyped() {
    const t = typed.trim().replace(/[,;]+$/, "");
    if (!t) return;
    const lower = t.toLowerCase();
    if (value.some((v) => v.toLowerCase() === lower)) {
      setTyped("");
      return;
    }
    onChange([...value, t]);
    setTyped("");
    setShowPopover(false);
  }

  function commitSuggestion(s: RecipientSuggestion) {
    const lower = s.email.toLowerCase();
    if (value.some((v) => v.toLowerCase() === lower)) {
      setTyped("");
      setShowPopover(false);
      return;
    }
    onChange([...value, s.email]);
    setTyped("");
    setShowPopover(false);
    inputRef.current?.focus();
  }

  function removeAt(i: number) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }

  return (
    <div
      ref={wrapperRef}
      className="relative flex flex-1 flex-wrap items-center gap-1"
      onClick={() => inputRef.current?.focus()}
      onKeyDown={(e) => {
        // Container forwards focus to the input for any non-modifier
        // key; the input itself owns the actual keyboard interaction.
        if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
          inputRef.current?.focus();
        }
      }}
      role="group"
      aria-label={ariaLabel}
    >
      {value.map((addr) => {
        const valid = EMAIL_RE.test(addr);
        const idx = value.indexOf(addr);
        const name = names?.[addr.toLowerCase()] ?? names?.[addr];
        return (
          <span
            key={addr}
            title={valid ? (name ? `${name} <${addr}>` : addr) : `Invalid email: ${addr}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
              name ? "font-sans" : "font-mono",
              valid
                ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
            )}
          >
            <span className="max-w-[180px] truncate">{name ?? addr}</span>
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
          if (showPopover && matches.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIdx((i) => (i + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIdx((i) => (i - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setShowPopover(false);
              return;
            }
            if (e.key === "Enter") {
              const pick = matches[highlightedIdx];
              if (pick) {
                e.preventDefault();
                commitSuggestion(pick);
                return;
              }
            }
          }
          if (e.key === "Enter" || e.key === "Tab") {
            if (typed.trim()) {
              e.preventDefault();
              commitTyped();
            }
          } else if (e.key === "Backspace" && !typed && value.length > 0) {
            removeAt(value.length - 1);
          }
        }}
        onFocus={() => {
          if (matches.length > 0) setShowPopover(true);
        }}
        onBlur={() => {
          // Delay so a click on a suggestion still registers before blur
          // clears the popover.
          setTimeout(() => {
            commitTyped();
          }, 100);
        }}
        placeholder={value.length === 0 ? placeholder : ""}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={showPopover ? "recipient-suggestions" : undefined}
        className="min-w-[120px] flex-1 bg-transparent text-xs outline-none"
      />
      {showPopover && matches.length > 0 && (
        <div
          id="recipient-suggestions"
          role="listbox"
          tabIndex={-1}
          className="absolute top-full left-0 z-20 mt-1 max-h-72 w-full min-w-[280px] overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900"
        >
          {matches.map((m, i) => (
            <button
              key={`${m.email}-${m.source}`}
              type="button"
              role="option"
              aria-selected={i === highlightedIdx}
              onMouseDown={(e) => {
                // Prevent input blur before click registers.
                e.preventDefault();
              }}
              onClick={() => commitSuggestion(m)}
              onMouseEnter={() => setHighlightedIdx(i)}
              className={cn(
                // Explicit text color — without it the email inherited a
                // dark color and rendered dark-on-dark (unreadable) in the
                // dark-mode popover.
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-800 dark:text-zinc-100",
                i === highlightedIdx
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
              )}
            >
              <SourceIcon source={m.source} />
              <span className="flex-1 truncate">{m.email}</span>
              {m.label && (
                <span className="truncate font-mono text-[9px] text-zinc-500">{m.label}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceIcon({ source }: { source: RecipientSuggestion["source"] }) {
  const cls = "h-3 w-3 shrink-0";
  switch (source) {
    case "venue_primary":
      return <Mail className={`${cls} text-emerald-500`} />;
    case "venue_alt":
      return <MailQuestion className={`${cls} text-emerald-400`} />;
    case "venue_thread":
      return <Mail className={`${cls} text-blue-500`} />;
    case "team_recent":
      return <Users className={`${cls} text-zinc-400`} />;
    case "gmail_contact":
      return <UserCircle className={`${cls} text-violet-500`} />;
    default:
      return <Mail className={cls} />;
  }
}

"use client";

/**
 * SubjectSuggestButton — Tier S #3 of the Haiku ROI sprint.
 *
 * Renders a ✨ button inside the composer's subject input row.
 * Click → calls suggestEmailSubject → opens a small popover with
 * 3 subject options. Click a chip → applies that subject to the
 * draft + closes the popover.
 *
 * Disabled when:
 *   - the draft body is too short (< 30 chars)
 *   - request is in flight
 *
 * Cost characteristics:
 *   - ~$0.0009/call with Haiku 4.5
 *   - 30/min per staff rate limit (see lib/ai-guardrails.ts)
 *
 * Operator UX:
 *   - Tooltip on the disabled state explains the body-too-short
 *     gate so it doesn't feel broken.
 *   - Click outside the popover closes it (matches every other
 *     menu in the app).
 *   - Esc closes.
 *   - Selecting a chip surfaces a toast briefly so the operator
 *     knows the subject changed.
 */

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { suggestEmailSubject } from "../../_actions/ai-actions";

interface Props {
  /** Current draft body — required, the suggestion is body-driven. */
  bodyText: string;
  /** Currently typed subject (passed to the model so suggestions
   *  feel like alternatives, not random picks). */
  currentSubject: string;
  /** Recipient context for tone calibration. All optional. */
  recipientName?: string | null;
  recipientEmail?: string | null;
  venueName?: string | null;
  cityName?: string | null;
  /** "cold" or "reply" — drives prompt calibration. */
  mode?: "cold" | "reply";
  /** Caller wires this to the composer's setField call. */
  onApply: (subject: string) => void;
}

const MIN_BODY_CHARS = 30;

export function SubjectSuggestButton({
  bodyText,
  currentSubject,
  recipientName,
  recipientEmail,
  venueName,
  cityName,
  mode = "cold",
  onApply,
}: Props) {
  const [pending, startTx] = useTransition();
  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toast = useToast();

  const bodyTooShort = (bodyText?.trim().length ?? 0) < MIN_BODY_CHARS;
  const disabled = pending || bodyTooShort;

  function suggest() {
    if (disabled) return;
    setError(null);
    setSubjects(null);
    setOpen(true);
    startTx(async () => {
      const result = await suggestEmailSubject({
        bodyText,
        currentSubject,
        recipientName,
        recipientEmail,
        venueName,
        cityName,
        mode,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't suggest subjects.");
        return;
      }
      setSubjects(result.data.subjects);
    });
  }

  function applyChip(s: string) {
    onApply(s);
    setOpen(false);
    setSubjects(null);
    toast.show({ kind: "success", message: "Subject updated." });
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={suggest}
        disabled={disabled}
        title={
          bodyTooShort
            ? "Write a few sentences first so AI can suggest a subject"
            : "Suggest subject lines from the draft body"
        }
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors",
          disabled
            ? "cursor-not-allowed text-zinc-300 dark:text-zinc-700"
            : "text-violet-600 hover:bg-violet-50 hover:text-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/40 dark:hover:text-violet-200",
        )}
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Suggest
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg",
            "dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <div className="mb-1.5 flex items-center gap-1.5 px-1">
            <Sparkles className="h-3 w-3 text-violet-600 dark:text-violet-400" />
            <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
              {pending ? "Generating…" : "Pick a subject"}
            </span>
          </div>

          {pending && (
            <div className="px-2 py-3 text-xs text-zinc-500">
              <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <div className="rounded-md bg-rose-50 px-2 py-1.5 text-rose-800 text-xs dark:bg-rose-950 dark:text-rose-200">
              {error}
            </div>
          )}

          {subjects && subjects.length > 0 && (
            <div className="flex flex-col gap-1">
              {subjects.map((s, i) => (
                <button
                  key={`${i}::${s.slice(0, 32)}`}
                  type="button"
                  onClick={() => applyChip(s)}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-left text-xs leading-relaxed transition-colors",
                    "hover:bg-violet-50 hover:text-violet-900 dark:hover:bg-violet-950/40 dark:hover:text-violet-100",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

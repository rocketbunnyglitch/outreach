"use client";

/**
 * CallOutcomePopover — shows immediately after the operator hits the
 * click-to-call button. They pick what happened on the call while it's
 * still happening (or right after it ends) and we update the same
 * outreach_log row that logCallAttempt created.
 *
 * 9 outcomes, grouped visually by section:
 *
 *   COULDN'T REACH
 *     Bad number, No answer, Left voicemail, Got their email
 *
 *   REACHED — NOT DECISION-MAKER
 *     Call back later for manager
 *
 *   REACHED — DECISION-MAKER
 *     Wants more info sent (warm), Declined, Competing event, Hours don't work
 *
 * Each outcome maps to:
 *   - outreach_log.outcome (enum)
 *   - cold_outreach_entries.status (auto-bumped per the map in
 *     recordCallOutcome)
 *   - venues.phone_e164 (nulled out if outcome = wrong_number)
 *
 * Notes field is optional; encourages capturing context for the next
 * follow-up ("manager Sue, free Tues 2pm").
 *
 * Dismissable without saving if it was a mis-tap — the placeholder
 * outreach_log row from logCallAttempt remains with outcome=sent for
 * audit, but no status change cascades.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  Check,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Sparkles,
  ThumbsDown,
  Voicemail,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { recordCallOutcome } from "../../_actions/quo-actions";

type Outcome =
  | "wrong_number"
  | "no_answer"
  | "voicemail"
  | "email_collected"
  | "callback_requested"
  | "interested"
  | "declined"
  | "competing_event"
  | "hours_mismatch";

interface OutcomeOption {
  value: Outcome;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  section: "noreach" | "gatekeeper" | "decisionmaker";
}

const OPTIONS: OutcomeOption[] = [
  // Couldn't reach
  {
    value: "wrong_number",
    label: "Bad number",
    icon: PhoneOff,
    tone: "text-rose-600 dark:text-rose-400",
    section: "noreach",
  },
  {
    value: "no_answer",
    label: "No answer",
    icon: PhoneMissed,
    tone: "text-zinc-600 dark:text-zinc-400",
    section: "noreach",
  },
  {
    value: "voicemail",
    label: "Left voicemail",
    icon: Voicemail,
    tone: "text-zinc-600 dark:text-zinc-400",
    section: "noreach",
  },
  {
    value: "email_collected",
    label: "Got their email — switch to email",
    icon: Mail,
    tone: "text-blue-600 dark:text-blue-400",
    section: "noreach",
  },
  // Reached but not the decision-maker
  {
    value: "callback_requested",
    label: "Call back later for the manager",
    icon: Clock,
    tone: "text-violet-600 dark:text-violet-400",
    section: "gatekeeper",
  },
  // Spoke to the decision-maker
  {
    value: "interested",
    label: "Manager wants more info — send follow-up",
    icon: Sparkles,
    tone: "text-emerald-600 dark:text-emerald-400",
    section: "decisionmaker",
  },
  {
    value: "declined",
    label: "Manager declined",
    icon: ThumbsDown,
    tone: "text-rose-600 dark:text-rose-400",
    section: "decisionmaker",
  },
  {
    value: "competing_event",
    label: "They have their own event",
    icon: PhoneCall,
    tone: "text-amber-600 dark:text-amber-400",
    section: "decisionmaker",
  },
  {
    value: "hours_mismatch",
    label: "Hours don't fit our crawl",
    icon: Clock,
    tone: "text-amber-600 dark:text-amber-400",
    section: "decisionmaker",
  },
];

const SECTION_LABELS: Record<OutcomeOption["section"], string> = {
  noreach: "Couldn't reach",
  gatekeeper: "Reached — not the manager",
  decisionmaker: "Spoke with manager",
};

interface Props {
  logId: string;
  venueId: string;
  venueName: string;
  outreachBrandId: string;
  cityCampaignId?: string;
  coldEntryId?: string;
  onClose: () => void;
}

export function CallOutcomePopover({
  logId,
  venueId,
  venueName,
  outreachBrandId,
  cityCampaignId,
  coldEntryId,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click (only if no outcome selected — avoid losing
  // a half-typed note from a stray click)
  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (!selected && notes.length === 0) {
          onClose();
        }
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [onClose, selected, notes.length]);

  // Esc to dismiss
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    if (!selected) {
      setError("Pick an outcome first.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("logId", logId);
    fd.set("venueId", venueId);
    fd.set("outreachBrandId", outreachBrandId);
    if (cityCampaignId) fd.set("cityCampaignId", cityCampaignId);
    if (coldEntryId) fd.set("coldEntryId", coldEntryId);
    fd.set("outcome", selected);
    if (notes.trim()) fd.set("notes", notes.trim());
    startTx(async () => {
      const result = await recordCallOutcome(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save the outcome.");
        return;
      }
      onClose();
    });
  }

  const sections: OutcomeOption["section"][] = ["noreach", "gatekeeper", "decisionmaker"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> doesn't compose with controlled mount
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div
        ref={ref}
        className={cn("card-surface w-full max-w-md p-5", "animate-[fade-in_200ms_ease-out]")}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base tracking-tight">How did the call go?</h3>
            <p className="mt-0.5 truncate text-xs text-zinc-500">{venueName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {sections.map((section) => (
            <div key={section}>
              <p className="px-1 pb-1 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                {SECTION_LABELS[section]}
              </p>
              <ul className="flex flex-col gap-0.5">
                {OPTIONS.filter((o) => o.section === section).map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = selected === opt.value;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        onClick={() => setSelected(opt.value)}
                        disabled={pending}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                          isSelected
                            ? "bg-zinc-100 dark:bg-zinc-800"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
                        )}
                      >
                        <span className={cn("inline-flex items-center gap-2", opt.tone)}>
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-zinc-800 dark:text-zinc-200">{opt.label}</span>
                        </span>
                        {isSelected && <Check className="h-3 w-3 text-emerald-600" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Manager Sue · prefers email · open Tues afternoons"
            rows={2}
            disabled={pending}
            className={cn(
              "mt-1 w-full resize-none rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          />
        </label>

        {error && (
          <p
            className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Skip — log as attempted only
          </button>
          <Button type="button" onClick={save} disabled={pending || !selected}>
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <MessageSquare className="h-3 w-3" />
            )}
            Save outcome
          </Button>
        </div>
      </div>
    </div>
  );
}

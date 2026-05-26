"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { draftOutreachEmail } from "../../_actions/ai-actions";

interface Props {
  venueId: string;
  venueName: string;
  cityCampaignId: string;
  /** Pre-fill the send composer with the resulting draft. */
  onUseDraft: (draft: { subject: string; body: string }) => void;
}

/**
 * Tiny sparkles icon on a cold-outreach row that opens a popover
 * where Claude drafts a personalized first-touch (or follow-up) email
 * for the venue.
 *
 * Flow:
 *   1. Tap ✨ → popover opens with a loading state
 *   2. Server action gathers venue + campaign + history context and
 *      calls Claude
 *   3. 4-10s later, the subject + body render in editable textareas
 *   4. Operator tweaks, clicks 'Use this draft' → onUseDraft fires,
 *      popover closes, parent's send composer opens with the draft
 *      pre-filled
 *
 * The intended-role selector lets the operator hint Claude before
 * generation ('they'd be a great wristband pickup spot') so the copy
 * mentions the right slot. Defaults to 'unspecified' which lets
 * Claude pitch flexibly.
 *
 * Without ANTHROPIC_API_KEY: shows a quiet 'not configured' hint
 * instead of the editor.
 */
export function AiDraftButton({ venueId, venueName, cityCampaignId, onUseDraft }: Props) {
  const [open, setOpen] = useState(false);
  const [intendedRole, setIntendedRole] = useState<
    "wristband" | "middle" | "final" | "alt_final" | "unspecified"
  >("unspecified");
  const [pending, startTx] = useTransition();
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-generate on first open with the current role hint
  useEffect(() => {
    if (open && !draft && !pending && !error && !notConfigured) {
      generate();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: only fire on open
  }, [open]);

  // Click outside / Escape to close
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

  function generate(roleOverride?: typeof intendedRole) {
    setError(null);
    setDraft(null);
    setNotConfigured(false);
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("intendedRole", roleOverride ?? intendedRole);
    startTx(async () => {
      const result = await draftOutreachEmail(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Generation failed.");
        return;
      }
      if (result.data && "notConfigured" in result.data) {
        setNotConfigured(true);
        return;
      }
      setDraft(result.data);
    });
  }

  function setRoleAndRegenerate(role: typeof intendedRole) {
    setIntendedRole(role);
    generate(role);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-violet-500/[0.08] hover:text-violet-600 dark:hover:text-violet-400"
        aria-label="AI draft email"
        title="Draft email with AI"
      >
        <Sparkles className="h-2.5 w-2.5" />
      </button>

      {open && (
        <div
          ref={containerRef}
          className="absolute z-50 mt-1 w-[28rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          style={{ marginLeft: "-12rem" }}
        >
          <header className="flex items-center justify-between border-zinc-200/60 border-b px-3 py-2.5 dark:border-zinc-800/40">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-500" />
              <p className="font-semibold text-xs tracking-tight">AI draft for {venueName}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </header>

          {/* Role hints */}
          <div className="flex items-center gap-1 border-zinc-200/40 border-b px-3 py-1.5 dark:border-zinc-800/30">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Pitch as
            </span>
            {(
              [
                { value: "unspecified", label: "Flexible" },
                { value: "wristband", label: "Wristband" },
                { value: "middle", label: "Middle" },
                { value: "final", label: "Final" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRoleAndRegenerate(opt.value)}
                disabled={pending}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
                  intendedRole === opt.value
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="p-3">
            {pending && (
              <div className="flex flex-col items-center gap-2 py-8">
                <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Claude is drafting…
                </p>
                <p className="text-[10px] text-zinc-400">Usually 4-10 seconds</p>
              </div>
            )}

            {notConfigured && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-800 text-xs dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                AI drafting isn't configured. Set{" "}
                <code className="font-mono">ANTHROPIC_API_KEY</code> on the server.
              </div>
            )}

            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 text-rose-700 text-xs dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                {error}
                <button
                  type="button"
                  onClick={() => generate()}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] underline-offset-2 hover:underline"
                >
                  <RefreshCw className="h-2.5 w-2.5" /> Retry
                </button>
              </div>
            )}

            {draft && !pending && (
              <DraftEditor
                draft={draft}
                onChange={setDraft}
                onUse={() => {
                  onUseDraft(draft);
                  setOpen(false);
                }}
                onRegenerate={() => generate()}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DraftEditor({
  draft,
  onChange,
  onUse,
  onRegenerate,
}: {
  draft: { subject: string; body: string };
  onChange: (d: { subject: string; body: string }) => void;
  onUse: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label
          className="block font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
          htmlFor="ai-subject"
        >
          Subject
        </label>
        <input
          id="ai-subject"
          type="text"
          value={draft.subject}
          onChange={(e) => onChange({ ...draft, subject: e.target.value })}
          className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs transition-colors focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
        />
      </div>
      <div>
        <label
          className="block font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
          htmlFor="ai-body"
        >
          Body
        </label>
        <textarea
          id="ai-body"
          value={draft.body}
          onChange={(e) => onChange({ ...draft, body: e.target.value })}
          rows={10}
          className="mt-0.5 w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs leading-snug transition-colors focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
        />
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          <RefreshCw className="h-2.5 w-2.5" /> Regenerate
        </button>
        <Button type="button" size="sm" onClick={onUse}>
          Use this draft
        </Button>
      </div>
    </div>
  );
}

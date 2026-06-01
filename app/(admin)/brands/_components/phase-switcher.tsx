"use client";

import { cn } from "@/lib/cn";
import { type OutreachPhase, PHASE_DESCRIPTIONS, PHASE_LABELS } from "@/lib/outreach-phase";
import { Loader2, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useState, useTransition } from "react";
import { setOutreachPhase } from "../_actions";

interface Props {
  brandId: string;
  currentPhase: OutreachPhase;
  setAt: Date | null;
}

const PHASES: OutreachPhase[] = [1, 2, 3, 4];

/**
 * Phase switcher for an outreach brand. Renders 4 cards (one per phase)
 * with the current one highlighted. Clicking a different card calls
 * setOutreachPhase. Includes a confirmation step when raising the phase
 * (going from manual → automated is the dangerous direction; lowering
 * back is free).
 */
export function PhaseSwitcher({ brandId, currentPhase, setAt }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<OutreachPhase | null>(null);

  function applyPhase(phase: OutreachPhase) {
    if (phase === currentPhase) return;
    setError(null);
    startTransition(async () => {
      const result = await setOutreachPhase(brandId, phase);
      if (!result.ok) setError(result.error ?? "Failed to set phase.");
      setConfirming(null);
    });
  }

  return (
    <section className="card-surface p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
            <ShieldCheck className="h-4 w-4 text-zinc-500" />
            Outreach phase
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Controls how aggressively the engine sends. Start at Phase 1 for new brands; raise as
            deliverability proves out. Each phase includes the capabilities of all lower phases.
          </p>
        </div>
        {setAt && (
          <p className="font-mono text-[10px] text-zinc-500 tabular-nums">
            set {setAt.toLocaleDateString("en-US")}
          </p>
        )}
      </header>

      {error && (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
        {PHASES.map((phase) => {
          const active = phase === currentPhase;
          const isConfirming = confirming === phase;
          const isRaising = phase > currentPhase;
          return (
            <button
              key={phase}
              type="button"
              disabled={pending}
              onClick={() => {
                if (active) return;
                // Raising the phase = ask for confirmation. Lowering = just do it.
                if (isRaising && confirming !== phase) {
                  setConfirming(phase);
                } else {
                  applyPhase(phase);
                }
              }}
              className={cn(
                "rounded-lg border p-4 text-left transition-all",
                active
                  ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                  : "border-zinc-200 bg-white hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/80",
                pending && "opacity-50",
              )}
            >
              <header className="flex items-baseline justify-between gap-2">
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  Phase {phase}
                </p>
                {active && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-500 uppercase tracking-widest">
                    {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Active
                  </span>
                )}
              </header>
              <p className="mt-1 font-medium text-sm">{PHASE_LABELS[phase]}</p>
              <p className="mt-2 line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
                {PHASE_DESCRIPTIONS[phase]}
              </p>
              {isConfirming && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2 dark:border-rose-900/40 dark:bg-rose-950/20">
                  <p className="font-medium text-rose-900 text-xs dark:text-rose-200">
                    Raising the phase enables more automation. Sure?
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        applyPhase(phase);
                      }}
                      disabled={pending}
                      className="rounded-md bg-zinc-900 px-2.5 py-1 font-mono text-[10px] text-zinc-50 uppercase tracking-widest hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirming(null);
                      }}
                      className="rounded-md px-2.5 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-widest hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
        <ShieldQuestion className="h-3 w-3" />
        Recommendation: start at Phase 1, move to Phase 2 once warm-up completes (day 14), Phase 3
        after 30+ days of clean deliverability, Phase 4 only for transactional sends to confirmed
        venues.
      </p>
    </section>
  );
}

"use client";

/**
 * "Suggested templates" panel on /admin/learning. Surfaces AI-mined candidate
 * templates from high-performing staff replies. The operator clicks Generate to
 * run a pass, then Promote (→ a real template) or Dismiss each proposal.
 */

import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { dismissProposalAction, generateProposalsAction, promoteProposalAction } from "../_actions";

export interface ProposalView {
  id: string;
  title: string;
  suggestedSubject: string;
  suggestedBody: string;
  rationale: string;
  supportCount: number;
  confirmedCount: number;
}

export function TemplateProposals({ proposals }: { proposals: ProposalView[] }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  // Optimistically hide rows the operator has actioned this session.
  const [actioned, setActioned] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visible = proposals.filter((p) => !actioned.has(p.id));

  function generate() {
    setNote(null);
    startTransition(async () => {
      const res = await generateProposalsAction();
      if (!res.ok) setNote(res.error ?? "Generation failed.");
      else if ((res.created ?? 0) === 0)
        setNote(
          `Reviewed ${res.considered ?? 0} top replies — nothing new to suggest right now (everything's already covered, or not enough signal yet).`,
        );
      else setNote(`${res.created} new suggestion${res.created === 1 ? "" : "s"} added.`);
    });
  }

  function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setActioned((s) => new Set(s).add(id));
      else setNote(res.error ?? "Action failed.");
    });
  }

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4 dark:border-violet-900/40 dark:bg-violet-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h2 className="font-semibold text-sm tracking-tight">Suggested templates</h2>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            {visible.length} pending
          </span>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 font-medium text-[12px] text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Find suggestions
        </button>
      </div>

      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
        Mines your team's best-performing replies (ones that led to confirmations) for recurring
        messages you're writing by hand but don't have a template for. Promote turns one into a real
        template you can refine; the engine never sends.
      </p>

      {note && (
        <div className="rounded-md bg-white px-3 py-2 text-[12px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {note}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-2 text-[12px] text-zinc-400">
          No pending suggestions. Click "Find suggestions" to scan recent replies.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{p.title}</div>
                  <div className="text-[12px] text-zinc-500 dark:text-zinc-400">{p.rationale}</div>
                  <div className="mt-1 flex flex-wrap gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.06em]">
                    <span>{p.supportCount} replies</span>
                    {p.confirmedCount > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {p.confirmedCount} confirmed
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(p.id, () => promoteProposalAction(p.id))}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
                    title="Create a real template from this suggestion"
                  >
                    <Check className="h-3 w-3" /> Promote
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(p.id, () => dismissProposalAction(p.id).then((r) => ({ ok: r.ok })))
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    title="Dismiss this suggestion"
                  >
                    <X className="h-3 w-3" /> Dismiss
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="mt-2 font-mono text-[10px] text-violet-600 uppercase tracking-[0.08em] hover:underline dark:text-violet-400"
              >
                {expanded.has(p.id) ? "Hide draft" : "Preview draft"}
              </button>
              {expanded.has(p.id) && (
                <div className="mt-2 rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/40">
                  {p.suggestedSubject && (
                    <div className="mb-1 text-[12px]">
                      <span className="font-mono text-[10px] text-zinc-500 uppercase">
                        Subject:{" "}
                      </span>
                      {p.suggestedSubject}
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap font-sans text-[12px] text-zinc-700 dark:text-zinc-300">
                    {p.suggestedBody}
                  </pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

/**
 * Engine suggestion bar above the reply controls (Phase 2.7).
 *
 * Surfaces the engine's template pick for this thread in the reading pane,
 * before the operator clicks Reply. Calls the SAME server action the composer
 * uses (pickTemplateForComposer) so the preview matches what the composer will
 * load. "Use this template" opens the reply; the composer then applies the pick
 * (Phase 1.5 auto-pick) and offers the alternatives swap in-place. Renders
 * nothing when the engine has no confident pick (no campaign attribution).
 *
 * [ReferenceDoc Section 7 + 8.7] the engine suggests; the operator decides.
 */

import { type EnginePickResult, pickTemplateForComposer } from "@/app/(admin)/_actions/engine-pick";
import { Bot, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

function openReply(threadId: string) {
  document.dispatchEvent(new CustomEvent("inbox-reply", { detail: { threadId } }));
}

export function ThreadSuggestionBar({ threadId }: { threadId: string }) {
  const [result, setResult] = useState<EnginePickResult | null>(null);
  const [showAlts, setShowAlts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pickTemplateForComposer({ threadId })
      .then((res) => {
        if (!cancelled && res.ok) setResult(res.data);
      })
      .catch(() => {
        /* best-effort hint; no banner on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const pick = result?.pick;
  if (!pick) return null;
  const alts = result?.alternatives ?? [];

  return (
    <div className="mx-4 mt-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 sm:mx-6 dark:border-blue-900/60 dark:bg-blue-950/30">
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-blue-900 text-sm dark:text-blue-100">
            Suggested: {pick.templateCode} - {pick.templateName}
          </p>
          <p className="mt-0.5 text-blue-800/80 text-xs dark:text-blue-200/70">
            {pick.reason}
            {result?.contextSummary ? ` (${result.contextSummary})` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openReply(threadId)}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white text-xs hover:bg-blue-700"
            >
              <Sparkles className="h-3 w-3" />
              Use this template
            </button>
            {alts.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowAlts((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-blue-700 text-xs hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40"
              >
                See alternatives
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showAlts ? "rotate-180" : ""}`}
                />
              </button>
            ) : null}
          </div>
          {showAlts && alts.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 border-blue-200/70 border-t pt-2 dark:border-blue-900/50">
              {alts.map((a) => (
                <li key={a.templateId}>
                  <button
                    type="button"
                    onClick={() => openReply(threadId)}
                    className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-blue-100 dark:hover:bg-blue-900/40"
                  >
                    <span className="font-medium text-blue-900 dark:text-blue-100">
                      {a.templateCode} - {a.templateName}
                    </span>
                    <span className="text-blue-800/70 dark:text-blue-200/60"> -- {a.reason}</span>
                  </button>
                </li>
              ))}
              <li className="px-2 pt-0.5 text-[10px] text-blue-700/70 dark:text-blue-300/60">
                Open the reply to switch between these in the composer.
              </li>
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

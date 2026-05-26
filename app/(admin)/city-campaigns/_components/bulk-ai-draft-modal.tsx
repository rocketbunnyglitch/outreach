"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CheckCircle2, Loader2, RefreshCw, Send, Sparkles, X, XCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { draftOutreachEmail } from "../../_actions/ai-actions";

interface SelectedEntry {
  entryId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
}

interface Props {
  entries: SelectedEntry[];
  cityCampaignId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Bulk AI draft review modal.
 *
 * Opens as a full-screen sheet showing one DraftCard per selected
 * cold-outreach entry. Each card fires its own Claude call in
 * parallel on mount and fills in when the response lands — so the
 * operator can scroll through 20 generating cards at once and
 * review/send the ready ones while the rest finish.
 *
 * Per-card actions:
 *   • Subject + Body inline edit (instant, local state)
 *   • Regenerate — re-rolls just that card
 *   • Send — opens the operator's mailto: with subject/body
 *     pre-filled, marks card 'sent' in this session
 *   • Skip — collapses the card; useful when the AI output is off
 *     or the venue isn't a fit
 *
 * Closes via the X button, click on backdrop, or Escape. No
 * persistent state — closing loses any unsent in-progress edits
 * (intentional: this is a generate-and-go surface).
 *
 * Rows without an email address are filtered out before they reach
 * this modal (the caller does that in cold-outreach-table.tsx).
 */
export function BulkAiDraftModal({ entries, cityCampaignId, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const eligible = entries.filter((e) => !!e.venueEmail);

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 z-[60] cursor-default bg-zinc-900/40 backdrop-blur-sm"
      />

      {/* Sheet */}
      <aside className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-3xl flex-col border-zinc-200 border-l bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-zinc-200 border-b px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h2 className="font-semibold text-base tracking-tight">
              Bulk draft · {eligible.length} venue{eligible.length === 1 ? "" : "s"}
            </h2>
            {eligible.length !== entries.length && (
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                ({entries.length - eligible.length} skipped — no email)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {eligible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                None of the selected rows have an email address.
              </p>
              <p className="font-mono text-[10px] text-zinc-500">
                Add emails first, then re-run bulk draft.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {eligible.map((entry) => (
                <li key={entry.entryId}>
                  <DraftCard entry={entry} cityCampaignId={cityCampaignId} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-zinc-200 border-t px-6 py-3 text-center font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] dark:border-zinc-800">
          Claude drafts in parallel · review + edit + send each individually
        </footer>
      </aside>
    </>
  );
}

interface CardState {
  status: "generating" | "ready" | "error" | "sent" | "skipped" | "notConfigured";
  subject: string;
  body: string;
  error: string | null;
}

function DraftCard({
  entry,
  cityCampaignId,
}: {
  entry: SelectedEntry;
  cityCampaignId: string;
}) {
  const [state, setState] = useState<CardState>({
    status: "generating",
    subject: "",
    body: "",
    error: null,
  });
  const [pending, startTx] = useTransition();

  // Auto-generate on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount
  useEffect(() => {
    generate();
  }, []);

  function generate() {
    setState((s) => ({ ...s, status: "generating", error: null }));
    const fd = new FormData();
    fd.set("venueId", entry.venueId);
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("intendedRole", "unspecified");
    startTx(async () => {
      const result = await draftOutreachEmail(null, fd);
      if (!result.ok) {
        setState({
          status: "error",
          subject: "",
          body: "",
          error: result.error ?? "Generation failed.",
        });
        return;
      }
      if (result.data && "notConfigured" in result.data) {
        setState({
          status: "notConfigured",
          subject: "",
          body: "",
          error: null,
        });
        return;
      }
      setState({
        status: "ready",
        subject: result.data.subject,
        body: result.data.body,
        error: null,
      });
    });
  }

  function send() {
    if (!entry.venueEmail) return;
    const subject = encodeURIComponent(state.subject);
    const body = encodeURIComponent(state.body);
    window.open(`mailto:${entry.venueEmail}?subject=${subject}&body=${body}`, "_blank");
    setState((s) => ({ ...s, status: "sent" }));
  }

  function skip() {
    setState((s) => ({ ...s, status: "skipped" }));
  }

  // Collapsed states (sent / skipped)
  if (state.status === "sent") {
    return (
      <article className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <p className="font-medium text-emerald-900 text-sm dark:text-emerald-100">
            Sent to {entry.venueName}
          </p>
        </div>
        <p className="font-mono text-[10px] text-emerald-700 uppercase tracking-[0.08em] dark:text-emerald-400">
          {entry.venueEmail}
        </p>
      </article>
    );
  }

  if (state.status === "skipped") {
    return (
      <article className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-2.5 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/30">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-zinc-400" />
          <p className="text-sm text-zinc-500 line-through">{entry.venueName}</p>
        </div>
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, status: "ready" }))}
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-2 hover:underline"
        >
          undo
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <header className="flex items-center justify-between border-zinc-200/60 border-b px-4 py-2.5 dark:border-zinc-800/40">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
            {entry.venueName}
          </p>
          <p className="truncate font-mono text-[10px] text-zinc-500">{entry.venueEmail}</p>
        </div>
        <button
          type="button"
          onClick={skip}
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          skip
        </button>
      </header>

      <div className="px-4 py-3">
        {state.status === "generating" && (
          <div className="flex flex-col items-center gap-2 py-6">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Drafting…
            </p>
          </div>
        )}

        {state.status === "notConfigured" && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-800 text-xs dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            AI drafting isn't configured. Set <code className="font-mono">ANTHROPIC_API_KEY</code>{" "}
            on the server.
          </div>
        )}

        {state.status === "error" && (
          <div className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/30">
            <p className="text-rose-700 text-xs dark:text-rose-300">{state.error}</p>
            <button
              type="button"
              onClick={generate}
              disabled={pending}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-700 uppercase tracking-[0.08em] underline-offset-2 hover:underline dark:text-rose-300"
            >
              <RefreshCw className="h-2.5 w-2.5" /> Retry
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <div className="flex flex-col gap-2">
            <div>
              <label
                className="block font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
                htmlFor={`subject-${entry.entryId}`}
              >
                Subject
              </label>
              <input
                id={`subject-${entry.entryId}`}
                type="text"
                value={state.subject}
                onChange={(e) => setState((s) => ({ ...s, subject: e.target.value }))}
                className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs transition-colors focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label
                className="block font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
                htmlFor={`body-${entry.entryId}`}
              >
                Body
              </label>
              <textarea
                id={`body-${entry.entryId}`}
                value={state.body}
                onChange={(e) => setState((s) => ({ ...s, body: e.target.value }))}
                rows={8}
                className={cn(
                  "mt-0.5 w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs leading-snug transition-colors",
                  "focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950",
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={generate}
                disabled={pending}
                className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
              >
                <RefreshCw className="h-2.5 w-2.5" /> Regenerate
              </button>
              <Button type="button" size="sm" onClick={send}>
                <Send className="h-3 w-3" /> Send
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

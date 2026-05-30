"use client";

/**
 * ReplyComposer — collapsed-by-default reply box that expands inline at
 * the bottom of a thread. Click "Reply" → textarea appears + Send button.
 *
 * Behavior:
 *   - Cmd+Enter (Mac) / Ctrl+Enter sends
 *   - Escape collapses (only if body is empty)
 *   - Pending: button shows spinner, textarea disabled
 *   - Error: small inline message above the textarea
 *   - Success: collapse, clear, refresh (server action revalidates)
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ChevronDown, Loader2, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { sendThreadReply } from "../_actions";

interface Props {
  threadId: string;
  /** When true, the "Bypass cap" button appears on cap-block errors. */
  isAdmin?: boolean;
}

export function ReplyComposer({ threadId, isAdmin = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [capBlocked, setCapBlocked] = useState(false);
  /** True when the server returned a duplicate-outreach warning that
   *  needs an explicit ack to bypass. */
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [pending, startTx] = useTransition();
  /** Separate transition for the AI-draft button so it doesn't
   *  share pending state with Send (operator can still cancel/edit
   *  during a long draft). */
  const [aiPending, startAiTx] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  // Keyboard binding bridge: 'r' from InboxKeyboardNav dispatches
  // 'inbox-reply' on the document with the current threadId. We
  // listen here so pressing 'r' expands + focuses this composer
  // without ReplyComposer needing to be lifted into a parent ref.
  useEffect(() => {
    function onReply(e: Event) {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      if (detail?.threadId !== threadId) return;
      setExpanded(true);
      // Focus happens via the expanded-effect above, but if already
      // expanded the effect won't re-fire — focus directly.
      if (textareaRef.current) textareaRef.current.focus();
    }
    document.addEventListener("inbox-reply", onReply);
    return () => document.removeEventListener("inbox-reply", onReply);
  }, [threadId]);

  function send(opts: { bypass?: boolean; ackDuplicates?: boolean } = {}) {
    setError(null);
    if (!body.trim()) {
      setError("Reply body can't be empty.");
      return;
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("body", body);
      if (opts.bypass) fd.set("bypassCap", "1");
      if (opts.ackDuplicates) fd.set("ackDuplicates", "1");
      const result = await sendThreadReply(null, fd);
      if (!result.ok) {
        setError(result.error);
        // Heuristic prefixes from the server messages — let the UI
        // surface the right confirm affordance without leaking a
        // structured error object across the action boundary.
        setCapBlocked(result.error.startsWith("Daily cold-send cap reached"));
        setDuplicateBlocked(result.error.startsWith("Possible duplicate outreach"));
        return;
      }
      setBody("");
      setExpanded(false);
      setCapBlocked(false);
      setDuplicateBlocked(false);
      router.refresh();
    });
  }

  /** Templates available for AI+template merge. Lazy-loaded on first
   *  chevron open so the composer doesn't pay the cost when nobody
   *  uses the feature. Null = unloaded; [] = loaded-and-empty. */
  const [aiTemplates, setAiTemplates] = useState<Array<{
    id: string;
    name: string;
    stage: string;
    brandName: string;
  }> | null>(null);
  const [aiTemplateId, setAiTemplateId] = useState<string>("");
  const [aiOptionsOpen, setAiOptionsOpen] = useState(false);

  /**
   * Lazy-load the template list when the operator first opens the
   * AI options panel. Shares listComposeContext with the compose
   * modal — same query path so the dropdown is consistent across
   * the engine.
   */
  async function ensureTemplatesLoaded() {
    if (aiTemplates !== null) return;
    try {
      const mod = await import("../../_actions/compose-and-send");
      const ctx = await mod.listComposeContext({});
      setAiTemplates(
        ctx.templates.map((t) => ({
          id: t.id,
          name: t.name,
          stage: t.stage,
          brandName: t.brandName,
        })),
      );
    } catch (_err) {
      // Non-fatal — the AI Draft button still works without a template.
      setAiTemplates([]);
    }
  }

  /**
   * Generate an AI draft reply for this thread. Streams the result
   * token-by-token via /api/inbox/ai-draft-stream so the operator
   * sees the draft taking shape instead of waiting on a spinner.
   *
   * Overwrites the current body (after confirm when body has content)
   * with the Claude response. Operator always reviews + edits before
   * sending — this never auto-sends.
   */
  function runAiDraft() {
    setError(null);
    if (body.trim() && !confirm("Replace current draft with AI-generated reply?")) {
      return;
    }
    startAiTx(async () => {
      // Reset before streaming so deltas accumulate from empty.
      setBody("");

      let res: Response;
      try {
        res = await fetch("/api/inbox/ai-draft-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            templateId: aiTemplateId || null,
          }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
        return;
      }
      if (!res.ok) {
        try {
          const j = (await res.json()) as { error?: string };
          setError(j?.error ?? `HTTP ${res.status}`);
        } catch {
          setError(`HTTP ${res.status}`);
        }
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("Streaming not supported by this browser.");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const frame of parts) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const payload = line.slice("data: ".length);
            try {
              const obj = JSON.parse(payload) as {
                text?: string;
                done?: boolean;
                error?: string;
              };
              if (obj.error) {
                setError(obj.error);
                return;
              }
              if (obj.text) {
                accumulated += obj.text;
                setBody(accumulated);
              }
              if (obj.done) {
                if (textareaRef.current) {
                  textareaRef.current.focus();
                  textareaRef.current.setSelectionRange(accumulated.length, accumulated.length);
                }
              }
            } catch {
              // Malformed frame — skip + continue.
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stream read error");
      }
    });
  }

  if (!expanded) {
    return (
      <div className="sticky bottom-0 border-zinc-200/80 border-t bg-white/95 px-6 py-3 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-500 transition-colors",
            "hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800",
          )}
        >
          <Send className="h-3.5 w-3.5" />
          Reply...
        </button>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 border-zinc-200/80 border-t bg-white/95 px-6 py-4 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/80">
      {error && (
        <p
          className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
          role="alert"
        >
          {error}
        </p>
      )}
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            // Cmd+Enter sends — if a duplicate ack is currently
            // required, the operator clicks "Send anyway" deliberately
            // instead of the keyboard shortcut (avoids silent send
            // anyway via muscle memory).
            if (!duplicateBlocked) send();
          } else if (e.key === "Escape" && !body.trim()) {
            setExpanded(false);
          }
        }}
        disabled={pending}
        rows={5}
        placeholder="Type your reply… ⌘+Enter to send"
        className={cn(
          "w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors",
          "placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
          "dark:border-zinc-800 dark:bg-zinc-900",
        )}
      />
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setBody("");
            setExpanded(false);
            setCapBlocked(false);
            setDuplicateBlocked(false);
          }}
          disabled={pending}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
        <div className="flex items-center gap-2">
          {/* AI draft button group: main "AI draft" + chevron that
              opens a small "Use template" panel for template-merge
              mode. Both share violet accent (engine convention for
              AI-assisted affordances). */}
          <div className="relative inline-flex items-center">
            <button
              type="button"
              onClick={runAiDraft}
              disabled={pending || aiPending}
              title={
                aiTemplateId
                  ? "Generate a draft reply using the selected template as outline"
                  : "Generate a draft reply with AI"
              }
              className="inline-flex items-center gap-1 rounded-l-md border border-violet-300 bg-white px-2.5 py-1 font-medium text-violet-700 text-xs hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700/60 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/40"
            >
              {aiPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              AI draft
              {aiTemplateId && (
                <span className="ml-0.5 font-mono text-[9px] text-violet-500 normal-case">
                  +tpl
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={async () => {
                const willOpen = !aiOptionsOpen;
                setAiOptionsOpen(willOpen);
                if (willOpen) await ensureTemplatesLoaded();
              }}
              disabled={pending || aiPending}
              title="AI options (pick a template to merge with)"
              className="inline-flex items-center rounded-r-md border border-violet-300 border-l-0 bg-white px-1.5 py-1 text-violet-700 text-xs hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700/60 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/40"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            {aiOptionsOpen && (
              <div className="absolute right-0 bottom-full z-10 mb-1 w-72 rounded-md border border-zinc-200 bg-white p-3 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                <p className="mb-2 font-medium text-xs">Merge AI draft with a template</p>
                {aiTemplates === null ? (
                  <div className="flex justify-center py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                  </div>
                ) : aiTemplates.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">No templates available.</p>
                ) : (
                  <>
                    <select
                      value={aiTemplateId}
                      onChange={(e) => setAiTemplateId(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">— None (free-form AI draft) —</option>
                      {aiTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.brandName} · {t.name} ({t.stage.replace(/_/g, " ")})
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      With a template selected, the AI will use it as an outline, adapting the
                      wording to match the inbound message + filling merge fields from venue
                      context.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
          {capBlocked && isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => send({ bypass: true })}
              disabled={pending || !body.trim()}
              className="text-amber-700 dark:text-amber-300"
            >
              Bypass cap
            </Button>
          )}
          {duplicateBlocked ? (
            <Button
              onClick={() => send({ ackDuplicates: true })}
              disabled={pending || !body.trim()}
              size="sm"
              className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Send anyway
            </Button>
          ) : (
            <Button onClick={() => send({})} disabled={pending || !body.trim()} size="sm">
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Send reply
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

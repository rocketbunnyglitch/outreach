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
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { draftAiReplyAction, sendThreadReply } from "../_actions";

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

  /**
   * Generate an AI draft reply for this thread. Overwrites the current
   * body (after confirm when body has content) with the Claude
   * response. Operator always reviews + edits before sending — this
   * never auto-sends.
   *
   * Failure modes surfaced inline as errors:
   *   - "ANTHROPIC_API_KEY is not set on the server" → operator
   *     needs to activate the AI integration
   *   - "No inbound message on this thread to reply to" → defensive,
   *     shouldn't normally hit since the button only renders when
   *     the thread has been classified (which requires inbound).
   */
  function runAiDraft() {
    setError(null);
    if (body.trim() && !confirm("Replace current draft with AI-generated reply?")) {
      return;
    }
    startAiTx(async () => {
      const result = await draftAiReplyAction(threadId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody(result.data.body);
      // Keep focus on the textarea so the operator can edit immediately.
      if (textareaRef.current) {
        textareaRef.current.focus();
        // Cursor at end of inserted draft.
        textareaRef.current.setSelectionRange(result.data.body.length, result.data.body.length);
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
          {/* AI draft — opt-in. Disabled while a send is in flight
              or another draft is being generated. Violet accent
              matches the suggested-next-action row (the engine's
              convention for AI-assisted affordances). */}
          <button
            type="button"
            onClick={runAiDraft}
            disabled={pending || aiPending}
            title="Generate a draft reply with AI (you'll review + edit before sending)"
            className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2.5 py-1 font-medium text-violet-700 text-xs hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700/60 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/40"
          >
            {aiPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            AI draft
          </button>
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

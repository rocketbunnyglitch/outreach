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
import { Loader2, Send, X } from "lucide-react";
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
  const [pending, startTx] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  function send(bypass = false) {
    setError(null);
    if (!body.trim()) {
      setError("Reply body can't be empty.");
      return;
    }
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("body", body);
      if (bypass) fd.set("bypassCap", "1");
      const result = await sendThreadReply(null, fd);
      if (!result.ok) {
        setError(result.error);
        // Heuristic: "Daily cold-send cap reached" is the prefix the
        // server returns on a cap block. Surface the bypass affordance.
        setCapBlocked(result.error.startsWith("Daily cold-send cap reached"));
        return;
      }
      setBody("");
      setExpanded(false);
      setCapBlocked(false);
      router.refresh();
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
            send();
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
          }}
          disabled={pending}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
        <div className="flex items-center gap-2">
          {capBlocked && isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => send(true)}
              disabled={pending || !body.trim()}
              className="text-amber-700 dark:text-amber-300"
            >
              Bypass cap
            </Button>
          )}
          <Button onClick={() => send(false)} disabled={pending || !body.trim()} size="sm">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

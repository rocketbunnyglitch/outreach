"use client";

/**
 * ThreadNotesBlock — renders the internal-notes feed on a thread
 * with an inline composer.
 *
 * Sits in the CRM rail (Phase D). Markdown is NOT supported; @-mentions
 * are detected in the body string and bolded in the rendered output.
 *
 * Layout:
 *   - Header (icon + count + collapse toggle)
 *   - Composer (textarea, Ctrl/Cmd+Enter to send)
 *   - Notes feed (newest first)
 *
 * Notes are append-only from the operator's perspective. The author
 * can soft-delete their own note via the per-row trash icon. There's
 * no edit-in-place — operators add a follow-up note instead.
 */

import type { ThreadNoteRow } from "@/lib/thread-notes";
import { Loader2, MessageSquareText, Send, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createThreadNoteAction, deleteThreadNoteAction } from "../_actions-notes";

interface Props {
  threadId: string;
  notes: ThreadNoteRow[];
  /** Currently-logged-in staff id; the per-row delete button only
   *  renders on the author's own notes. */
  currentStaffId: string;
}

export function ThreadNotesBlock({ threadId, notes, currentStaffId }: Props) {
  const [draft, setDraft] = useState("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Mount gate: formatRelative reads Date.now() during render -> SSR vs
  // client divergence -> #418. Show a stable date until mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Auto-grow the textarea up to ~120px tall.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
  }, []);

  function submit() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    startTx(async () => {
      const res = await createThreadNoteAction({ threadId, body });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save note.");
        return;
      }
      setDraft("");
      router.refresh();
    });
  }

  function handleDelete(noteId: string) {
    setError(null);
    startTx(async () => {
      const res = await deleteThreadNoteAction({ noteId });
      if (!res.ok) setError(res.error ?? "Couldn't delete.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
          <MessageSquareText className="h-3 w-3" />
          Internal notes ({notes.length})
        </h3>
      </div>

      {/* Composer */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50/40 p-2 dark:border-zinc-800 dark:bg-zinc-900/30">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Internal note — @mention teammates to notify them. Ctrl/Cmd+Enter to send."
          disabled={pending}
          rows={2}
          maxLength={2000}
          className="w-full resize-none border-none bg-transparent text-xs leading-relaxed focus:outline-none disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="font-mono text-[9px] text-zinc-400">
            {draft.length > 0 && `${draft.length} / 2000`}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !draft.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 font-medium text-[10px] text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Send className="h-2.5 w-2.5" />
            )}
            Add note
          </button>
        </div>
        {error && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">{error}</p>}
      </div>

      {/* Notes feed */}
      {notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group flex items-start gap-2 rounded-md bg-amber-50/40 p-2 dark:bg-amber-950/10"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-800 leading-relaxed dark:text-zinc-200">
                  {renderNoteBody(n.body, n.mentionedNames)}
                </p>
                <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-zinc-500">
                  <span>{n.authorName ?? "Unknown"}</span>
                  <span>·</span>
                  <span suppressHydrationWarning>
                    {mounted ? formatRelative(n.createdAt) : n.createdAt.toISOString().slice(0, 10)}
                  </span>
                  {n.mentionedNames.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-300">
                        <Sparkles className="h-2 w-2" />
                        notified {n.mentionedNames.length}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {n.authorId === currentStaffId && (
                <button
                  type="button"
                  onClick={() => handleDelete(n.id)}
                  disabled={pending}
                  title="Delete note"
                  className="invisible shrink-0 rounded p-1 text-zinc-400 hover:text-rose-600 group-hover:visible dark:hover:text-rose-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Render the note body, bolding any @-tokens that resolved to a
 *  real teammate. Otherwise the token renders as plain text. */
function renderNoteBody(body: string, mentionedNames: string[]): React.ReactNode {
  if (mentionedNames.length === 0) return body;
  // Build a Set of normalized first-tokens we should bold.
  const normSet = new Set(
    mentionedNames.map(
      (n) =>
        n
          .toLowerCase()
          .split(/\s+/)[0]
          ?.replace(/[^a-z0-9]/g, "") ?? "",
    ),
  );
  const parts: React.ReactNode[] = [];
  const re = /@([a-z0-9][a-z0-9._-]{1,30})/gi;
  let lastIdx = 0;
  let key = 0;
  re.lastIndex = 0;
  for (;;) {
    const m = re.exec(body);
    if (m === null) break;
    if (m.index > lastIdx) parts.push(body.slice(lastIdx, m.index));
    const tok = m[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
    if (normSet.has(tok)) {
      key++;
      parts.push(
        <span
          key={key}
          className="rounded-sm bg-violet-100 px-0.5 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
        >
          {m[0]}
        </span>,
      );
    } else {
      parts.push(m[0]);
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) parts.push(body.slice(lastIdx));
  return parts;
}

function formatRelative(d: Date): string {
  // hydration-safe-tz: rendered only when `mounted` + under suppressHydrationWarning
  // (SSR/first paint show an ISO date), so this local-tz branch never mismatches.
  const now = Date.now();
  const ts = d.getTime();
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { NoteRow } from "@/lib/notes";
import type { PendingSuggestion } from "@/lib/smart-notes-queries";
import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { NoteSuggestions } from "./note-suggestions";

interface NotesSectionProps {
  targetType: "venue" | "city_campaign" | "campaign" | "event";
  targetId: string;
  notes: NoteRow[];
  /**
   * Map of note_id → pending smart-note suggestions. When set, each
   * note card renders the Accept/Edit/Dismiss panel beneath the body.
   */
  suggestionsByNote?: Record<string, PendingSuggestion[]>;
  acceptSuggestionAction?: (
    prev: unknown,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string; data?: { taskId: string } }>;
  dismissSuggestionAction?: (
    prev: unknown,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string; data?: { id: string } }>;
  createAction: (
    prev: unknown,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string; data?: { id: string } }>;
  deleteAction: (
    prev: unknown,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string; data?: { id: string } }>;
}

/**
 * Notes panel — composable on any detail page (venue, city_campaign,
 * campaign). Shows a list of existing notes with author + timestamp,
 * plus a compose box at the top.
 *
 * @mention parsing happens server-side; the UI just shows `@handle` in
 * a different color when present in a note body. Mentioned staff get
 * highlighted on the note card itself ("mentioned: <names>").
 */
export function NotesSection({
  targetType,
  targetId,
  notes,
  suggestionsByNote,
  acceptSuggestionAction,
  dismissSuggestionAction,
  createAction,
  deleteAction,
}: NotesSectionProps) {
  const [createState, doCreate, creating] = useActionState(createAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [bodyDraft, setBodyDraft] = useState("");

  // Clear the textarea on successful submit
  if (createState?.ok && bodyDraft !== "" && !creating) {
    setBodyDraft("");
    formRef.current?.reset();
  }

  return (
    <section className="card-surface flex flex-col gap-4 p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
          <MessageSquare className="h-4 w-4 text-zinc-500" />
          Activity &amp; notes
          {notes.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono font-normal text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {notes.length}
            </span>
          )}
        </h2>
        <p className="hidden text-[10px] text-zinc-400 sm:block">
          Each note is logged with author + time. Append anytime.
        </p>
      </header>

      <form ref={formRef} action={doCreate} className="flex flex-col gap-2">
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <Textarea
          name="body"
          rows={5}
          value={bodyDraft}
          onChange={(e) => setBodyDraft(e.target.value)}
          placeholder="Add a remark, call summary, follow-up note, or context for the team. Use @name to mention a teammate."
          maxLength={8000}
          className="resize-y"
        />
        {createState && !createState.ok && createState.error && (
          <Alert tone="error">{createState.error}</Alert>
        )}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] text-zinc-400">Cmd/Ctrl + Enter to submit</p>
          <Button type="submit" disabled={creating || bodyDraft.trim().length === 0} size="sm">
            {creating && <Loader2 className="h-3 w-3 animate-spin" />}
            Post note
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 border-dashed bg-zinc-50/50 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <p className="text-sm text-zinc-500">No notes yet.</p>
          <p className="mt-1 text-xs text-zinc-400">
            Notes become the running journal for this record.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              deleteAction={deleteAction}
              suggestions={suggestionsByNote?.[note.id] ?? []}
              acceptSuggestionAction={acceptSuggestionAction}
              dismissSuggestionAction={dismissSuggestionAction}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteCard({
  note,
  deleteAction,
  suggestions,
  acceptSuggestionAction,
  dismissSuggestionAction,
}: {
  note: NoteRow;
  deleteAction: NotesSectionProps["deleteAction"];
  suggestions: PendingSuggestion[];
  acceptSuggestionAction?: NotesSectionProps["acceptSuggestionAction"];
  dismissSuggestionAction?: NotesSectionProps["dismissSuggestionAction"];
}) {
  const [delState, doDelete, deleting] = useActionState(deleteAction, null);
  const [confirming, setConfirming] = useState(false);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 transition-colors dark:border-zinc-800",
        note.isOwnNote ? "bg-zinc-50/60 dark:bg-zinc-900/40" : "bg-white dark:bg-zinc-900/70",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 font-mono text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
            aria-hidden
          >
            {authorInitials(note.authorName)}
          </span>
          <span className="truncate font-semibold text-xs">
            {note.authorName}
            {note.isOwnNote && (
              <span className="ml-1 font-mono font-normal text-[10px] text-zinc-500 uppercase tracking-wider">
                you
              </span>
            )}
          </span>
          {/* suppressHydrationWarning: both the relative-time text
              (formatRelative reads the clock) and the title (locale-
              dependent toLocaleString) legitimately differ between the
              server render and client hydration. Without this the text
              mismatch throws React #418; inside a streaming Suspense
              boundary that can bail the whole page's hydration. */}
          <span
            suppressHydrationWarning
            className="font-mono text-[10px] text-zinc-500 tabular-nums"
            title={note.createdAt.toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          >
            {formatRelative(note.createdAt)}
          </span>
        </div>
        {note.isOwnNote && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-zinc-400 transition-colors hover:text-rose-500"
            title="Delete note"
            aria-label="Delete note"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {confirming && (
          <form action={doDelete} className="inline-flex items-center gap-2">
            <input type="hidden" name="id" value={note.id} />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={deleting}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-500 uppercase tracking-wider hover:text-rose-700"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              confirm delete
            </button>
          </form>
        )}
      </div>

      <p className="whitespace-pre-wrap text-sm text-zinc-800 leading-relaxed dark:text-zinc-200">
        {renderBodyWithMentions(note.body)}
      </p>

      {note.mentions.length > 0 && (
        <p className="font-mono text-[10px] text-zinc-500">
          mentioned: {note.mentions.length}{" "}
          {note.mentions.length === 1 ? "staff member" : "staff members"}
        </p>
      )}

      {acceptSuggestionAction && dismissSuggestionAction && suggestions.length > 0 && (
        <NoteSuggestions
          suggestions={suggestions}
          acceptAction={acceptSuggestionAction}
          dismissAction={dismissSuggestionAction}
        />
      )}

      {delState && !delState.ok && delState.error && (
        <p className="text-rose-500 text-xs">{delState.error}</p>
      )}
    </li>
  );
}

/**
 * Render a note body with @mentions styled as light-blue tokens. Splits
 * on @-handle boundaries; everything else flows as plain text.
 */
function renderBodyWithMentions(body: string): React.ReactNode {
  const parts = body.split(/(@[a-zA-Z0-9_.]{1,30})/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts array is deterministic per body; index is stable
      <span key={i} className="font-medium text-blue-600 dark:text-blue-400">
        {p}
      </span>
    ) : (
      p
    ),
  );
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "?";
}

function formatRelative(d: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: diffDays > 365 ? "numeric" : undefined,
  });
}

"use client";

import type { PendingSuggestion } from "@/lib/smart-notes-queries";
import { CheckCircle2, Lightbulb, Loader2, Pencil, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

interface Props {
  suggestions: PendingSuggestion[];
  acceptAction: (
    prev: unknown,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string; data?: { taskId: string } }>;
  dismissAction: (
    prev: unknown,
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string; data?: { id: string } }>;
}

const ACTION_TYPE_LABEL: Record<string, string> = {
  call: "Call",
  venue_callback: "Callback",
  follow_up_email: "Follow-up email",
  confirmation_reminder: "Confirmation",
  poster_send: "Poster send",
  wristband_task: "Wristband",
  missing_info_task: "Missing info",
  reminder: "Reminder",
  custom: "Task",
};

const ACTION_TYPE_TONE: Record<string, string> = {
  call: "text-blue-500 bg-blue-500/10 ring-blue-500/20",
  venue_callback: "text-blue-500 bg-blue-500/10 ring-blue-500/20",
  follow_up_email: "text-teal-500 bg-teal-500/10 ring-teal-500/20",
  confirmation_reminder: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
  poster_send: "text-violet-500 bg-violet-500/10 ring-violet-500/20",
  wristband_task: "text-amber-500 bg-amber-500/10 ring-amber-500/20",
  missing_info_task: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
  reminder: "text-zinc-500 bg-zinc-500/10 ring-zinc-500/20",
  custom: "text-zinc-500 bg-zinc-500/10 ring-zinc-500/20",
};

export function NoteSuggestions({ suggestions, acceptAction, dismissAction }: Props) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2 border-zinc-200 border-t pt-2 dark:border-zinc-800/60">
      <p className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
        <Sparkles className="h-3 w-3 text-amber-500" />
        Suggested action{suggestions.length > 1 ? "s" : ""}
      </p>
      {suggestions.map((s) => (
        <SuggestionRow
          key={s.id}
          suggestion={s}
          acceptAction={acceptAction}
          dismissAction={dismissAction}
        />
      ))}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  acceptAction,
  dismissAction,
}: {
  suggestion: PendingSuggestion;
  acceptAction: Props["acceptAction"];
  dismissAction: Props["dismissAction"];
}) {
  const [acceptState, doAccept, accepting] = useActionState(acceptAction, null);
  const [dismissState, doDismiss, dismissing] = useActionState(dismissAction, null);
  const [hidden, setHidden] = useState(false);

  // Once accepted or dismissed, hide locally so it disappears without a refresh
  const done = hidden || (acceptState?.ok && !accepting) || (dismissState?.ok && !dismissing);
  if (done) return null;

  const tone = ACTION_TYPE_TONE[suggestion.actionType] ?? ACTION_TYPE_TONE.custom;
  const label = ACTION_TYPE_LABEL[suggestion.actionType] ?? "Task";

  const editHref = `/tasks/new?${new URLSearchParams({
    title: suggestion.title,
    description: suggestion.description,
    ...(suggestion.dueAt ? { dueAt: suggestion.dueAt.toISOString() } : {}),
    ...(suggestion.venueId ? { targetType: "venue", targetId: suggestion.venueId } : {}),
    fromSuggestionId: suggestion.id,
  }).toString()}`;

  const dueLabel = suggestion.dueAt
    ? formatDueAt(suggestion.dueAt, suggestion.timezone)
    : "no time set";

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset ${tone}`}
            >
              {label}
            </span>
            <span className="font-medium text-sm">{suggestion.title}</span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-zinc-600 tabular-nums dark:text-zinc-400">
            <Lightbulb className="mr-1 inline h-3 w-3" />
            {dueLabel}
            {suggestion.phoneE164 && (
              <span className="ml-2 text-zinc-500">· {suggestion.phoneE164}</span>
            )}
            <span className="ml-2 text-zinc-500">· {suggestion.confidence} confidence</span>
          </p>
          <p className="mt-1.5 line-clamp-2 text-xs text-zinc-600 italic dark:text-zinc-400">
            “{suggestion.sourceText}”
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <form
            action={(fd) => {
              doAccept(fd);
              setHidden(true);
            }}
          >
            <input type="hidden" name="id" value={suggestion.id} />
            <button
              type="submit"
              disabled={accepting || dismissing}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-xs text-zinc-50 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {accepting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              Create
            </button>
          </form>
          <Link
            href={editHref}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Link>
          <form
            action={(fd) => {
              doDismiss(fd);
              setHidden(true);
            }}
          >
            <input type="hidden" name="id" value={suggestion.id} />
            <button
              type="submit"
              disabled={accepting || dismissing}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              {dismissing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Dismiss
            </button>
          </form>
        </div>
      </div>
      {acceptState?.ok === false && acceptState.error && (
        <p className="mt-2 text-rose-500 text-xs">{acceptState.error}</p>
      )}
      {dismissState?.ok === false && dismissState.error && (
        <p className="mt-2 text-rose-500 text-xs">{dismissState.error}</p>
      )}
    </div>
  );
}

function formatDueAt(d: Date, tz: string): string {
  try {
    // Display in the venue/city timezone with TZ abbrev when non-UTC
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

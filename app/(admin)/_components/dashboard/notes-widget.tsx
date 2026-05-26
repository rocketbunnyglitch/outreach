import { cn } from "@/lib/cn";
import type { RecentNoteRow } from "@/lib/dashboard-queries";
import { MessageSquare } from "lucide-react";
import Link from "next/link";

interface Props {
  notes: RecentNoteRow[];
}

/**
 * Dashboard widget showing recent notes across all venues, city-campaigns,
 * and campaigns. Click-through to the target detail page.
 *
 * Body is excerpted to ~140 chars to keep cards compact. @mentions stay
 * in the text but render in the default color here (saved color for the
 * full note page).
 */
export function NotesWidget({ notes }: Props) {
  return (
    <div className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200 border-b bg-zinc-100/60 px-4 py-2.5 dark:border-zinc-800/60 dark:bg-zinc-900/30">
        <h2 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Recent notes
        </h2>
        <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
          {notes.length} latest
        </span>
      </header>

      {notes.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <MessageSquare className="mx-auto h-5 w-5 text-zinc-400" />
          <p className="mt-3 font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
            No notes yet
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Notes added on venues or city-campaigns show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800/60">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                href={targetHref(note.targetType, note.targetId)}
                className="block px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate font-semibold text-xs tracking-tight">
                    {note.authorName}
                    <span className="ml-2 font-mono font-normal text-[10px] text-zinc-500 uppercase tracking-wider">
                      on {targetLabel(note.targetType)}
                    </span>
                  </p>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                    {formatRelative(note.createdAt)}
                  </span>
                </div>
                <p className="mt-1 truncate font-medium text-xs text-zinc-700 dark:text-zinc-300">
                  {note.targetName}
                </p>
                <p
                  className={cn(
                    "mt-2 text-[13px] text-zinc-700 leading-relaxed dark:text-zinc-300",
                    "line-clamp-2",
                  )}
                >
                  {excerpt(note.body)}
                </p>
                {note.mentionCount > 0 && (
                  <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                    mentioned {note.mentionCount}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function targetHref(type: RecentNoteRow["targetType"], id: string): string {
  if (type === "venue") return `/venues/${id}`;
  if (type === "city_campaign") return `/city-campaigns/${id}`;
  return `/campaigns/${id}`;
}

function targetLabel(type: RecentNoteRow["targetType"]): string {
  if (type === "venue") return "venue";
  if (type === "city_campaign") return "city × campaign";
  return "campaign";
}

function excerpt(body: string, maxChars = 140): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

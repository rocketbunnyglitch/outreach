import { requireStaff } from "@/lib/auth";
import { loadMentionsFeed } from "@/lib/mentions-feed";
import Link from "next/link";
import { AcknowledgeMentionButton } from "./_components/AcknowledgeMentionButton";

/**
 * /inbox/mentions - dedicated feed of every unacknowledged @-mention for the
 * current operator, with thread + venue context and an inline acknowledge on
 * each card. Complements the count-only "mentioned" scope chip.
 *
 * Server component: relative-time formatting here runs only on the server
 * (RSC output is not re-hydrated on the client), so there is no server/client
 * clock mismatch to worry about.
 */
export const dynamic = "force-dynamic";

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function excerpt(body: string | null, max = 240): string {
  if (!body) return "";
  const t = body.trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

export default async function MentionsPage() {
  const { staff } = await requireStaff();
  const items = await loadMentionsFeed({ currentUserId: staff.id, limit: 100 });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">Mentions</h1>
          <p className="mt-0.5 text-xs text-zinc-500">Notes where a teammate @-tagged you.</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-zinc-500 tabular-nums">
          {items.length} unread
        </span>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 border-dashed px-4 py-12 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No unread mentions.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-medium text-sm">
                      {m.venueName ?? "Unassigned"}
                    </span>
                    {m.threadSubject && (
                      <span className="truncate text-xs text-zinc-500">{m.threadSubject}</span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                    {excerpt(m.noteBody)}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                    {m.authorName ?? "Someone"} . {relativeTime(m.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <AcknowledgeMentionButton noteId={m.id} />
                  <Link
                    href={`/inbox/${m.threadId}`}
                    className="font-medium text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Open thread
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

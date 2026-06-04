"use client";

/**
 * Graphics queue (Graphics tab on /crawl-management). The open list of social
 * media graphics still to be CREATED -- the auto graphics task the confirmation
 * cascade assigns to the graphics designer, not yet completed. "Mark created"
 * completes that task (reusing the tasks completeTask action) and drops the row
 * off the queue. The "sent to venue" step is the social_media_graphics cell on
 * the Deliverables tab (lifecycle owner flips it to done). [Graphics workflow]
 */

import { completeTask } from "@/app/(admin)/tasks/_actions";
import type { GraphicsQueueRow } from "@/lib/crawl-management-data";
import { CheckCircle2, ImageIcon, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

export function GraphicsQueue({ rows }: { rows: GraphicsQueueRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 border-dashed bg-zinc-50/50 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
        <p className="text-sm text-zinc-500">No graphics waiting.</p>
        <p className="mt-1 text-xs text-zinc-400">
          When a venue is confirmed, a graphic is flagged here and assigned to the graphics
          designer.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <GraphicsRow key={r.taskId} row={r} />
      ))}
    </div>
  );
}

function GraphicsRow({ row }: { row: GraphicsQueueRow }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(completeTask, null);

  // completeTask revalidates /tasks + / but not /crawl-management, so refresh
  // the queue client-side once the task is marked created.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-sm">
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-violet-500" />
            <span className="truncate">{row.venueName}</span>
            {row.cityName ? <span className="text-zinc-500">{`· ${row.cityName}`}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {`Event ${row.eventDate}`}
            {row.assigneeName ? ` · ${row.assigneeName}` : " · unassigned"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={`/venues/${row.venueId}`}
            className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Venue
          </Link>
          <form action={formAction}>
            <input type="hidden" name="id" value={row.taskId} />
            <input type="hidden" name="version" value={row.taskVersion} />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-white text-xs hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              Mark created
            </button>
          </form>
        </div>
      </div>
      {state && !state.ok && state.error ? (
        <p className="text-right text-[11px] text-rose-500">{state.error}</p>
      ) : null}
    </div>
  );
}

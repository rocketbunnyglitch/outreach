import type { BoardCard, LifecycleBoard as LifecycleBoardData } from "@/lib/pipeline-board";
import type { LaneKey } from "@/lib/pipeline-board-core";
import Link from "next/link";

/**
 * Venue lifecycle kanban (Phase 10, read-only v1). Horizontal lanes, each a
 * pipeline stage; cards drill through to the venue. Pure server component (no
 * hooks) -> no hydration risk. Dates are formatted here (UTC-pinned, the column
 * is a plain date).
 */

const ACCENT: Record<LaneKey, string> = {
  lead: "bg-zinc-400",
  contacted: "bg-sky-500",
  warm: "bg-amber-500",
  negotiating: "bg-violet-500",
  confirmed: "bg-indigo-500",
  ready: "bg-emerald-500",
  completed: "bg-emerald-600/60",
  cancelled: "bg-rose-500",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt final",
};

const CARDS_PER_LANE = 40;

function shortDate(eventDate: string): string {
  const d = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return eventDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function whenLabel(days: number | null): string {
  if (days == null) return "";
  if (days < 0) return "passed";
  if (days === 0) return "today";
  return `in ${days}d`;
}

function Card({ card }: { card: BoardCard }) {
  return (
    <Link
      href={`/venues/${card.venueId}`}
      className="card-surface flex flex-col gap-1 p-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
    >
      <p className="truncate font-medium text-sm">{card.venueName}</p>
      <p className="truncate text-xs text-zinc-500">
        {card.cityName} · {ROLE_LABEL[card.role] ?? card.role}
      </p>
      <p className="font-mono text-[10px] text-zinc-400 tabular-nums">
        {shortDate(card.eventDate)}
        {card.daysToEvent != null ? ` · ${whenLabel(card.daysToEvent)}` : ""}
      </p>
    </Link>
  );
}

export function LifecycleBoard({ board }: { board: LifecycleBoardData }) {
  if (board.total === 0) {
    return (
      <div className="card-surface p-8 text-center text-sm text-zinc-500">
        No venues in this campaign's pipeline yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {board.truncated && (
        <p className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
          Showing the most-recently-updated {board.total} venues.
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {board.lanes.map((lane) => {
          const shown = lane.items.slice(0, CARDS_PER_LANE);
          const overflow = lane.items.length - shown.length;
          return (
            <section key={lane.key} className="flex w-64 shrink-0 flex-col gap-2">
              <header className="flex items-center justify-between gap-2 px-0.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${ACCENT[lane.key]}`} />
                  <h2 className="font-semibold text-sm tracking-tight">{lane.label}</h2>
                </div>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  {lane.items.length}
                </span>
              </header>
              <div className="flex flex-col gap-2 rounded-lg bg-zinc-100/60 p-2 dark:bg-zinc-900/40">
                {shown.length === 0 ? (
                  <p className="px-1 py-3 text-center text-[11px] text-zinc-400">—</p>
                ) : (
                  shown.map((c) => <Card key={c.venueEventId} card={c} />)
                )}
                {overflow > 0 && (
                  <p className="px-1 pt-1 font-mono text-[10px] text-zinc-400">+ {overflow} more</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

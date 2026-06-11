import type {
  PostConfirmBoard as PostConfirmBoardData,
  PostConfirmCard,
} from "@/lib/post-confirm-board";
import type { PostConfirmLane } from "@/lib/post-confirm-board-core";
import Link from "next/link";

/**
 * Post-confirm kanban (Phase 10, read-only). Each confirmed venue sits in its
 * outstanding-step lane (Graphic -> Sheet -> T13 -> T14 -> V2 -> Ready). Cards
 * drill through to the venue. Pure server component -> no hydration risk; the
 * date is pre-formatted in the loader.
 */

const ACCENT: Record<PostConfirmLane, string> = {
  graphic: "bg-violet-500",
  sheet: "bg-sky-500",
  t13: "bg-amber-500",
  t14: "bg-orange-500",
  v2: "bg-rose-500",
  on_track: "bg-zinc-400",
  ready: "bg-emerald-500",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt final",
};

const CARDS_PER_LANE = 40;

function whenLabel(days: number | null): string {
  if (days == null) return "";
  if (days < 0) return "passed";
  if (days === 0) return "today";
  return `in ${days}d`;
}

function Card({ card }: { card: PostConfirmCard }) {
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
        {card.dateLabel}
        {card.daysToEvent != null ? ` · ${whenLabel(card.daysToEvent)}` : ""}
      </p>
    </Link>
  );
}

export function PostConfirmBoard({ board }: { board: PostConfirmBoardData }) {
  if (board.total === 0) {
    return (
      <div className="card-surface p-8 text-center text-sm text-zinc-500">
        No confirmed venues in this campaign yet.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {board.columns.map((lane) => {
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
  );
}

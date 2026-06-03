"use client";

import { useHydrated } from "@/components/ui/use-hydrated";
import type { CalendarItem, CalendarItemType } from "@/lib/calendar";
import { cn } from "@/lib/cn";
import { AlertTriangle, Calendar as CalendarIcon, Sparkles } from "lucide-react";
import Link from "next/link";

interface Props {
  items: CalendarItem[];
  view: "week" | "day" | "month" | "agenda";
  /** First day of the visible range, midnight in user's TZ */
  rangeStart: Date;
  /** Last day visible (inclusive), midnight in user's TZ */
  rangeEnd: Date;
  /** Whether the viewer can drag-drop reschedule (default: true) */
  canReschedule?: boolean;
  /** Form action for reschedule */
  rescheduleAction: (fd: FormData) => Promise<void>;
}

const ITEM_COLOR: Record<CalendarItemType, string> = {
  call: "bg-blue-500/15 text-blue-700 border-l-blue-500 dark:text-blue-300",
  venue_callback: "bg-blue-500/15 text-blue-700 border-l-blue-500 dark:text-blue-300",
  follow_up_email: "bg-teal-500/15 text-teal-700 border-l-teal-500 dark:text-teal-300",
  confirmation_reminder:
    "bg-emerald-500/15 text-emerald-700 border-l-emerald-500 dark:text-emerald-300",
  poster_send: "bg-violet-500/15 text-violet-700 border-l-violet-500 dark:text-violet-300",
  wristband_task: "bg-amber-500/15 text-amber-700 border-l-amber-500 dark:text-amber-300",
  missing_info_task: "bg-rose-500/15 text-rose-700 border-l-rose-500 dark:text-rose-300",
  reminder: "bg-zinc-500/15 text-zinc-700 border-l-zinc-500 dark:text-zinc-300",
  venue_deadline: "bg-purple-500/15 text-purple-700 border-l-purple-500 dark:text-purple-300",
  internal_meeting: "bg-zinc-500/15 text-zinc-700 border-l-zinc-500 dark:text-zinc-300",
  custom: "bg-zinc-500/15 text-zinc-700 border-l-zinc-500 dark:text-zinc-300",
};

const OVERDUE_OVERLAY = "ring-1 ring-rose-500/40";

export function CalendarGrid(props: Props) {
  const { items, view, rangeStart, rangeEnd, canReschedule, rescheduleAction } = props;
  const childProps = { canReschedule, rescheduleAction };

  // Day buckets — keyed by YYYY-MM-DD in user's local TZ
  const buckets = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = isoDate(item.dueAt);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  // Build day list across the range
  const days: Date[] = [];
  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  if (view === "agenda") {
    return <AgendaView items={items} days={days} buckets={buckets} />;
  }

  if (view === "day") {
    return (
      <div className="card-surface overflow-hidden">
        <DayColumn
          day={days[0] ?? rangeStart}
          items={buckets.get(isoDate(days[0] ?? rangeStart)) ?? []}
          showHours
          {...childProps}
        />
      </div>
    );
  }

  // Week or month — grid of DayColumns
  const cols = view === "week" ? 7 : Math.min(days.length, 7);
  return (
    <div className="card-surface overflow-hidden">
      <div
        className="grid divide-x divide-zinc-200 dark:divide-zinc-800/60"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {days.map((d) => (
          <DayColumn
            key={isoDate(d)}
            day={d}
            items={buckets.get(isoDate(d)) ?? []}
            showHours={false}
            {...childProps}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  items,
  showHours,
  canReschedule = true,
  rescheduleAction,
}: {
  day: Date;
  items: CalendarItem[];
  showHours: boolean;
} & Pick<Props, "canReschedule" | "rescheduleAction">) {
  // "today"/"past" depend on the wall clock — gate behind hydration so the
  // server and the client's FIRST render agree (both render no today/past
  // highlight), then the real state applies post-mount. Computing
  // `new Date()` directly here made each day cell's className differ between
  // server and client → React #418 → frozen calendar.
  const hydrated = useHydrated();
  const now = hydrated ? new Date() : null;
  const isToday = now ? isSameDay(day, now) : false;
  const isPast = now ? day.getTime() < startOfDay(now).getTime() && !isToday : false;

  // Group items by hour for the hour-banded view
  const byHour = new Map<number, CalendarItem[]>();
  for (const item of items) {
    const hour = item.dueAt.getHours();
    const list = byHour.get(hour) ?? [];
    list.push(item);
    byHour.set(hour, list);
  }

  return (
    <div
      className={cn("flex flex-col", isPast && "opacity-60", isToday && "bg-blue-500/[0.04]")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (!canReschedule) return;
        const taskId = e.dataTransfer.getData("application/x-task-id");
        const version = e.dataTransfer.getData("application/x-task-version");
        if (!taskId || !version) return;
        // Drop on a column → keep the same time-of-day, change the date.
        // We get the original time from the dragged element via a data attr,
        // but for simplicity we drop at noon if we can't read it.
        const originalIso = e.dataTransfer.getData("application/x-task-due-iso");
        const original = originalIso ? new Date(originalIso) : null;
        const newDate = new Date(day);
        if (original) {
          newDate.setHours(original.getHours(), original.getMinutes(), 0, 0);
        } else {
          newDate.setHours(12, 0, 0, 0);
        }
        const fd = new FormData();
        fd.set("taskId", taskId);
        fd.set("version", version);
        fd.set("dueAt", newDate.toISOString());
        void rescheduleAction(fd);
      }}
    >
      {/* Header */}
      <header className="border-zinc-200 border-b px-2 py-1.5 dark:border-zinc-800/60">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          {day.toLocaleDateString("en-US", { weekday: "short" })}
        </p>
        <p className={cn("font-semibold text-sm tabular-nums", isToday && "text-blue-500")}>
          {day.getDate()}
        </p>
      </header>

      {/* Body */}
      <div className="flex min-h-[160px] flex-col gap-1 p-1.5">
        {items.length === 0 ? (
          <div className="grow" aria-hidden />
        ) : showHours ? (
          // Day view: hour bands
          <div className="flex flex-col gap-2">
            {Array.from({ length: 14 }, (_, i) => i + 8).map((hour) => {
              const list = byHour.get(hour) ?? [];
              return (
                <div key={hour} className="flex gap-2">
                  <span className="w-10 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-500 tabular-nums">
                    {hour}:00
                  </span>
                  <div className="flex grow flex-col gap-1 border-zinc-200 border-l pl-2 dark:border-zinc-800/60">
                    {list.map((item) => (
                      <CalendarChip key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Week/month: flat list per day
          items.map((item) => <CalendarChip key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function CalendarChip({ item }: { item: CalendarItem }) {
  const colorClass = ITEM_COLOR[item.itemType] ?? ITEM_COLOR.custom;
  const time = item.dueAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  // Determine the link target — venue > city_campaign > task
  const href = item.venueId
    ? `/venues/${item.venueId}`
    : item.cityCampaignId
      ? `/city-campaigns/${item.cityCampaignId}`
      : `/tasks/${item.id}`;

  return (
    <Link
      href={href}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-task-id", item.id);
        // We don't have version in the calendar item; use 1 as a sane
        // default. The action will fail with optimistic-lock error and
        // the UI will tell the user to refresh. Acceptable tradeoff to
        // avoid plumbing version through.
        e.dataTransfer.setData("application/x-task-version", "1");
        e.dataTransfer.setData("application/x-task-due-iso", item.dueAt.toISOString());
      }}
      className={cn(
        "group block cursor-grab rounded-md border-l-2 px-2 py-1.5 text-xs transition-shadow hover:shadow-sm active:cursor-grabbing",
        colorClass,
        item.overdue && OVERDUE_OVERLAY,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tabular-nums opacity-70">{time}</span>
        <span className="flex items-center gap-1">
          {item.overdue && <AlertTriangle className="h-2.5 w-2.5" />}
          {item.source === "smart_note" && <Sparkles className="h-2.5 w-2.5 opacity-50" />}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 font-medium">{item.title}</p>
      {item.venueName && (
        <p className="mt-0.5 truncate font-mono text-[10px] opacity-70">{item.venueName}</p>
      )}
      {item.assignedStaffName && (
        <p className="font-mono text-[10px] opacity-50">→ {item.assignedStaffName}</p>
      )}
    </Link>
  );
}

function AgendaView({
  items,
  days,
  buckets,
}: {
  items: CalendarItem[];
  days: Date[];
  buckets: Map<string, CalendarItem[]>;
}) {
  if (items.length === 0) {
    return (
      <div className="card-surface border-dashed p-12 text-center">
        <CalendarIcon className="mx-auto h-8 w-8 text-zinc-400" />
        <h3 className="mt-4 font-semibold text-2xl tracking-tight">Nothing scheduled</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          No tasks with a due date in this range. Smart-note actions and the confirmation cascade
          will populate the calendar automatically as you work.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {days
        .filter((d) => (buckets.get(isoDate(d)) ?? []).length > 0)
        .map((day) => {
          const dayItems = buckets.get(isoDate(day)) ?? [];
          const isToday = isSameDay(day, new Date());
          return (
            <section key={isoDate(day)} className="card-surface p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h3 className="font-semibold text-lg tracking-tight">
                  {day.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  {isToday && (
                    <span className="ml-2 font-mono text-[10px] text-blue-500 uppercase tracking-widest">
                      Today
                    </span>
                  )}
                </h3>
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  {dayItems.length} item{dayItems.length === 1 ? "" : "s"}
                </p>
              </header>
              <ul className="flex flex-col gap-2">
                {dayItems.map((item) => (
                  <li key={item.id}>
                    <CalendarChip item={item} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

// ---------- date helpers ----------

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isSameDay(a: Date, b: Date): boolean {
  return isoDate(a) === isoDate(b);
}

import { campaigns, cities, staffMembers } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { type CalendarItemType, loadCalendarItems } from "@/lib/calendar";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { rescheduleTask } from "./_actions";
import { CalendarGrid } from "./_components/calendar-grid";

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const ITEM_TYPES: CalendarItemType[] = [
  "call",
  "venue_callback",
  "follow_up_email",
  "confirmation_reminder",
  "poster_send",
  "wristband_task",
  "missing_info_task",
  "reminder",
];

interface Props {
  searchParams: Promise<{
    view?: string;
    scope?: string;
    staff?: string;
    type?: string;
    campaign?: string;
    city?: string;
    date?: string;
  }>;
}

export default async function CalendarPage({ searchParams }: Props) {
  const params = await searchParams;
  const { staff: currentStaff } = await requireStaff();

  // View: week (default) / day / month / agenda
  const view: "week" | "day" | "month" | "agenda" =
    params.view === "day" || params.view === "month" || params.view === "agenda"
      ? params.view
      : "week";

  // Scope: mine (default) / team
  const teamScope = params.scope === "team";

  // Anchor date — defaults to today
  const anchor = params.date ? new Date(`${params.date}T00:00:00`) : new Date();

  // Range
  const { rangeStart, rangeEnd } = computeRange(view, anchor);

  // Filters
  const filterStaffId = !teamScope
    ? currentStaff.id
    : params.staff && params.staff !== "all"
      ? params.staff
      : null;
  const itemType =
    params.type && ITEM_TYPES.includes(params.type as CalendarItemType)
      ? (params.type as CalendarItemType)
      : null;

  const [items, staffList, campaignList, cityList] = await Promise.all([
    loadCalendarItems({
      assignedStaffId: filterStaffId,
      rangeStart,
      rangeEnd: addDays(rangeEnd, 1), // inclusive end
      itemTypes: itemType ? [itemType] : undefined,
      campaignId: params.campaign && params.campaign !== "all" ? params.campaign : undefined,
      cityId: params.city && params.city !== "all" ? params.city : undefined,
    }),
    teamScope
      ? db
          .select({ id: staffMembers.id, name: staffMembers.displayName })
          .from(staffMembers)
          .where(eq(staffMembers.status, "active"))
          .orderBy(asc(staffMembers.displayName))
      : Promise.resolve([]),
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(isNull(campaigns.archivedAt))
      .orderBy(asc(campaigns.name)),
    db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(isNull(cities.archivedAt))
      .orderBy(asc(cities.name)),
  ]);

  // Stats for the header strip
  const stats = {
    total: items.length,
    overdue: items.filter((i) => i.overdue).length,
    smartNote: items.filter((i) => i.source === "smart_note").length,
  };

  // Range navigation links
  const prevAnchor = shiftAnchor(view, anchor, -1);
  const nextAnchor = shiftAnchor(view, anchor, 1);

  function buildQs(over: Record<string, string | null>): string {
    const q = new URLSearchParams();
    if (view !== "week") q.set("view", view);
    if (teamScope) q.set("scope", "team");
    if (filterStaffId && teamScope) q.set("staff", filterStaffId);
    if (itemType) q.set("type", itemType);
    if (params.campaign && params.campaign !== "all") q.set("campaign", params.campaign);
    if (params.city && params.city !== "all") q.set("city", params.city);
    q.set("date", isoDate(anchor));
    for (const [k, v] of Object.entries(over)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return q.toString();
  }

  // Reschedule action wrapper — calendar grid calls this with a FormData
  async function doReschedule(fd: FormData) {
    "use server";
    await rescheduleTask(null, fd);
  }

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">
            {teamScope ? "Team calendar" : "My calendar"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {teamScope
              ? "All staff tasks across the campaign. Drag a task to reschedule (lead/admin only)."
              : "Your assigned tasks with a due date. Smart-note actions, confirmation cascade, and manual tasks all live here."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {teamScope ? (
            <Link
              href={`/calendar?${buildQs({ scope: null, staff: null })}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              My calendar
            </Link>
          ) : (
            <Link
              href={`/calendar?${buildQs({ scope: "team" })}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <Users className="h-3.5 w-3.5" />
              Team calendar
            </Link>
          )}
        </div>
      </header>

      {/* Toolbar */}
      <section className="card-surface-quiet flex flex-wrap items-center gap-3 p-3">
        {/* View switcher */}
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
          {(["day", "week", "month", "agenda"] as const).map((v) => {
            const active = view === v;
            const href = `/calendar?${new URLSearchParams({
              ...(teamScope ? { scope: "team" } : {}),
              view: v,
              date: isoDate(anchor),
            }).toString()}`;
            return (
              <Link
                key={v}
                href={href}
                className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                  active
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {v}
              </Link>
            );
          })}
        </div>

        {/* Range nav */}
        <div className="inline-flex items-center gap-1">
          <Link
            href={`/calendar?${buildQs({ date: isoDate(prevAnchor) })}`}
            className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={`/calendar?${buildQs({ date: isoDate(new Date()) })}`}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1 font-mono text-[10px] text-zinc-700 uppercase tracking-widest hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Today
          </Link>
          <Link
            href={`/calendar?${buildQs({ date: isoDate(nextAnchor) })}`}
            className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Filters */}
        <form action="/calendar" method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value={view} />
          {teamScope && <input type="hidden" name="scope" value="team" />}
          <input type="hidden" name="date" value={isoDate(anchor)} />

          {teamScope && (
            <select
              name="staff"
              defaultValue={params.staff ?? "all"}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="all">All staff</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <select
            name="type"
            defaultValue={itemType ?? ""}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <select
            name="campaign"
            defaultValue={params.campaign ?? "all"}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="all">All campaigns</option>
            {campaignList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            name="city"
            defaultValue={params.city ?? "all"}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="all">All cities</option>
            {cityList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-xs text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Apply
          </button>
        </form>

        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          <span>{stats.total} items</span>
          {stats.overdue > 0 && <span className="text-rose-500">{stats.overdue} overdue</span>}
          {stats.smartNote > 0 && (
            <span className="text-amber-500">{stats.smartNote} smart-note</span>
          )}
        </div>
      </section>

      {/* Calendar */}
      <CalendarGrid
        items={items}
        view={view}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        rescheduleAction={doReschedule}
      />
    </div>
  );
}

// ---------- date helpers ----------

function computeRange(
  view: "week" | "day" | "month" | "agenda",
  anchor: Date,
): { rangeStart: Date; rangeEnd: Date } {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);

  if (view === "day") {
    return { rangeStart: start, rangeEnd: new Date(start) };
  }

  if (view === "week" || view === "agenda") {
    // Week starts Sunday for now (US default)
    const dow = start.getDay();
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() - dow);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    if (view === "agenda") {
      // Agenda spans 2 weeks for a denser view
      weekEnd.setDate(weekStart.getDate() + 13);
    }
    return { rangeStart: weekStart, rangeEnd: weekEnd };
  }

  // Month: first to last day of month
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { rangeStart: monthStart, rangeEnd: monthEnd };
}

function shiftAnchor(
  view: "week" | "day" | "month" | "agenda",
  anchor: Date,
  direction: -1 | 1,
): Date {
  const next = new Date(anchor);
  if (view === "day") next.setDate(next.getDate() + direction);
  else if (view === "week" || view === "agenda") next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  return next;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

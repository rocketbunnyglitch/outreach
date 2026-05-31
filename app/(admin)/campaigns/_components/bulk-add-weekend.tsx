"use client";

/**
 * BulkAddWeekend — smart multi-pass bulk-add for a whole weekend.
 *
 * Operator session (2026-05-31): they want to compose an entire
 * weekend's crawl schedule in one form instead of clicking through
 * the single-pass bulk-add six times. Concretely:
 *
 *   "for all of these cities I wanna have one crawl on Thursday
 *    night, Friday night, Saturday night"
 *
 *   "for priority 1, 2, 3, and 4 I wanna add another three crawls
 *    for Friday and another three crawls for Saturday"
 *
 *   "also for all these cities I'm going to add a day party on
 *    Saturday — a day crawl"
 *
 * Translates to ~6 passes against addCrawlToAllCities. This form
 * exposes them as a list of editable "passes" backed by the new
 * bulkAddWeekend server action.
 *
 * UX
 * --
 * Two sections:
 *
 *   Section A — Base weekend
 *     Six day-part rows (Thu Night, Fri Night, Sat Day, Sat Night,
 *     Sun Day, Sun Night). Each row has:
 *       * enable toggle
 *       * date input (anchored: picking Thursday auto-fills the
 *         rest as consecutive days)
 *       * slots from-to (default 1-1)
 *       * extended-middle toggle
 *     Applies to ALL cities (no priority filter).
 *
 *   Section B — Extra tiers
 *     Operator can add N priority-filtered passes:
 *       "Also add slots X-Y on [day-part] for priority A-B cities."
 *     Each row mirrors the existing single-pass bulk-add semantics.
 *
 * Submit collects every enabled row → passes[] → bulkAddWeekend.
 * Result banner shows per-pass breakdown (e.g., "Thursday Night ·
 * Oct 30 · slot 1 · all cities: 47 added"). Failed passes are
 * highlighted in rose so the operator can re-run them.
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { bulkAddWeekend } from "../_actions";

type DayPart =
  | "thursday_night"
  | "friday_night"
  | "saturday_day"
  | "saturday_night"
  | "sunday_day"
  | "sunday_night"
  | "other";

const BASE_DAY_PARTS: Array<{
  key: DayPart;
  label: string;
  short: string;
  /** Offset in days from the Thursday anchor (Thu = 0). */
  dayOffset: number;
  /** Enabled by default in the base section. */
  defaultEnabled: boolean;
}> = [
  {
    key: "thursday_night",
    label: "Thursday Night",
    short: "Thu",
    dayOffset: 0,
    defaultEnabled: true,
  },
  { key: "friday_night", label: "Friday Night", short: "Fri", dayOffset: 1, defaultEnabled: true },
  {
    key: "saturday_day",
    label: "Saturday Day",
    short: "Sat-Day",
    dayOffset: 2,
    defaultEnabled: false,
  },
  {
    key: "saturday_night",
    label: "Saturday Night",
    short: "Sat",
    dayOffset: 2,
    defaultEnabled: true,
  },
  { key: "sunday_day", label: "Sunday Day", short: "Sun-Day", dayOffset: 3, defaultEnabled: false },
  { key: "sunday_night", label: "Sunday Night", short: "Sun", dayOffset: 3, defaultEnabled: false },
];

const DAY_PART_LABELS: Record<DayPart, string> = {
  thursday_night: "Thursday Night",
  friday_night: "Friday Night",
  saturday_day: "Saturday Day",
  saturday_night: "Saturday Night",
  sunday_day: "Sunday Day",
  sunday_night: "Sunday Night",
  other: "Other",
};

interface BaseRow {
  key: DayPart;
  enabled: boolean;
  date: string;
  slotFrom: number;
  slotTo: number;
  extendedMiddle: boolean;
}

interface ExtraPass {
  id: string;
  dayPart: DayPart;
  date: string;
  slotFrom: number;
  slotTo: number;
  priorityMin: string;
  priorityMax: string;
  extendedMiddle: boolean;
}

interface Props {
  campaignId: string;
  cityCount: number;
}

export function BulkAddWeekend({ campaignId, cityCount }: Props) {
  const [open, setOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState(""); // The Thursday
  const [baseRows, setBaseRows] = useState<BaseRow[]>(() =>
    BASE_DAY_PARTS.map((d) => ({
      key: d.key,
      enabled: d.defaultEnabled,
      date: "",
      slotFrom: 1,
      slotTo: 1,
      extendedMiddle: false,
    })),
  );
  const [extras, setExtras] = useState<ExtraPass[]>([]);
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    totalAdded: number;
    totalUpdated: number;
    totalRows: number;
    passResults: Array<{
      passIndex: number;
      label: string;
      added: number;
      updated: number;
      total: number;
      error?: string;
    }>;
  } | null>(null);
  const toast = useToast();

  /** Set the Thursday anchor + auto-fill the per-row dates by
   *  adding the day_offset. Per-row dates stay editable so the
   *  operator can deviate when the weekend isn't contiguous (e.g.
   *  a Wednesday "Halloween night" mid-week event). */
  function setAnchor(date: string) {
    setAnchorDate(date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const anchor = new Date(`${date}T00:00:00`);
    if (Number.isNaN(anchor.getTime())) return;
    setBaseRows((prev) =>
      prev.map((row) => {
        const offsetDate = new Date(anchor);
        const dp = BASE_DAY_PARTS.find((d) => d.key === row.key);
        offsetDate.setDate(anchor.getDate() + (dp?.dayOffset ?? 0));
        const yyyy = offsetDate.getFullYear();
        const mm = String(offsetDate.getMonth() + 1).padStart(2, "0");
        const dd = String(offsetDate.getDate()).padStart(2, "0");
        return { ...row, date: `${yyyy}-${mm}-${dd}` };
      }),
    );
  }

  function updateBaseRow(key: DayPart, patch: Partial<BaseRow>) {
    setBaseRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addExtraPass() {
    setExtras((prev) => [
      ...prev,
      {
        id: `extra-${Date.now()}-${prev.length}`,
        dayPart: "friday_night",
        date: baseRows.find((r) => r.key === "friday_night")?.date ?? "",
        slotFrom: 2,
        slotTo: 4,
        priorityMin: "1",
        priorityMax: "4",
        extendedMiddle: false,
      },
    ]);
  }

  function updateExtra(id: string, patch: Partial<ExtraPass>) {
    setExtras((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function removeExtra(id: string) {
    setExtras((prev) => prev.filter((e) => e.id !== id));
  }

  /** Aggregate scheduled crawl count for the submit-button copy.
   *  Calculated client-side from the form state so the operator
   *  knows the scope before clicking. */
  const plannedRowCount = useMemo(() => {
    let n = 0;
    for (const r of baseRows) {
      if (!r.enabled || !r.date) continue;
      const slotCount = Math.max(0, r.slotTo - r.slotFrom + 1);
      n += slotCount * cityCount;
    }
    for (const e of extras) {
      if (!e.date) continue;
      const slotCount = Math.max(0, e.slotTo - e.slotFrom + 1);
      // We can't know exactly how many cities match the priority
      // filter without a server roundtrip, so the count is a
      // ballpark for the button label. The server returns the
      // precise number.
      n += slotCount * cityCount;
    }
    return n;
  }, [baseRows, extras, cityCount]);

  function commit() {
    setError(null);
    setResult(null);

    // Validate + collect passes
    const passes: Array<{
      eventDate: string;
      dayPart?: DayPart;
      crawlNumbers: number[];
      extendedMiddle?: boolean;
      priorityMin?: number;
      priorityMax?: number;
    }> = [];

    for (const r of baseRows) {
      if (!r.enabled) continue;
      if (!r.date) {
        setError(`Pick a date for ${DAY_PART_LABELS[r.key]}.`);
        return;
      }
      if (r.slotFrom < 1 || r.slotFrom > 9 || r.slotTo < 1 || r.slotTo > 9) {
        setError(`Slots for ${DAY_PART_LABELS[r.key]} must be between 1 and 9.`);
        return;
      }
      if (r.slotTo < r.slotFrom) {
        setError(`Slot 'to' must be >= 'from' for ${DAY_PART_LABELS[r.key]}.`);
        return;
      }
      const crawlNumbers: number[] = [];
      for (let n = r.slotFrom; n <= r.slotTo; n++) crawlNumbers.push(n);
      passes.push({
        eventDate: r.date,
        dayPart: r.key,
        crawlNumbers,
        extendedMiddle: r.extendedMiddle,
      });
    }

    for (const e of extras) {
      if (!e.date) {
        setError(`Pick a date for the extra "${DAY_PART_LABELS[e.dayPart]}" pass.`);
        return;
      }
      if (e.slotFrom < 1 || e.slotFrom > 9 || e.slotTo < 1 || e.slotTo > 9) {
        setError("Extra-tier slot must be between 1 and 9.");
        return;
      }
      if (e.slotTo < e.slotFrom) {
        setError("Extra-tier slot 'to' must be >= 'from'.");
        return;
      }
      const pMin = e.priorityMin.trim() === "" ? undefined : Number.parseInt(e.priorityMin, 10);
      const pMax = e.priorityMax.trim() === "" ? undefined : Number.parseInt(e.priorityMax, 10);
      if (pMin !== undefined && (!Number.isInteger(pMin) || pMin < 1 || pMin > 99)) {
        setError("Priority min must be a whole number between 1 and 99.");
        return;
      }
      if (pMax !== undefined && (!Number.isInteger(pMax) || pMax < 1 || pMax > 99)) {
        setError("Priority max must be a whole number between 1 and 99.");
        return;
      }
      if (pMin !== undefined && pMax !== undefined && pMin > pMax) {
        setError("Priority min must be <= max.");
        return;
      }
      const crawlNumbers: number[] = [];
      for (let n = e.slotFrom; n <= e.slotTo; n++) crawlNumbers.push(n);
      passes.push({
        eventDate: e.date,
        dayPart: e.dayPart,
        crawlNumbers,
        extendedMiddle: e.extendedMiddle,
        priorityMin: pMin,
        priorityMax: pMax,
      });
    }

    if (passes.length === 0) {
      setError("Enable at least one row or add an extra-tier pass.");
      return;
    }

    startTx(async () => {
      const r = await bulkAddWeekend({ campaignId, passes });
      if (!r.ok) {
        setError(r.error ?? "Couldn't schedule weekend.");
        toast.show({ kind: "error", message: r.error ?? "Couldn't schedule weekend." });
        return;
      }
      setResult(r.data);
      toast.show({
        kind: "success",
        message: `Weekend scheduled: ${r.data.totalAdded} new, ${r.data.totalUpdated} realigned across ${r.data.passResults.length} passes.`,
      });
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="-mx-1 flex items-center justify-between rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-zinc-500" />
          <span className="font-medium text-sm">Schedule an entire weekend</span>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 font-mono text-[9px] text-violet-700 uppercase tracking-[0.1em] dark:text-violet-300">
            smart
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-zinc-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-zinc-200 border-t pt-3 dark:border-zinc-800">
          {result ? (
            <ResultBanner result={result} onReset={() => setResult(null)} />
          ) : (
            <>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Compose a multi-pass weekend in one shot. The base section schedules one round of
                crawls per night across all cities. The extra-tier section is for adding more crawls
                to a priority subset (e.g. "+3 crawls for the top-4 cities").
              </p>

              {/* Anchor date — picks the Thursday of the weekend and
                  auto-fills the rest of the per-row dates. Operator
                  can still edit each row's date independently. */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                <label
                  htmlFor="weekend-anchor"
                  className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]"
                >
                  Anchor Thursday
                </label>
                <Input
                  id="weekend-anchor"
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchor(e.target.value)}
                  className="h-9 w-40"
                />
                <span className="text-xs text-zinc-500">
                  Sets every row's date relative to this Thursday. Edit individual rows below.
                </span>
              </div>

              <SectionLabel>Base weekend · all cities</SectionLabel>
              <div className="flex flex-col gap-2">
                {baseRows.map((row) => (
                  <BaseRowEditor
                    key={row.key}
                    row={row}
                    onChange={(patch) => updateBaseRow(row.key, patch)}
                  />
                ))}
              </div>

              <SectionLabel>Extra tiers · priority-filtered</SectionLabel>
              {extras.length === 0 && (
                <p className="text-xs text-zinc-500 italic">
                  No extras yet. Add a tier to give a priority subset additional crawls (e.g., "top
                  4 cities also get slots 2-4 on Friday").
                </p>
              )}
              {extras.length > 0 && (
                <div className="flex flex-col gap-2">
                  {extras.map((e) => (
                    <ExtraEditor
                      key={e.id}
                      pass={e}
                      onChange={(patch) => updateExtra(e.id, patch)}
                      onRemove={() => removeExtra(e.id)}
                    />
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addExtraPass}
                className="self-start"
              >
                <Plus className="h-3.5 w-3.5" /> Add extra tier
              </Button>

              {error && (
                <div
                  className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-zinc-200 border-t pt-3 dark:border-zinc-800">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                  ~{plannedRowCount} crawls planned across {cityCount}{" "}
                  {cityCount === 1 ? "city" : "cities"}
                </span>
                <Button type="button" onClick={commit} disabled={pending || cityCount === 0}>
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarRange className="h-3.5 w-3.5" />
                  )}
                  Schedule weekend
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// =========================================================================
// Sub-components
// =========================================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="-mb-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
      {children}
    </p>
  );
}

function BaseRowEditor({
  row,
  onChange,
}: { row: BaseRow; onChange: (patch: Partial<BaseRow>) => void }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 transition-opacity",
        "dark:border-zinc-800 dark:bg-zinc-900",
        !row.enabled && "opacity-50",
      )}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={row.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded border-zinc-300 accent-zinc-700"
        />
        <span className="w-32 font-medium text-sm">{DAY_PART_LABELS[row.key]}</span>
      </label>
      <Input
        type="date"
        value={row.date}
        onChange={(e) => onChange({ date: e.target.value })}
        disabled={!row.enabled}
        className="h-8 w-40"
        aria-label={`${DAY_PART_LABELS[row.key]} date`}
      />
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
          slots
        </span>
        <Input
          type="number"
          min={1}
          max={9}
          value={row.slotFrom}
          onChange={(e) => onChange({ slotFrom: Number(e.target.value) })}
          disabled={!row.enabled}
          className="h-8 w-14"
          aria-label="From slot"
        />
        <span className="text-xs text-zinc-400">–</span>
        <Input
          type="number"
          min={1}
          max={9}
          value={row.slotTo}
          onChange={(e) => onChange({ slotTo: Number(e.target.value) })}
          disabled={!row.enabled}
          className="h-8 w-14"
          aria-label="To slot"
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={row.extendedMiddle}
          onChange={(e) => onChange({ extendedMiddle: e.target.checked })}
          disabled={!row.enabled}
          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 accent-zinc-700"
        />
        Extended (5 venues)
      </label>
    </div>
  );
}

function ExtraEditor({
  pass,
  onChange,
  onRemove,
}: {
  pass: ExtraPass;
  onChange: (patch: Partial<ExtraPass>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-violet-200/60 bg-violet-50/40 p-3",
        "dark:border-violet-900/30 dark:bg-violet-950/20",
      )}
    >
      <Select value={pass.dayPart} onValueChange={(v) => onChange({ dayPart: v as DayPart })}>
        <SelectTrigger className="h-8 w-40 bg-white text-xs dark:bg-zinc-900">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(
            [
              "thursday_night",
              "friday_night",
              "saturday_day",
              "saturday_night",
              "sunday_day",
              "sunday_night",
              "other",
            ] as DayPart[]
          ).map((dp) => (
            <SelectItem key={dp} value={dp}>
              {DAY_PART_LABELS[dp]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        value={pass.date}
        onChange={(e) => onChange({ date: e.target.value })}
        className="h-8 w-40"
        aria-label="Date"
      />
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
          slots
        </span>
        <Input
          type="number"
          min={1}
          max={9}
          value={pass.slotFrom}
          onChange={(e) => onChange({ slotFrom: Number(e.target.value) })}
          className="h-8 w-14"
          aria-label="From slot"
        />
        <span className="text-xs text-zinc-400">–</span>
        <Input
          type="number"
          min={1}
          max={9}
          value={pass.slotTo}
          onChange={(e) => onChange({ slotTo: Number(e.target.value) })}
          className="h-8 w-14"
          aria-label="To slot"
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
          priority
        </span>
        <Input
          type="number"
          min={1}
          max={99}
          value={pass.priorityMin}
          onChange={(e) => onChange({ priorityMin: e.target.value })}
          className="h-8 w-14"
          placeholder="min"
          aria-label="Priority min"
        />
        <span className="text-xs text-zinc-400">–</span>
        <Input
          type="number"
          min={1}
          max={99}
          value={pass.priorityMax}
          onChange={(e) => onChange({ priorityMax: e.target.value })}
          className="h-8 w-14"
          placeholder="max"
          aria-label="Priority max"
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={pass.extendedMiddle}
          onChange={(e) => onChange({ extendedMiddle: e.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 accent-zinc-700"
        />
        Extended
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto rounded-md p-1 text-zinc-400 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950"
        aria-label="Remove tier"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ResultBanner({
  result,
  onReset,
}: {
  result: {
    totalAdded: number;
    totalUpdated: number;
    totalRows: number;
    passResults: Array<{
      passIndex: number;
      label: string;
      added: number;
      updated: number;
      total: number;
      error?: string;
    }>;
  };
  onReset: () => void;
}) {
  const anyFailed = result.passResults.some((p) => p.error);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        anyFailed
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
          : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20",
      )}
    >
      <div className="flex items-center gap-2">
        <CheckCircle2
          className={cn(
            "h-4 w-4",
            anyFailed
              ? "text-amber-700 dark:text-amber-300"
              : "text-emerald-700 dark:text-emerald-300",
          )}
        />
        <span className="font-medium text-sm">
          {result.totalAdded} new crawls scheduled. {result.totalUpdated} existing realigned.{" "}
          {anyFailed ? "Some passes failed — see below." : "All passes succeeded."}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {result.passResults.map((p) => (
          <li
            key={p.passIndex}
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs",
              p.error
                ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
                : "bg-white/60 dark:bg-zinc-900/40",
            )}
          >
            <span className="font-mono text-[11px]">{p.label}</span>
            <span className="font-medium">
              {p.error ? (
                <span className="text-rose-700 dark:text-rose-300">{p.error}</span>
              ) : (
                <>
                  +{p.added} new
                  {p.updated > 0 ? `, ${p.updated} realigned` : ""}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onReset}
        className="self-start font-mono text-[10px] text-zinc-600 uppercase tracking-[0.12em] underline-offset-2 hover:underline dark:text-zinc-400"
      >
        Schedule another
      </button>
    </div>
  );
}

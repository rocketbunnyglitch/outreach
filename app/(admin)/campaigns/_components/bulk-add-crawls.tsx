"use client";

/**
 * BulkAddCrawls — schedule one crawl per city in this campaign, all
 * on the same date.
 *
 * Operator session 11:
 *   "I should also be able to mass add crawls for all cities for a
 *    campaign so I should be able to choose add crawls for all cities."
 *
 * UX
 * --
 * Disclosure-style panel, same shape as BulkAddCities. Collapsed by
 * default; expanding reveals:
 *   - Date input (required)
 *   - Day-part dropdown (optional — defaults to "no day part set")
 *   - Extended-middle toggle (5 venues vs 4)
 *   - Schedule button
 *
 * On submit, the server iterates over every cityCampaign in this
 * campaign and inserts one event per city with the given date+slot.
 * The unique (cityCampaignId, eventDate, slotNumber) index dedupes
 * via ON CONFLICT DO NOTHING — cities that already have a slot-1
 * crawl on that date are silently skipped and reported as such.
 *
 * Why this is separate from BulkAddCities, not a tab inside it
 * ----------------------------------------------------------------
 * Different verbs. BulkAddCities adds rows to the cities table —
 * "this campaign is happening in Boston, Toronto, NYC." BulkAddCrawls
 * adds rows to the events table — "this campaign's crawl is on Oct 31."
 * Tabbing them together would conflate two operations the operator
 * does at different stages of campaign setup.
 */

import { addCrawlToAllCities } from "@/app/(admin)/campaigns/_actions";
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
import { cn } from "@/lib/cn";
import { AlertCircle, CalendarPlus, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

interface Props {
  campaignId: string;
  /** Number of cities currently in this campaign — gates the button + shows context. */
  cityCount: number;
  /** When provided + non-empty, the bulk-add applies ONLY to these
   *  cityCampaign IDs (called from the "add crawl to selected" flow).
   *  When omitted/empty, it applies to every city in the campaign. */
  selectedCityCampaignIds?: string[];
  /** Custom label override for the disclosure trigger — e.g. "Add a
   *  crawl to N selected cities" when in selected-scope mode. */
  triggerLabel?: string;
}

type DayPart =
  | "thursday_night"
  | "friday_night"
  | "saturday_day"
  | "saturday_night"
  | "sunday_day"
  | "sunday_night"
  | "other";

const DAY_PART_LABELS: Record<DayPart | "_none", string> = {
  _none: "No day part set",
  thursday_night: "Thursday night",
  friday_night: "Friday night",
  saturday_day: "Saturday day",
  saturday_night: "Saturday night",
  sunday_day: "Sunday day",
  sunday_night: "Sunday night",
  other: "Other",
};

export function BulkAddCrawls({
  campaignId,
  cityCount,
  selectedCityCampaignIds,
  triggerLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [dayPart, setDayPart] = useState<DayPart | "_none">("_none");
  const [extendedMiddle, setExtendedMiddle] = useState(false);
  // Range form: "from" and "to" crawl numbers. When equal, behaves
  // exactly like the old single-number flow. When different, expands
  // to multiple crawls per city (e.g. 1..3 = three crawls per city).
  const [crawlFrom, setCrawlFrom] = useState(1);
  const [crawlTo, setCrawlTo] = useState(1);
  // Priority filter: only cities whose priority falls within
  // [priorityMin, priorityMax] receive the crawls. Blank = all
  // cities regardless of priority (including NULL priority).
  const [priorityMin, setPriorityMin] = useState<string>("");
  const [priorityMax, setPriorityMax] = useState<string>("");
  const [pending, startTx] = useTransition();
  const [result, setResult] = useState<{ added: number; updated: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Effective city count for the button label depends on whether we're
  // in selected-scope mode or all-cities mode.
  const scopedCount =
    selectedCityCampaignIds && selectedCityCampaignIds.length > 0
      ? selectedCityCampaignIds.length
      : cityCount;

  function commit() {
    setError(null);
    setResult(null);
    if (!eventDate) {
      setError("Pick a date for the crawl.");
      return;
    }
    const from = crawlFrom;
    const to = crawlTo;
    if (!Number.isInteger(from) || from < 1 || from > 9) {
      setError("Crawl 'from' must be between 1 and 9.");
      return;
    }
    if (!Number.isInteger(to) || to < 1 || to > 9) {
      setError("Crawl 'to' must be between 1 and 9.");
      return;
    }
    if (to < from) {
      setError("Crawl 'to' must be greater than or equal to 'from'.");
      return;
    }
    const crawlNumbers: number[] = [];
    for (let n = from; n <= to; n++) crawlNumbers.push(n);

    // Priority bounds — empty inputs disable the filter for that side.
    const pMin = priorityMin.trim() === "" ? undefined : Number.parseInt(priorityMin, 10);
    const pMax = priorityMax.trim() === "" ? undefined : Number.parseInt(priorityMax, 10);
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

    startTx(async () => {
      const r = await addCrawlToAllCities({
        campaignId,
        eventDate,
        dayPart: dayPart === "_none" ? undefined : dayPart,
        extendedMiddle,
        crawlNumbers,
        priorityMin: pMin,
        priorityMax: pMax,
        cityCampaignIds:
          selectedCityCampaignIds && selectedCityCampaignIds.length > 0
            ? selectedCityCampaignIds
            : undefined,
      });
      if (!r.ok) {
        setError(r.error ?? "Couldn't schedule crawls.");
        return;
      }
      setResult(r.data);
      // Reset the date so a double-tap doesn't accidentally re-fire
      // (the unique index would skip everything but the operator might
      // not realize that).
      setEventDate("");
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
          <CalendarPlus className="h-4 w-4 text-zinc-500" />
          <span className="font-medium text-sm">
            {triggerLabel ??
              (selectedCityCampaignIds && selectedCityCampaignIds.length > 0
                ? `Add a crawl to ${selectedCityCampaignIds.length} selected ${selectedCityCampaignIds.length === 1 ? "city" : "cities"}`
                : "Add a crawl to every city")}
          </span>
          {!(selectedCityCampaignIds && selectedCityCampaignIds.length > 0) && (
            <span className="text-xs text-zinc-500">
              {cityCount} {cityCount === 1 ? "city" : "cities"} in this campaign
            </span>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-zinc-200 border-t pt-3 dark:border-zinc-800">
          {result ? (
            <SuccessBanner>
              {result.added > 0 && (
                <>
                  Scheduled {result.added} new {result.added === 1 ? "crawl" : "crawls"} on{" "}
                  {eventDateLabel(eventDate, result)}.
                </>
              )}
              {result.updated > 0 && (
                <>
                  {result.added > 0 ? " " : ""}
                  Realigned {result.updated} existing {result.updated === 1 ? "crawl" : "crawls"} to
                  the new day-part + venue mix.
                </>
              )}
              {result.added === 0 && result.updated === 0 && "No matching cities for this filter."}
              <button
                type="button"
                onClick={() => setResult(null)}
                className="ml-2 text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
              >
                Schedule another date
              </button>
            </SuccessBanner>
          ) : (
            <>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Adds one crawl to every city in this campaign on the date you pick. Cities that
                already have a crawl at that slot get their day-part + venue mix realigned to this
                configuration (their venue assignments, status, and notes are kept).
              </p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="bulk-crawl-date"
                    className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
                  >
                    Date
                  </label>
                  <Input
                    id="bulk-crawl-date"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    disabled={pending}
                    className="text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                    Crawls (from – to)
                  </span>
                  <div className="flex h-9 items-center gap-1">
                    <Input
                      id="bulk-crawl-from"
                      type="number"
                      min={1}
                      max={9}
                      value={crawlFrom}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10) || 1;
                        setCrawlFrom(n);
                        // Auto-bump "to" if it would invert.
                        if (n > crawlTo) setCrawlTo(n);
                      }}
                      disabled={pending}
                      className="h-9 text-xs"
                      title="First crawl number to add (e.g. 1)."
                    />
                    <span className="px-1 text-xs text-zinc-400">–</span>
                    <Input
                      id="bulk-crawl-to"
                      type="number"
                      min={1}
                      max={9}
                      value={crawlTo}
                      onChange={(e) => setCrawlTo(Number.parseInt(e.target.value, 10) || crawlFrom)}
                      disabled={pending}
                      className="h-9 text-xs"
                      title="Last crawl number to add. Same as 'from' for a single crawl."
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                    Priority (min – max)
                  </span>
                  <div className="flex h-9 items-center gap-1">
                    <Input
                      id="bulk-pri-min"
                      type="number"
                      min={1}
                      max={99}
                      placeholder="any"
                      value={priorityMin}
                      onChange={(e) => setPriorityMin(e.target.value)}
                      disabled={pending}
                      className="h-9 text-xs"
                      title="Lowest priority bucket to include (e.g. 1). Blank = no lower bound."
                    />
                    <span className="px-1 text-xs text-zinc-400">–</span>
                    <Input
                      id="bulk-pri-max"
                      type="number"
                      min={1}
                      max={99}
                      placeholder="any"
                      value={priorityMax}
                      onChange={(e) => setPriorityMax(e.target.value)}
                      disabled={pending}
                      className="h-9 text-xs"
                      title="Highest priority bucket to include. Blank = no upper bound."
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="bulk-crawl-daypart"
                    className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
                  >
                    Day part
                  </label>
                  <Select value={dayPart} onValueChange={(v) => setDayPart(v as DayPart | "_none")}>
                    <SelectTrigger id="bulk-crawl-daypart" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DAY_PART_LABELS) as Array<DayPart | "_none">).map((dp) => (
                        <SelectItem key={dp} value={dp}>
                          {DAY_PART_LABELS[dp]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
                    Shape
                  </span>
                  <label className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={extendedMiddle}
                      onChange={(e) => setExtendedMiddle(e.target.checked)}
                      disabled={pending}
                      className="h-3 w-3"
                    />
                    Extended (5 venues)
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={commit}
                  disabled={pending || scopedCount === 0}
                >
                  {pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CalendarPlus className="h-3 w-3" />
                  )}
                  {pending
                    ? "Scheduling…"
                    : scopedCount === 0
                      ? "Add cities first"
                      : (() => {
                          const span =
                            crawlFrom === crawlTo
                              ? `crawl ${crawlFrom}`
                              : `crawls ${crawlFrom}-${crawlTo}`;
                          const priLabel =
                            priorityMin || priorityMax
                              ? ` · P${priorityMin || "*"}-${priorityMax || "*"}`
                              : "";
                          return `Schedule ${span} for ${scopedCount} ${scopedCount === 1 ? "city" : "cities"}${priLabel}`;
                        })()}
                </Button>
                {error && <ErrorBanner>{error}</ErrorBanner>}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** Format YYYY-MM-DD as a human-readable date for the success banner. */
function eventDateLabel(yyyymmdd: string, _result: { added: number }): string {
  if (!yyyymmdd) return "the date you picked";
  // Construct at noon UTC to avoid timezone shifting the date.
  const d = new Date(`${yyyymmdd}T12:00:00Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-emerald-800 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50/80 px-3 py-2 text-rose-800 text-xs dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

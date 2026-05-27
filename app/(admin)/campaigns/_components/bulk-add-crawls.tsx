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

export function BulkAddCrawls({ campaignId, cityCount }: Props) {
  const [open, setOpen] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [dayPart, setDayPart] = useState<DayPart | "_none">("_none");
  const [extendedMiddle, setExtendedMiddle] = useState(false);
  const [pending, startTx] = useTransition();
  const [result, setResult] = useState<{ added: number; skipped: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  function commit() {
    setError(null);
    setResult(null);
    if (!eventDate) {
      setError("Pick a date for the crawl.");
      return;
    }
    startTx(async () => {
      const r = await addCrawlToAllCities({
        campaignId,
        eventDate,
        dayPart: dayPart === "_none" ? undefined : dayPart,
        extendedMiddle,
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
          <span className="font-medium text-sm">Add a crawl to every city</span>
          <span className="text-xs text-zinc-500">
            {cityCount} {cityCount === 1 ? "city" : "cities"} in this campaign
          </span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-zinc-200 border-t pt-3 dark:border-zinc-800">
          {result ? (
            <SuccessBanner>
              Scheduled {result.added} {result.added === 1 ? "crawl" : "crawls"} on{" "}
              {eventDateLabel(eventDate, result)}.
              {result.skipped > 0 && (
                <>
                  {" "}
                  Skipped {result.skipped} {result.skipped === 1 ? "city" : "cities"} that already
                  had a crawl on this date.
                </>
              )}
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
                already have a crawl on that date are skipped silently.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                  disabled={pending || cityCount === 0}
                >
                  {pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CalendarPlus className="h-3 w-3" />
                  )}
                  {pending
                    ? "Scheduling…"
                    : cityCount === 0
                      ? "Add cities first"
                      : `Schedule for ${cityCount} ${cityCount === 1 ? "city" : "cities"}`}
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

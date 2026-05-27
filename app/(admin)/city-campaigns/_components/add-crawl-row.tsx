"use client";

/**
 * AddCrawlRow — inline "+ Add crawl" composer at the bottom of the
 * city sheet's crawl list. Pick a date, day part, tentative timing,
 * mix shape (3-middle for 5-venue crawls, default 2-middle for 4).
 *
 * Server action: addCrawlToCityCampaign — slot_number is auto-assigned
 * (next-available on that date), required_* counts derived from the
 * shape choice. Per-venue timings live on venue_events.agreed_hours_text
 * and are fully editable separately; this just sets the wrapper.
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCrawlToCityCampaign } from "../../campaigns/_actions";

interface Props {
  cityCampaignId: string;
  /** Display name only — used for the section label. */
  cityName: string;
  /** ISO date YYYY-MM-DD; pre-fills the date input. */
  suggestedDate?: string;
}

const DAY_PARTS: Array<{ value: string; label: string }> = [
  { value: "friday_night", label: "Friday night" },
  { value: "saturday_night", label: "Saturday night" },
  { value: "saturday_day", label: "Saturday day" },
  { value: "thursday_night", label: "Thursday night" },
  { value: "sunday_night", label: "Sunday night" },
  { value: "sunday_day", label: "Sunday day" },
  { value: "other", label: "Other" },
];

export function AddCrawlRow({ cityCampaignId, cityName, suggestedDate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [eventDate, setEventDate] = useState(suggestedDate ?? "");
  const [dayPart, setDayPart] = useState<string>("saturday_night");
  const [startsAt, setStartsAt] = useState(""); // datetime-local
  const [endsAt, setEndsAt] = useState("");
  const [extendedMiddle, setExtendedMiddle] = useState(false);
  const [routeLabel, setRouteLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const router = useRouter();

  function commit() {
    setError(null);
    if (!eventDate) {
      setError("Pick a date for this crawl.");
      return;
    }
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("eventDate", eventDate);
    fd.set("dayPart", dayPart);
    if (startsAt) fd.set("tentativeStart", new Date(startsAt).toISOString());
    if (endsAt) fd.set("tentativeEnd", new Date(endsAt).toISOString());
    if (routeLabel) fd.set("routeLabel", routeLabel);
    if (extendedMiddle) fd.set("extendedMiddle", "on");

    startTx(async () => {
      const result = await addCrawlToCityCampaign(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't create the crawl.");
        return;
      }
      // Reset + collapse
      setExpanded(false);
      setRouteLabel("");
      setStartsAt("");
      setEndsAt("");
      setExtendedMiddle(false);
      router.refresh();
    });
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "card-surface-quiet flex w-full items-center justify-center gap-2 px-5 py-4 text-sm transition-colors",
          "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
          "dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add a crawl in {cityName}
      </button>
    );
  }

  return (
    <div className="card-surface-quiet p-5">
      <h3 className="font-semibold text-sm tracking-tight">New crawl</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Wrapper timing only. Each venue can have its own hours set later on the venue row (e.g.
        middle 9–10pm vs final 11pm–1am).
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Date
          </span>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            disabled={pending}
            className={cn(
              "rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Day part
          </span>
          <Select value={dayPart} onValueChange={setDayPart}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_PARTS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Tentative start
          </span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            disabled={pending}
            className={cn(
              "rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Tentative end
          </span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            disabled={pending}
            className={cn(
              "rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Route label (optional)
          </span>
          <input
            type="text"
            value={routeLabel}
            onChange={(e) => setRouteLabel(e.target.value)}
            placeholder="e.g. King West, Distillery loop"
            disabled={pending}
            className={cn(
              "rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={extendedMiddle}
            onChange={(e) => setExtendedMiddle(e.target.checked)}
            disabled={pending}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
          />
          5-venue shape (1 wristband + 3 middles + 1 final) — default is 4 with 2 middles
        </label>
      </div>
      {error && (
        <p
          className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setExpanded(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={commit} disabled={pending}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Create crawl
        </Button>
      </div>
    </div>
  );
}

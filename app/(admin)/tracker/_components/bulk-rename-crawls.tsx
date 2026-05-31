"use client";

/**
 * BulkRenameCrawls — admin-only tracker affordance for renaming
 * (and optionally re-formatting) every event matching
 * (campaign, crawl_number [, day_part]).
 *
 * Operator workflow:
 *   "All Saturday crawl 4's are Day Parties" — one click:
 *     - crawl number = 4
 *     - day part = saturday_night
 *     - crawl name = "Day Party"
 *     - format = day_party
 *   → every event with that shape gets the new name + format in a
 *     single transaction.
 *
 * Setting format to 'day_party' also bumps required_final_count = 0
 * and required_venue_count_total = 3 (server-side), so the tracker
 * automatically renders day-party rows without the final venue cell.
 * Switching back to 'standard' restores the 4-venue defaults.
 *
 * Mounted on the dedicated /tracker page; not on the dashboard's
 * inline tracker block to avoid crowding.
 */

import { bulkRenameCrawls } from "@/app/(admin)/events/_actions";
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
import { ChevronDown, Loader2, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  campaignId: string;
  /** Admin-only — caller passes the role check result. */
  isAdmin: boolean;
}

type DayPart =
  | "thursday_night"
  | "friday_night"
  | "saturday_day"
  | "saturday_night"
  | "sunday_day"
  | "sunday_night"
  | "other";

const DAY_PART_LABELS: Record<DayPart | "_all", string> = {
  _all: "Every day part",
  thursday_night: "Thursday night",
  friday_night: "Friday night",
  saturday_day: "Saturday day",
  saturday_night: "Saturday night",
  sunday_day: "Sunday day",
  sunday_night: "Sunday night",
  other: "Other",
};

export function BulkRenameCrawls({ campaignId, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [crawlNumber, setCrawlNumber] = useState(1);
  const [dayPart, setDayPart] = useState<DayPart | "_all">("_all");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"_keep" | "standard" | "day_party">("_keep");
  const [pending, startTx] = useTransition();
  const toast = useToast();
  const router = useRouter();

  if (!isAdmin) return null;

  function commit() {
    if (!Number.isInteger(crawlNumber) || crawlNumber < 1 || crawlNumber > 9) {
      toast.show({ kind: "error", message: "Crawl number must be 1-9." });
      return;
    }
    startTx(async () => {
      const r = await bulkRenameCrawls({
        campaignId,
        crawlNumber,
        dayPart: dayPart === "_all" ? undefined : dayPart,
        crawlName: name.trim() === "" ? null : name.trim(),
        crawlFormat: format === "_keep" ? undefined : format,
      });
      if (!r.ok) {
        toast.show({ kind: "error", message: r.error ?? "Couldn't update crawls." });
        return;
      }
      const updated = r.data.updated;
      toast.show({
        kind: "success",
        message: `Updated ${updated} ${updated === 1 ? "crawl" : "crawls"}.`,
      });
      router.refresh();
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
          <PencilLine className="h-4 w-4 text-zinc-500" />
          <span className="font-medium text-sm">Bulk-rename crawls (admin)</span>
          <span className="text-xs text-zinc-500">
            Set a custom name + format for every event matching a slot
          </span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-zinc-200 border-t pt-3 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="rename-crawl-num"
                className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
              >
                Crawl number
              </label>
              <Input
                id="rename-crawl-num"
                type="number"
                min={1}
                max={9}
                value={crawlNumber}
                onChange={(e) => setCrawlNumber(Number.parseInt(e.target.value, 10) || 1)}
                disabled={pending}
                className="h-9 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="rename-day-part"
                className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
              >
                Day part
              </label>
              <Select value={dayPart} onValueChange={(v) => setDayPart(v as DayPart | "_all")}>
                <SelectTrigger id="rename-day-part" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DAY_PART_LABELS) as Array<DayPart | "_all">).map((dp) => (
                    <SelectItem key={dp} value={dp}>
                      {DAY_PART_LABELS[dp]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="rename-name"
                className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
              >
                New name (blank to clear)
              </label>
              <Input
                id="rename-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Day Party"
                maxLength={60}
                disabled={pending}
                className="h-9 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="rename-format"
                className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]"
              >
                Format
              </label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as "_keep" | "standard" | "day_party")}
              >
                <SelectTrigger id="rename-format" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_keep">Keep existing</SelectItem>
                  <SelectItem value="standard">Standard (wristband + 2 middles + final)</SelectItem>
                  <SelectItem value="day_party">
                    Day party (wristband + 2 middles, no final)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={commit} disabled={pending}>
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <PencilLine className="h-3 w-3" />
              )}
              {pending ? "Updating…" : "Apply to every matching crawl"}
            </Button>
            <p className="text-[10px] text-zinc-500">
              Targets every event in this campaign with the chosen crawl number
              {dayPart !== "_all" ? ` on ${DAY_PART_LABELS[dayPart].toLowerCase()}` : ""}.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

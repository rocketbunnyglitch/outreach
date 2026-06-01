"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Ticket } from "lucide-react";
import { useState, useTransition } from "react";
import { bulkSyncEventbriteSales } from "../_actions";

interface Props {
  campaignId: string;
  totalCrawls: number;
  linkedCount: number;
  readyCount: number;
  needsVenuesCount: number;
  totalTickets: number;
}

/**
 * Summary strip at the top of /all-crawls.
 *
 * 4 KPI cards + a Sync All button:
 *
 *   Total crawls   · all events in this campaign
 *   Linked         · with Eventbrite event IDs (sync-able)
 *   Ready          · zero open slots, ready for showtime
 *   Need attention · open slots > 0
 *
 * Sync All triggers bulkSyncEventbriteSales which iterates through
 * every linked event sequentially (rate-limit safe), pulling fresh
 * sales counts and updating ticket_sales_count. Inline toast shows
 * synced/failed totals.
 */
export function AllCrawlsSummary({
  campaignId,
  totalCrawls,
  linkedCount,
  readyCount,
  needsVenuesCount,
  totalTickets,
}: Props) {
  const [syncing, startSync] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  function syncAll() {
    if (linkedCount === 0) {
      setToast("No crawls linked to Eventbrite yet.");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    setNotConfigured(false);
    setToast(null);
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    startSync(async () => {
      const result = await bulkSyncEventbriteSales(null, fd);
      if (!result.ok) {
        setToast(result.error ?? "Sync failed.");
        return;
      }
      const data = result.data;
      if (data && "notConfigured" in data) {
        setNotConfigured(true);
        return;
      }
      if (data && "synced" in data) {
        const failedSuffix = data.failed > 0 ? `, ${data.failed} failed` : "";
        setToast(
          `Synced ${data.synced} of ${data.totalLinked} crawls${failedSuffix}. ${data.ticketsTotal} total tickets across linked crawls.`,
        );
        setTimeout(() => setToast(null), 6000);
      }
    });
  }

  return (
    <section className="mb-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total crawls" value={totalCrawls} tone="zinc" />
        <StatCard
          label="Linked to EB"
          value={linkedCount}
          suffix={`of ${totalCrawls}`}
          tone="orange"
          icon={<Ticket className="h-3 w-3" />}
        />
        <StatCard
          label="Ready"
          value={readyCount}
          tone="emerald"
          icon={<CheckCircle2 className="h-3 w-3" />}
        />
        <StatCard
          label="Need attention"
          value={needsVenuesCount}
          tone={needsVenuesCount > 0 ? "amber" : "zinc"}
          icon={needsVenuesCount > 0 ? <AlertCircle className="h-3 w-3" /> : undefined}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {totalTickets > 0 ? (
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.1em]">
            Total tickets sold ·{" "}
            <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
              {totalTickets.toLocaleString("en-US")}
            </span>
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {toast && (
            <p
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.08em]",
                notConfigured
                  ? "text-rose-700 dark:text-rose-300"
                  : "text-zinc-600 dark:text-zinc-400",
              )}
            >
              {toast}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={syncAll}
            disabled={syncing || linkedCount === 0}
            title={
              linkedCount === 0
                ? "Link some crawls to Eventbrite first"
                : `Pull sales from EB for all ${linkedCount} linked crawls`
            }
          >
            {syncing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Syncing {linkedCount}…
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                Sync all sales
              </>
            )}
          </Button>
        </div>
      </div>

      {notConfigured && (
        <div className="mt-3 rounded-lg border border-rose-200/80 bg-rose-50/95 p-3 text-xs dark:border-rose-900/40 dark:bg-rose-950/80">
          <p className="font-medium text-rose-900 dark:text-rose-200">
            Eventbrite isn't configured yet
          </p>
          <p className="mt-1 text-rose-800/80 dark:text-rose-300/80">
            Add{" "}
            <code className="rounded bg-rose-100 px-1 py-0.5 font-mono text-[10px] dark:bg-rose-900/40">
              EVENTBRITE_PRIVATE_TOKEN
            </code>{" "}
            to the server env to enable sync.
          </p>
        </div>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  suffix,
  tone,
  icon,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone: "zinc" | "emerald" | "orange" | "amber";
  icon?: React.ReactNode;
}) {
  const tonalText = {
    zinc: "text-zinc-900 dark:text-zinc-100",
    emerald: "text-emerald-700 dark:text-emerald-400",
    orange: "text-orange-700 dark:text-orange-400",
    amber: "text-rose-700 dark:text-rose-400",
  };
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white p-3 shadow-sm shadow-zinc-200/30 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <p className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
        {icon}
        {label}
      </p>
      <p
        className={cn("mt-1.5 font-semibold text-2xl tabular-nums tracking-tight", tonalText[tone])}
      >
        {value.toLocaleString("en-US")}
        {suffix && (
          <span className="ml-1.5 font-mono font-normal text-[11px] text-zinc-500">{suffix}</span>
        )}
      </p>
    </div>
  );
}

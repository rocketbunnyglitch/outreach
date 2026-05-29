import { cn } from "@/lib/cn";
import { AlertCircle, ArrowRight, CheckCircle2, ClipboardList } from "lucide-react";
import Link from "next/link";
import type { FlaggedInternalCrawl } from "../_actions";

const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat·D",
  saturday_night: "Sat",
  sunday_day: "Sun·D",
  sunday_night: "Sun",
  other: "Other",
};

/**
 * Surfaces every crawl currently flagged as host_type='internal' so the
 * operator can see what still needs name / hours / rate filled in.
 *
 * The flow this serves: operator marks a crawl "Internal" the moment the
 * venue is booked, leaves details blank, comes back here later to fill
 * in who actually worked, how many hours, and the payout rate. Without
 * this view they'd have to remember which crawls they flagged and
 * navigate to each city sheet separately.
 *
 * Row state:
 *   - Each crawl renders with explicit "needs X / Y / Z" pills for any
 *     missing fields (rose).
 *   - When all three fields are filled the row shows a green "Complete"
 *     badge so the operator can spot leftovers at a glance.
 *   - Each row deep-links to its city sheet where the inline editor
 *     lives.
 */
export function InternalHostFlaggedCrawls({ rows }: { rows: FlaggedInternalCrawl[] }) {
  if (rows.length === 0) {
    return (
      <section className="card-surface p-5">
        <header className="mb-2 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-base tracking-tight">
            Crawls flagged as internal host
          </h2>
        </header>
        <p className="text-xs text-zinc-500">
          No crawls are currently flagged as internal host. Mark one from a city sheet&apos;s slot-1
          control to see it here.
        </p>
      </section>
    );
  }

  const pendingCount = rows.filter((r) => r.needsName || r.needsHours || r.needsRate).length;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-base tracking-tight">
            Crawls flagged as internal host
          </h2>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          {pendingCount > 0
            ? `${pendingCount} need details · ${rows.length} total`
            : `${rows.length} complete`}
        </p>
      </header>

      <ol className="flex flex-col divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
        {rows.map((row) => {
          const allFilled = !row.needsName && !row.needsHours && !row.needsRate;
          return (
            <li key={row.crawlHostId}>
              <Link
                href={`/city-campaigns/${row.cityCampaignId}`}
                className="group flex flex-col gap-1.5 px-5 py-3 transition-colors hover:bg-zinc-50/60 sm:flex-row sm:items-center sm:gap-4 dark:hover:bg-zinc-900/40"
              >
                {/* Left: city + when */}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                    {row.cityName}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                    <span>{row.eventDate ?? "no date"}</span>
                    <span className="opacity-50">·</span>
                    <span>{DAY_LABEL[row.dayPart] ?? row.dayPart}</span>
                    {row.crawlNumber != null && (
                      <>
                        <span className="opacity-50">·</span>
                        <span>Crawl {row.crawlNumber}</span>
                      </>
                    )}
                  </p>
                </div>

                {/* Middle: per-field status */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {allFilled ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[9px] text-emerald-700 uppercase tracking-[0.1em] dark:text-emerald-300">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Complete
                    </span>
                  ) : (
                    <>
                      <FieldChip label="Name" filled={!row.needsName}>
                        {row.internalHostName ?? "—"}
                      </FieldChip>
                      <FieldChip label="Hours" filled={!row.needsHours}>
                        {row.internalHostHours ?? "—"}
                      </FieldChip>
                      <FieldChip label="Rate" filled={!row.needsRate}>
                        {row.internalHostRateCents != null
                          ? `$${Math.round(row.internalHostRateCents / 100)}`
                          : "—"}
                      </FieldChip>
                    </>
                  )}
                </div>

                {/* Right: CTA arrow */}
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                  Open
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FieldChip({
  label,
  filled,
  children,
}: {
  label: string;
  filled: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
        filled
          ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400"
          : "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20 ring-inset dark:text-rose-300",
      )}
      title={filled ? `${label}: ${children}` : `${label} not yet filled in`}
    >
      {!filled && <AlertCircle className="h-2.5 w-2.5" />}
      <span className="opacity-60">{label}</span>
      <span className="font-medium opacity-90">{children}</span>
    </span>
  );
}

"use client";

import { cn } from "@/lib/cn";
import {
  type CrawlSupportData,
  STATUS_LABEL,
  STATUS_TONE,
  type SupportBucket,
  type SupportCrawl,
} from "@/lib/crawl-support-types";
import { AlertTriangle, Phone, PhoneMissed, Search } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";

const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thu Night",
  friday_night: "Fri Night",
  saturday_day: "Sat Day",
  saturday_night: "Sat Night",
  sunday_night: "Sun Night",
};

function dayLabel(dp: string | null): string {
  if (!dp) return "Crawl";
  return DAY_LABEL[dp] ?? dp.replace(/_/g, " ");
}

export function CrawlSupportBoard({ data }: { data: CrawlSupportData }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.crawls;
    return data.crawls.filter((c) =>
      [c.cityName, c.campaignName, dayLabel(c.dayPart), `crawl ${c.crawlNumber ?? ""}`]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data.crawls, query]);

  const byBucket = (b: SupportBucket) => filtered.filter((c) => c.bucket === b);
  const active = byBucket("active");
  const startingSoon = byBucket("starting_soon");
  const completed = byBucket("completed");

  return (
    <div className="flex flex-col gap-6">
      {/* Reverse search — phone/contact/email/venue cross-entity search lands
          with the call_logs + venue-contact join; for now it filters the live
          crawl list by city / campaign / crawl. */}
      <div className="relative max-w-md">
        <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-zinc-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search city, campaign, or crawl…"
          className="h-10 w-full rounded-lg border border-zinc-200 bg-white pr-3 pl-9 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
        />
      </div>

      <Section title="Active Crawls" count={active.length} accent="emerald">
        {active.length === 0 ? (
          <Empty label="No crawls running right now." />
        ) : (
          <CardGrid crawls={active} />
        )}
      </Section>

      <Section title="Starting Soon" count={startingSoon.length} accent="sky">
        {startingSoon.length === 0 ? (
          <Empty label="Nothing starting in the next couple of hours." />
        ) : (
          <CardGrid crawls={startingSoon} />
        )}
      </Section>

      <Section title="Completed Recently" count={completed.length} accent="zinc">
        {completed.length === 0 ? (
          <Empty label="No recently completed crawls." />
        ) : (
          <CardGrid crawls={completed} />
        )}
      </Section>

      {/* Staged views — wired once the call_logs + crawl_issues tables exist. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StubPanel
          icon={<Phone className="h-4 w-4" />}
          title="Incoming Calls"
          note="Quo/Viber webhook logging + contact matching — next pass."
        />
        <StubPanel
          icon={<PhoneMissed className="h-4 w-4" />}
          title="Unmatched Calls"
          note="Surfaces calls with no contact match during active windows."
        />
        <StubPanel
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Urgent Issues"
          note="Create-from-call issue logging — needs the crawl_issues table."
        />
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: "emerald" | "sky" | "zinc";
  children: ReactNode;
}) {
  const dot =
    accent === "emerald" ? "bg-emerald-500" : accent === "sky" ? "bg-sky-500" : "bg-zinc-400";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        <h2 className="font-mono text-xs text-zinc-600 uppercase tracking-[0.12em] dark:text-zinc-400">
          {title}
        </h2>
        <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{count}</span>
      </div>
      {children}
    </section>
  );
}

function CardGrid({ crawls }: { crawls: SupportCrawl[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {crawls.map((c) => (
        <CrawlCard key={c.eventId} crawl={c} />
      ))}
    </div>
  );
}

function CrawlCard({ crawl }: { crawl: SupportCrawl }) {
  return (
    <Link
      href={`/all-crawls#${crawl.eventId}`}
      className="flex flex-col gap-2.5 rounded-xl border border-zinc-200/80 bg-white p-3.5 transition-colors hover:border-zinc-300 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:hover:border-zinc-700"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
            {crawl.cityName}
          </p>
          <p className="truncate font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
            {crawl.campaignName}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ring-1 ring-inset",
            STATUS_TONE[crawl.status],
          )}
        >
          {STATUS_LABEL[crawl.status]}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">
          {dayLabel(crawl.dayPart)}
          {crawl.crawlNumber ? ` #${crawl.crawlNumber}` : ""}
        </span>
        <span className="font-mono text-zinc-500 tabular-nums">
          {crawl.timesMissing ? (
            <span className="text-amber-600 dark:text-amber-400">times not set</span>
          ) : (
            `${crawl.startLocal} – ${crawl.endLocal}`
          )}
        </span>
      </div>

      <div className="flex items-center justify-between border-zinc-100 border-t pt-2 text-[11px] dark:border-zinc-800/60">
        <span className="font-mono text-zinc-400 uppercase tracking-wider">
          {tzAbbrev(crawl.timezone)} · {crawl.eventDate}
        </span>
        <span className="font-mono text-zinc-600 tabular-nums dark:text-zinc-300">
          {crawl.ticketSalesCount} sold
        </span>
      </div>
    </Link>
  );
}

function tzAbbrev(tz: string): string {
  // Last path segment, underscores to spaces — "America/New_York" → "New York"
  const seg = tz.split("/").pop() ?? tz;
  return seg.replace(/_/g, " ");
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/60 border-dashed px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-800/50">
      {label}
    </div>
  );
}

function StubPanel({
  icon,
  title,
  note,
}: {
  icon: ReactNode;
  title: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200/60 border-dashed p-3.5 dark:border-zinc-800/50">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span className="font-mono text-xs uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-[11px] text-zinc-400">{note}</p>
    </div>
  );
}

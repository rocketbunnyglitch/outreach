"use client";

import { cn } from "@/lib/cn";
import {
  type CrawlIssueSeverity,
  type CrawlIssueType,
  type CrawlSupportData,
  ISSUE_TYPE_LABEL,
  ISSUE_TYPE_ORDER,
  RISK_LABEL,
  RISK_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type SupportBucket,
  type SupportCrawl,
  type SupportIssue,
} from "@/lib/crawl-support-types";
import { AlertTriangle, Check, Phone, PhoneMissed, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState, useTransition } from "react";
import { assignCrawlIssue, createCrawlIssue, resolveCrawlIssue } from "../_actions";

type StaffOpt = { id: string; name: string };

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

export function CrawlSupportBoard({
  data,
  issues,
  staff,
}: {
  data: CrawlSupportData;
  issues: SupportIssue[];
  staff: StaffOpt[];
}) {
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

      <UrgentIssues issues={issues} staff={staff} crawls={data.crawls} />

      {/* Calls — wired once call_logs + the Quo/Viber webhooks land. */}
      <div className="grid gap-4 sm:grid-cols-2">
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

      <div className="flex flex-col gap-1 border-zinc-100 border-t pt-2 text-[11px] dark:border-zinc-800/60">
        <VenueRow
          label="Wristband"
          value={crawl.wristbandVenue}
          extra={<WristbandDot status={crawl.wristbandStatus} />}
        />
        <VenueRow
          label="Middle"
          value={crawl.middleVenues.length ? crawl.middleVenues.join(", ") : null}
        />
        <VenueRow label="Final" value={crawl.finalVenue} />
        <VenueRow
          label="Hosts"
          missing="no host"
          value={
            crawl.hosts.length
              ? crawl.hosts
                  .map((h) => `${h.name}${h.type === "external" ? " (ext)" : ""}`)
                  .join(", ")
              : null
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-zinc-100 border-t pt-2 text-[11px] dark:border-zinc-800/60">
        <span className="truncate font-mono text-zinc-400 uppercase tracking-wider">
          {tzAbbrev(crawl.timezone)} · {crawl.eventDate} · {crawl.ticketSalesCount} sold
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ring-1 ring-inset",
            RISK_TONE[crawl.supportRisk],
          )}
        >
          {RISK_LABEL[crawl.supportRisk]}
        </span>
      </div>
    </Link>
  );
}

function VenueRow({
  label,
  value,
  extra,
  missing = "needs venue",
}: {
  label: string;
  value: string | null;
  extra?: ReactNode;
  missing?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 font-mono text-zinc-400 uppercase tracking-wider">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {extra}
        <span
          className={cn(
            "truncate",
            value ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 italic",
          )}
        >
          {value ?? missing}
        </span>
      </span>
    </div>
  );
}

function WristbandDot({ status }: { status: SupportCrawl["wristbandStatus"] }) {
  const tone =
    status === "delivered" ? "bg-green-500" : status === "shipped" ? "bg-amber-500" : "bg-red-500";
  const label =
    status === "delivered"
      ? "Wristbands received"
      : status === "shipped"
        ? "Wristbands shipped"
        : status === "issue"
          ? "Wristband issue"
          : "Wristbands not shipped";
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone)} title={label} />;
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

// =========================================================================
// Urgent Issues
// =========================================================================

function UrgentIssues({
  issues,
  staff,
  crawls,
}: {
  issues: SupportIssue[];
  staff: StaffOpt[];
  crawls: SupportCrawl[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const open = issues.filter((i) => i.status !== "resolved");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <h2 className="font-mono text-xs text-zinc-600 uppercase tracking-[0.12em] dark:text-zinc-400">
            Urgent Issues
          </h2>
          <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{open.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 font-mono text-[10px] text-zinc-600 uppercase tracking-wider transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Plus className="h-3.5 w-3.5" /> Log issue
        </button>
      </div>
      {open.length === 0 ? (
        <Empty label="No open issues right now." />
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((i) => (
            <IssueRow key={i.id} issue={i} staff={staff} />
          ))}
        </div>
      )}
      {modalOpen && (
        <LogIssueModal crawls={crawls} staff={staff} onClose={() => setModalOpen(false)} />
      )}
    </section>
  );
}

function IssueRow({ issue, staff }: { issue: SupportIssue; staff: StaffOpt[] }) {
  const router = useRouter();
  const [pending, startTx] = useTransition();

  const resolve = () =>
    startTx(async () => {
      const res = await resolveCrawlIssue(issue.id);
      if (res.ok) router.refresh();
    });
  const assign = (staffId: string) => {
    if (!staffId) return;
    startTx(async () => {
      const res = await assignCrawlIssue(issue.id, staffId);
      if (res.ok) router.refresh();
    });
  };

  const where =
    [issue.cityName, issue.crawlLabel].filter(Boolean).join(" · ") ||
    issue.campaignName ||
    "Unscoped";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-zinc-200/80 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800/60 dark:bg-zinc-950/60",
        pending && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ring-1 ring-inset",
            SEVERITY_TONE[issue.severity],
          )}
        >
          {SEVERITY_LABEL[issue.severity]}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
            {ISSUE_TYPE_LABEL[issue.issueType]}
          </p>
          <p className="truncate text-[11px] text-zinc-500">
            {where}
            {issue.venueName ? ` · ${issue.venueName}` : ""}
            {issue.callerContact ? ` · ${issue.callerContact}` : ""}
            {issue.assignedStaffName ? ` · ${issue.assignedStaffName}` : ""}
          </p>
          {issue.notes ? (
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">{issue.notes}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          disabled={pending}
          value=""
          onChange={(e) => assign(e.target.value)}
          className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950"
        >
          <option value="">Assign…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={resolve}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 px-2 py-1 font-mono text-[10px] text-emerald-700 uppercase tracking-wider hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
        >
          <Check className="h-3 w-3" /> Resolve
        </button>
      </div>
    </div>
  );
}

const fieldInputCls =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function LogIssueModal({
  crawls,
  staff,
  onClose,
}: {
  crawls: SupportCrawl[];
  staff: StaffOpt[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issueType, setIssueType] = useState<CrawlIssueType>("venue_not_expecting");
  const [severity, setSeverity] = useState<CrawlIssueSeverity>("medium");
  const [eventId, setEventId] = useState("");
  const [caller, setCaller] = useState("");
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    setError(null);
    startTx(async () => {
      const res = await createCrawlIssue({
        issueType,
        severity,
        eventId: eventId || null,
        callerContact: caller || null,
        notes: notes || null,
        assignedStaffId: assignee || null,
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative w-full max-w-lg rounded-t-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Log issue</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Issue type">
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as CrawlIssueType)}
              className={fieldInputCls}
            >
              {ISSUE_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ISSUE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as CrawlIssueSeverity)}
              className={fieldInputCls}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
          <Field label="Crawl (optional)">
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className={fieldInputCls}
            >
              <option value="">— none —</option>
              {crawls.map((c) => (
                <option key={c.eventId} value={c.eventId}>
                  {c.cityName} — {c.dayPart ? c.dayPart.replace(/_/g, " ") : "crawl"}
                  {c.crawlNumber ? ` #${c.crawlNumber}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Caller / contact (optional)">
            <input
              value={caller}
              onChange={(e) => setCaller(e.target.value)}
              className={fieldInputCls}
              placeholder="Name or number"
            />
          </Field>
          <Field label="Assign to (optional)">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={fieldInputCls}
            >
              <option value="">— unassigned —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="min-h-[72px] w-full rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
              placeholder="What's happening?"
            />
          </Field>
          {error ? <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {pending ? "Logging…" : "Log issue"}
          </button>
        </div>
      </div>
    </div>
  );
}

import {
  cities,
  emailThreads,
  outreachBrands,
  replyInbox,
  staffMembers,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Inbox as InboxIcon,
  MessageSquare,
  Plane,
  XCircle,
} from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Inbox · Crawl Engine" };
export const dynamic = "force-dynamic";

type ReplyCategory = "yes" | "no" | "question" | "out_of_office" | "unclear";

const CATEGORY_CONFIG: Record<
  ReplyCategory,
  { label: string; icon: React.ReactNode; tone: string }
> = {
  yes: {
    label: "Yes / Interested",
    icon: <CheckCircle2 className="h-3 w-3" />,
    tone: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
  },
  no: {
    label: "No / Declined",
    icon: <XCircle className="h-3 w-3" />,
    tone: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
  },
  question: {
    label: "Question",
    icon: <HelpCircle className="h-3 w-3" />,
    tone: "text-blue-500 bg-blue-500/10 ring-blue-500/20",
  },
  out_of_office: {
    label: "Out of office",
    icon: <Plane className="h-3 w-3" />,
    tone: "text-zinc-500 bg-zinc-500/10 ring-zinc-500/20",
  },
  unclear: {
    label: "Unclear",
    icon: <MessageSquare className="h-3 w-3" />,
    tone: "text-amber-500 bg-amber-500/10 ring-amber-500/20",
  },
};

const VALID_CATEGORIES = new Set<ReplyCategory>([
  "yes",
  "no",
  "question",
  "out_of_office",
  "unclear",
]);

interface Props {
  searchParams: Promise<{ filter?: string; staff?: string }>;
}

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const { staff: currentStaff } = await requireStaff();

  // Filters
  const filterCategory =
    params.filter && VALID_CATEGORIES.has(params.filter as ReplyCategory)
      ? (params.filter as ReplyCategory)
      : null;
  const filterStaff = params.staff === "mine" ? currentStaff.id : null;

  // Pull all unresolved replies (responded_at IS NULL) with venue + thread + staff context
  const replies = await db
    .select({
      id: replyInbox.id,
      receivedAt: replyInbox.receivedAt,
      respondedAt: replyInbox.respondedAt,
      slaBreachedAt: replyInbox.slaBreachedAt,
      category: replyInbox.category,
      summary: replyInbox.summary,
      venueId: replyInbox.venueId,
      venueName: venues.name,
      cityName: cities.name,
      threadSubject: emailThreads.subject,
      threadId: emailThreads.id,
      brandName: outreachBrands.displayName,
      assignedStaffName: staffMembers.displayName,
      assignedStaffId: replyInbox.assignedStaffId,
    })
    .from(replyInbox)
    .innerJoin(emailThreads, eq(emailThreads.id, replyInbox.emailThreadId))
    .innerJoin(venues, eq(venues.id, replyInbox.venueId))
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, emailThreads.outreachBrandId))
    .leftJoin(staffMembers, eq(staffMembers.id, replyInbox.assignedStaffId))
    .where(
      and(
        isNull(replyInbox.respondedAt),
        filterCategory ? eq(replyInbox.category, filterCategory) : undefined,
        filterStaff ? eq(replyInbox.assignedStaffId, filterStaff) : undefined,
      ),
    )
    .orderBy(desc(replyInbox.receivedAt))
    .limit(200);

  // Aggregate counts by category for the filter strip
  const counts = await db
    .select({
      category: replyInbox.category,
      count: sql<number>`count(*)::int`,
    })
    .from(replyInbox)
    .where(isNull(replyInbox.respondedAt))
    .groupBy(replyInbox.category);
  const countByCategory = new Map(counts.map((c) => [c.category, c.count]));
  const totalOpen = counts.reduce((s, c) => s + c.count, 0);

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Inbox</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Every venue reply across all brands + staff inboxes, in one place. Polling runs every 5
            minutes once Gmail OAuth is connected.
          </p>
        </div>
      </header>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill href="/inbox" active={!filterCategory}>
          All <span className="ml-1 font-mono text-[10px] text-zinc-500">{totalOpen}</span>
        </FilterPill>
        {(
          Object.entries(CATEGORY_CONFIG) as Array<
            [ReplyCategory, (typeof CATEGORY_CONFIG)[ReplyCategory]]
          >
        ).map(([cat, cfg]) => {
          const count = countByCategory.get(cat) ?? 0;
          return (
            <FilterPill key={cat} href={`/inbox?filter=${cat}`} active={filterCategory === cat}>
              {cfg.icon}
              {cfg.label}
              <span className="ml-1 font-mono text-[10px] text-zinc-500">{count}</span>
            </FilterPill>
          );
        })}
        <div className="ml-auto">
          <FilterPill
            href={params.staff === "mine" ? "/inbox" : "/inbox?staff=mine"}
            active={filterStaff !== null}
          >
            Mine only
          </FilterPill>
        </div>
      </div>

      {/* Replies list */}
      {replies.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <InboxIcon className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">
            {totalOpen === 0 ? "Inbox zero" : "Nothing in this filter"}
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {totalOpen === 0
              ? "When venues reply to outreach emails, replies land here grouped and classified."
              : `Clear the filter to see all ${totalOpen} open replies.`}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {replies.map((r) => (
            <ReplyRow
              key={r.id}
              reply={{
                ...r,
                receivedAt: r.receivedAt,
                slaBreachedAt: r.slaBreachedAt,
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-900",
      )}
    >
      {children}
    </Link>
  );
}

function ReplyRow({
  reply,
}: {
  reply: {
    id: string;
    receivedAt: Date;
    slaBreachedAt: Date | null;
    category: string;
    summary: string | null;
    venueId: string;
    venueName: string;
    cityName: string;
    threadSubject: string | null;
    threadId: string;
    brandName: string;
    assignedStaffName: string | null;
  };
}) {
  const cfg =
    (CATEGORY_CONFIG as Record<string, (typeof CATEGORY_CONFIG)[ReplyCategory]>)[reply.category] ??
    CATEGORY_CONFIG.unclear;
  const hoursWaiting = Math.floor((Date.now() - reply.receivedAt.getTime()) / 3_600_000);
  const breached = !!reply.slaBreachedAt;

  return (
    <li className="card-surface p-4 transition-colors hover:brightness-110 dark:hover:brightness-125">
      <Link href={`/venues/${reply.venueId}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <header className="flex flex-wrap items-baseline gap-2">
              <p className="font-medium">{reply.venueName}</p>
              <span className="font-mono text-[10px] text-zinc-500">
                {reply.cityName} · {reply.brandName}
              </span>
            </header>
            {reply.threadSubject && (
              <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
                <span className="text-zinc-500">Re:</span> {reply.threadSubject}
              </p>
            )}
            {reply.summary && (
              <p className="mt-1.5 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                {reply.summary}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset",
                cfg.tone,
              )}
            >
              {cfg.icon}
              {cfg.label}
            </span>
            {breached && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-500 uppercase tracking-widest">
                <AlertTriangle className="h-3 w-3" />
                SLA breach
              </span>
            )}
            <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
              <Clock className="mr-0.5 inline h-3 w-3" />
              {formatWaiting(hoursWaiting)}
            </span>
            {reply.assignedStaffName && (
              <span className="font-mono text-[10px] text-zinc-500">
                → {reply.assignedStaffName}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function formatWaiting(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

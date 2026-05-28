import {
  emailTemplates,
  outreachBrands,
  scheduledSends,
  staffOutreachEmails,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { formatGap } from "@/lib/send-spacing";
import { eq, sql } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Mail, XCircle } from "lucide-react";
import Link from "next/link";
import { cancelScheduledBatch, cancelScheduledSend } from "./_actions";

export const metadata = { title: "Send queue" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  pending: "text-zinc-500 bg-zinc-500/10 ring-zinc-500/20",
  sending: "text-blue-500 bg-blue-500/10 ring-blue-500/20",
  sent: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
  failed: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
  canceled: "text-zinc-400 bg-zinc-400/10 ring-zinc-400/20",
};

interface Props {
  searchParams: Promise<{ batch?: string; status?: string }>;
}

export default async function SendQueuePage({ searchParams }: Props) {
  const params = await searchParams;
  const { staff } = await requireStaff();

  // Pull recent batches (grouped) for this staffer, plus optionally
  // the rows for a single batch if ?batch= is set.
  const batches = await db.execute<{
    batch_id: string;
    batch_label: string;
    count: number;
    first_scheduled: Date;
    last_scheduled: Date;
    pending: number;
    sent: number;
    failed: number;
    canceled: number;
  }>(sql`
    SELECT
      batch_id::text,
      batch_label,
      count(*)::int AS count,
      min(scheduled_for) AS first_scheduled,
      max(scheduled_for) AS last_scheduled,
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'sent')::int AS sent,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'canceled')::int AS canceled
    FROM scheduled_sends
    WHERE staff_member_id = ${staff.id}
      AND batch_id IS NOT NULL
    GROUP BY batch_id, batch_label
    ORDER BY max(scheduled_for) DESC
    LIMIT 30
  `);
  type BatchRow = typeof batches extends { rows: Array<infer R> } ? R : never;
  const batchList: BatchRow[] = Array.isArray(batches)
    ? (batches as unknown as BatchRow[])
    : ((batches as unknown as { rows: BatchRow[] }).rows ?? []);

  // If a specific batch is selected, load its rows
  let rows: Array<{
    id: string;
    status: string;
    scheduledFor: Date;
    sentAt: Date | null;
    recipientEmail: string;
    venueId: string;
    venueName: string;
    failureReason: string | null;
    inboxEmail: string;
    brandName: string;
    templateName: string;
  }> = [];
  if (params.batch) {
    const r = await db
      .select({
        id: scheduledSends.id,
        status: scheduledSends.status,
        scheduledFor: scheduledSends.scheduledFor,
        sentAt: scheduledSends.sentAt,
        recipientEmail: scheduledSends.recipientEmail,
        venueId: venues.id,
        venueName: venues.name,
        failureReason: scheduledSends.failureReason,
        inboxEmail: staffOutreachEmails.emailAddress,
        brandName: outreachBrands.displayName,
        templateName: emailTemplates.name,
      })
      .from(scheduledSends)
      .innerJoin(venues, eq(venues.id, scheduledSends.venueId))
      .innerJoin(
        staffOutreachEmails,
        eq(staffOutreachEmails.id, scheduledSends.staffOutreachEmailId),
      )
      .innerJoin(outreachBrands, eq(outreachBrands.id, scheduledSends.outreachBrandId))
      .innerJoin(emailTemplates, eq(emailTemplates.id, scheduledSends.emailTemplateId))
      .where(eq(scheduledSends.batchId, params.batch))
      .orderBy(scheduledSends.scheduledFor);
    rows = r;
  }

  const selectedBatch = batchList.find((b) => b.batch_id === params.batch);

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-6">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Send queue</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Phase 2 controlled-send queue. Operator-selected batches are spaced through their window
          respecting per-inbox throttle. Pending sends can be canceled until they fire.
        </p>
      </header>

      {batchList.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <Mail className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">No batches queued yet</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            From the venues list, select multiple venues and click 'Queue bulk send' to create your
            first batch. Requires Phase 2+ on the outreach brand.
          </p>
        </div>
      ) : (
        <>
          <section className="card-surface overflow-hidden">
            <header className="border-zinc-200 border-b px-4 py-2.5 dark:border-zinc-800/60">
              <h2 className="font-semibold text-sm tracking-tight">Recent batches</h2>
            </header>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800/60">
              {batchList.map((b) => (
                <BatchRow key={b.batch_id} batch={b} selected={params.batch === b.batch_id} />
              ))}
            </ul>
          </section>

          {selectedBatch && (
            <section className="card-surface overflow-hidden">
              <header className="flex items-baseline justify-between gap-3 border-zinc-200 border-b px-4 py-2.5 dark:border-zinc-800/60">
                <h2 className="font-semibold text-sm tracking-tight">
                  {selectedBatch.batch_label}
                  <span className="ml-2 font-mono text-[10px] text-zinc-500">
                    {rows.length} sends
                  </span>
                </h2>
                {selectedBatch.pending > 0 && (
                  <form
                    action={async (fd: FormData) => {
                      "use server";
                      await cancelScheduledBatch(null, fd);
                    }}
                  >
                    <input type="hidden" name="batchId" value={selectedBatch.batch_id} />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 font-mono text-[10px] text-rose-700 uppercase tracking-widest hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50"
                    >
                      <XCircle className="h-3 w-3" />
                      Cancel {selectedBatch.pending} pending
                    </button>
                  </form>
                )}
              </header>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                    <th className="px-4 py-2.5">Venue</th>
                    <th className="px-4 py-2.5">Recipient</th>
                    <th className="px-4 py-2.5">Template</th>
                    <th className="px-4 py-2.5">Scheduled</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <SendRow key={r.id} row={r} striped={i % 2 === 1} />
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function BatchRow({
  batch,
  selected,
}: {
  batch: {
    batch_id: string;
    batch_label: string;
    count: number;
    first_scheduled: Date;
    last_scheduled: Date;
    pending: number;
    sent: number;
    failed: number;
    canceled: number;
  };
  selected: boolean;
}) {
  const spanSec =
    (new Date(batch.last_scheduled).getTime() - new Date(batch.first_scheduled).getTime()) / 1000;
  const avgGap = batch.count > 1 ? spanSec / (batch.count - 1) : 0;

  return (
    <li className={cn(selected && "bg-blue-500/[0.04]")}>
      <Link
        href={`/send-queue?batch=${batch.batch_id}`}
        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{batch.batch_label}</p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 tabular-nums">
            {batch.count} sends · {formatGap(avgGap)} avg gap ·{" "}
            {new Date(batch.first_scheduled).toLocaleString()} →{" "}
            {new Date(batch.last_scheduled).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          {batch.pending > 0 && (
            <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-zinc-600 ring-1 ring-zinc-500/20 ring-inset dark:text-zinc-300">
              {batch.pending} pending
            </span>
          )}
          {batch.sent > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 ring-1 ring-emerald-500/20 ring-inset">
              {batch.sent} sent
            </span>
          )}
          {batch.failed > 0 && (
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-600 ring-1 ring-rose-500/20 ring-inset">
              {batch.failed} failed
            </span>
          )}
          {batch.canceled > 0 && (
            <span className="rounded-full bg-zinc-400/10 px-2 py-0.5 text-zinc-500 ring-1 ring-zinc-400/20 ring-inset">
              {batch.canceled} canceled
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function SendRow({
  row,
  striped,
}: {
  row: {
    id: string;
    status: string;
    scheduledFor: Date;
    sentAt: Date | null;
    recipientEmail: string;
    venueId: string;
    venueName: string;
    failureReason: string | null;
    templateName: string;
  };
  striped: boolean;
}) {
  const tone = STATUS_TONE[row.status] ?? STATUS_TONE.pending;
  const icon =
    row.status === "sent" ? (
      <CheckCircle2 className="h-3 w-3" />
    ) : row.status === "sending" ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : row.status === "failed" ? (
      <AlertTriangle className="h-3 w-3" />
    ) : row.status === "canceled" ? (
      <XCircle className="h-3 w-3" />
    ) : (
      <Clock className="h-3 w-3" />
    );

  return (
    <tr className={striped ? "dark:bg-white/[0.015]" : ""}>
      <td className="px-4 py-2.5">
        <Link href={`/venues/${row.venueId}`} className="font-medium hover:underline">
          {row.venueName}
        </Link>
      </td>
      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
        {row.recipientEmail}
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">{row.templateName}</td>
      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500 tabular-nums">
        {row.scheduledFor.toLocaleString()}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset",
            tone,
          )}
          title={row.failureReason ?? undefined}
        >
          {icon}
          {row.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        {row.status === "pending" && (
          <form
            action={async (fd: FormData) => {
              "use server";
              await cancelScheduledSend(null, fd);
            }}
          >
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              className="text-zinc-400 hover:text-rose-500"
              title="Cancel this send"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

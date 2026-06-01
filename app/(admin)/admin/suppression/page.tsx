/**
 * /admin/suppression — list + manage the team's email suppression
 * list. Admin-only.
 *
 * Hard-blocks at send time on any address in this list. Reasons:
 *   manual       operator marked
 *   bounced      hard-bounce (auto-populated by the Gmail poll worker
 *                via lib/gmail-poll-worker.ts → classifyBounce; soft
 *                bounces also escalate here after 3 consecutive
 *                failures per migration 0053)
 *   complained   spam complaint
 *   unsubscribe  RFC 8058 List-Unsubscribe click / inbound STOP reply
 *                 (the auto-detector populates this from the poll worker)
 */

import { emailSuppression, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ShieldOff } from "lucide-react";
import { countMalformedSuppression } from "./_actions";
import { AddSuppressionForm } from "./_components/add-suppression-form";
import { CleanupMalformedButton } from "./_components/cleanup-malformed-button";
import { SuppressionTable } from "./_components/suppression-table";

export const metadata = { title: "Admin · Suppression" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    /** Substring search across the email column. ILIKE wildcards
     *  are auto-applied; the operator types just "lavelle" and we
     *  match anywhere in the address. */
    q?: string;
    /** Reason filter. Multi-select via comma-separated values. */
    reason?: string;
  }>;
}

const VALID_REASONS = new Set(["manual", "unsubscribe", "bounced", "complained"]);

export default async function SuppressionPage({ searchParams }: Props) {
  const ctx = await requireAdmin();
  const params = await searchParams;

  const query = (params.q ?? "").trim();
  const reasons = (params.reason ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_REASONS.has(s));

  // Filter predicates. The base predicate is always team-scope; the
  // search filter and reason filter compose with AND so an operator
  // can search "lavelle" within just bounces.
  const baseWhere = eq(emailSuppression.teamId, ctx.staff.teamId);
  const filters: ReturnType<typeof and>[] = [baseWhere];
  if (query.length > 0) {
    // ILIKE on lowercase email column. The suppression table stores
    // emails pre-lowercased on insert, so we don't need to lower()
    // the column side. The query string gets lowercased here to be
    // forgiving of operator typing.
    filters.push(ilike(emailSuppression.email, `%${query.toLowerCase()}%`));
  }
  if (reasons.length > 0) {
    // OR across the selected reasons. Drizzle's `or` collapses a
    // single-item case fine, so we don't special-case length 1.
    filters.push(
      or(
        ...reasons.map((r) =>
          eq(emailSuppression.reason, r as "manual" | "unsubscribe" | "bounced" | "complained"),
        ),
      ),
    );
  }

  // Total count (pre-filter) so the empty-state can distinguish "no
  // suppressions yet" from "no matches for this search."
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailSuppression)
    .where(baseWhere);
  const totalCount = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      id: emailSuppression.id,
      email: emailSuppression.email,
      reason: emailSuppression.reason,
      notes: emailSuppression.notes,
      sourceThreadId: emailSuppression.sourceThreadId,
      createdAt: emailSuppression.createdAt,
      createdByName: users.displayName,
    })
    .from(emailSuppression)
    .leftJoin(users, eq(users.id, emailSuppression.createdBy))
    .where(and(...filters))
    .orderBy(desc(emailSuppression.createdAt))
    .limit(500); // safety cap; UI exposes search rather than paging

  const filtered = query.length > 0 || reasons.length > 0;

  // Count malformed legacy rows (pre-ff2246c blockThreadSender bug).
  // The CleanupMalformedButton renders only when count > 0 so the
  // strip is invisible for clean teams.
  const malformed = await countMalformedSuppression();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Suppression</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Email addresses on this list are HARD-BLOCKED at send time across every connected inbox
            on the team. Use for unsubscribes, hard bounces, spam complaints, and operator-marked
            do-not-contact addresses that aren't tied to a specific venue.
          </p>
        </div>
      </header>

      <AddSuppressionForm />

      <CleanupMalformedButton count={malformed.count} sample={malformed.sample} />

      <SuppressionFilters query={query} reasons={reasons} totalCount={totalCount} />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
          <ShieldOff className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">
            {filtered
              ? "No suppressed addresses match the current filter."
              : "No suppressed addresses yet."}
          </p>
        </div>
      ) : (
        <SuppressionTable rows={rows} />
      )}
    </div>
  );
}

/**
 * Inline filter strip rendered ABOVE the suppression table. Built
 * here as a server-rendered <form GET> so the URL carries the
 * filter state (shareable, bookmarkable, survives refresh) without
 * client-side state plumbing.
 */
function SuppressionFilters({
  query,
  reasons,
  totalCount,
}: {
  query: string;
  reasons: string[];
  totalCount: number;
}) {
  const REASON_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "manual", label: "Manual" },
    { value: "unsubscribe", label: "Unsubscribed" },
    { value: "bounced", label: "Bounced" },
    { value: "complained", label: "Complained" },
  ];
  return (
    <form
      method="GET"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="suppression-q"
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest"
        >
          Search ({totalCount} total)
        </label>
        <input
          id="suppression-q"
          name="q"
          type="text"
          defaultValue={query}
          placeholder="email or domain"
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Reason
        </span>
        <div className="flex flex-wrap gap-2">
          {REASON_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              <input
                type="checkbox"
                name="reason"
                value={opt.value}
                defaultChecked={reasons.includes(opt.value)}
                className="rounded text-zinc-700"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Apply
      </button>
      {(query.length > 0 || reasons.length > 0) && (
        <a
          href="/admin/suppression"
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-medium text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
        >
          Clear
        </a>
      )}
    </form>
  );
}

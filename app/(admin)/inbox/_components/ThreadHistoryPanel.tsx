/**
 * ThreadHistoryPanel — per-thread audit/history timeline.
 *
 * Server component that loads audit_log entries for this thread
 * (and the linked venue when present) via lib/activity-history.ts.
 *
 * Renders inside <details> so it's collapsed by default — the
 * common case is operators triaging quickly; history is the rare
 * "wait, who archived this last week?" lookup.
 *
 * Surfaces both kinds of provenance:
 *   - Thread-level: state changes, assignment, classification, stale
 *     flags, follow-up cadence advances
 *   - Venue-level (when attached): DNC flip, contact email edits, etc.
 *
 * Style choices:
 *   - Timeline rows are tight (one line per change when possible)
 *   - "who · when · summary" pattern matches the rest of the engine
 *   - Field renames apply via FIELD_LABELS so operators see
 *     human-readable names ("Reply state" instead of "state")
 */

import { loadRowActivity } from "@/lib/activity-history";
import { ChevronRight, History } from "lucide-react";

interface Props {
  threadId: string;
  /** Optional — when present, the linked venue's history merges in
   *  so operators see e.g. DNC flips that affect this thread. */
  venueId?: string | null;
  /** Override the default limit (50). Cap = 200. */
  limit?: number;
}

const FIELD_LABELS: Record<string, string> = {
  state: "Reply state",
  classification: "Reply classification",
  assigned_staff_id: "Assignment",
  is_stale: "Stale flag",
  stale_reason: "Stale reason",
  follow_up_stage: "Follow-up stage",
  follow_up_next_due_at: "Next follow-up due",
  archived_at: "Archived",
  snippet: "Preview",
  venue_id: "Linked venue",
  do_not_contact: "Do-not-contact",
  do_not_contact_reason: "DNC reason",
  email: "Email",
  name: "Name",
};

const TABLE_LABELS: Record<string, string> = {
  email_threads: "thread",
  venues: "venue",
};

/** Compact field-value display: collapses long strings + nulls. */
function fmtValue(v: string | null): string {
  if (v == null || v === "") return "—";
  if (v === "true") return "yes";
  if (v === "false") return "no";
  if (v.length > 60) return `${v.slice(0, 57)}…`;
  return v;
}

/** Relative time string — "2h ago", "Mon", "Mar 3". */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export async function ThreadHistoryPanel({ threadId, venueId, limit }: Props) {
  // Single call loads both thread + linked-venue history merged
  // into one chronological stream. loadRowActivity already handles
  // requireStaff so this surface is auth-gated.
  let entries: Awaited<ReturnType<typeof loadRowActivity>>;
  try {
    entries = await loadRowActivity({
      table: "email_threads",
      recordId: threadId,
      alsoTable: venueId ? "venues" : undefined,
      alsoRecordId: venueId ?? undefined,
      limit,
    });
  } catch {
    // Audit history is purely supplementary — if it errors (DB
    // hiccup, permissions edge case), hide the panel rather than
    // breaking the whole thread view.
    return null;
  }

  if (entries.length === 0) return null;

  return (
    <details className="group border-zinc-200/80 border-b dark:border-zinc-800/60">
      <summary className="flex cursor-pointer items-center gap-2 px-6 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
        <ChevronRight className="h-3.5 w-3.5 text-zinc-500 transition-transform group-open:rotate-90" />
        <History className="h-3.5 w-3.5 text-zinc-500" />
        <span className="font-medium text-sm">History</span>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          {entries.length} {entries.length === 1 ? "event" : "events"}
        </span>
      </summary>
      <ol className="flex flex-col divide-y divide-zinc-100 px-6 pb-4 dark:divide-zinc-800/40">
        {entries.map((e) => (
          <li key={e.id} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{e.changedByDisplayName ?? "System"}</span>{" "}
                <span className="text-zinc-500">
                  {operationVerb(e.operation, TABLE_LABELS[e.table] ?? e.table)}
                </span>
              </p>
              <span
                className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums"
                title={new Date(e.changedAt).toLocaleString()}
              >
                {relativeTime(e.changedAt)}
              </span>
            </div>
            {e.changes.length > 0 && e.operation === "UPDATE" && (
              <ul className="mt-1 flex flex-col gap-0.5 pl-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                {e.changes.map((c) => (
                  <li key={c.field} className="font-mono">
                    <span className="text-zinc-500">{FIELD_LABELS[c.field] ?? c.field}:</span>{" "}
                    <span className="line-through">{fmtValue(c.from)}</span>{" "}
                    <span className="text-zinc-400">→</span>{" "}
                    <span className="text-zinc-700 dark:text-zinc-200">{fmtValue(c.to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function operationVerb(op: "INSERT" | "UPDATE" | "DELETE", tableLabel: string): string {
  if (op === "INSERT") return `created the ${tableLabel}`;
  if (op === "DELETE") return `deleted the ${tableLabel}`;
  return `updated the ${tableLabel}`;
}

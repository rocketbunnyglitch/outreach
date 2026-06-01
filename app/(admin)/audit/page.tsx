import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { auditLog, staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Database, PencilLine, Plus, Trash2, User } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Known audit-emitting tables for the filter dropdown. Hardcoded for the
// curated set instead of SELECT DISTINCT — keeps the page fast and the
// filter UI predictable.
const KNOWN_TABLES = [
  "outreach_brands",
  "crawl_brands",
  "campaigns",
  "cities",
  "city_campaigns",
  "events",
  "venues",
  "venue_events",
  "outreach_log",
  "staff_members",
];

interface AuditPageProps {
  searchParams: Promise<{
    table?: string;
    staff?: string;
    page?: string;
  }>;
}

export default async function AuditLogPage({ searchParams }: AuditPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const filters = [
    params.table && KNOWN_TABLES.includes(params.table)
      ? eq(auditLog.tableName, params.table)
      : undefined,
    params.staff ? eq(auditLog.changedBy, params.staff) : undefined,
  ].filter(Boolean);

  const where = filters.length > 0 ? and(...(filters as [])) : undefined;

  // Two queries in parallel: rows for this page + total count for pagination.
  // Drizzle's `count` from drizzle-orm returns a number; we use raw sql for
  // safety with the filter combination.
  const [rows, [countRow], staffList] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        tableName: auditLog.tableName,
        recordId: auditLog.recordId,
        operation: auditLog.operation,
        changedAt: auditLog.changedAt,
        oldValues: auditLog.oldValues,
        newValues: auditLog.newValues,
        staffName: staffMembers.displayName,
        staffEmail: staffMembers.primaryEmail,
      })
      .from(auditLog)
      .leftJoin(staffMembers, eq(staffMembers.id, auditLog.changedBy))
      .where(where)
      .orderBy(desc(auditLog.changedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(auditLog)
      .where(where),
    db
      .select({
        id: staffMembers.id,
        displayName: staffMembers.displayName,
      })
      .from(staffMembers)
      .orderBy(staffMembers.displayName),
  ]);

  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-4xl tracking-tight ">Audit log</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Every change to every table, attributed to the staffer who made it. Append-only,
            populated by Postgres triggers — no app code can falsify these entries.
          </p>
        </div>
      </header>

      {/* Filters */}
      <form
        action="/audit"
        className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="table" className="text-xs text-zinc-500 uppercase tracking-widest">
            Table
          </label>
          <Select name="table" defaultValue={params.table ?? "_all"}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All tables</SelectItem>
              {KNOWN_TABLES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="staff" className="text-xs text-zinc-500 uppercase tracking-widest">
            Staff
          </label>
          <Select name="staff" defaultValue={params.staff ?? "_all"}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All staff</SelectItem>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="outline" size="sm">
          Apply filters
        </Button>
        {(params.table || params.staff) && (
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href="/audit">Clear</Link>
          </Button>
        )}
        <span className="ml-auto font-mono text-xs text-zinc-500">
          {total.toLocaleString("en-US")} entries · page {page} / {totalPages}
        </span>
      </form>

      {rows.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center text-sm text-zinc-500">
          No audit entries match these filters.
        </Card>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((r) => (
            <AuditRow key={r.id.toString()} row={r} />
          ))}
        </ol>
      )}

      <Pagination page={page} totalPages={totalPages} searchParams={params} />
    </div>
  );
}

interface AuditRowData {
  id: bigint;
  tableName: string;
  recordId: string | null;
  operation: string;
  changedAt: Date;
  oldValues: unknown;
  newValues: unknown;
  staffName: string | null;
  staffEmail: string | null;
}

function AuditRow({ row }: { row: AuditRowData }) {
  const detailHref = recordHref(row.tableName, row.recordId);
  const changedFields = diffFieldNames(row.oldValues, row.newValues);

  return (
    <li className="flex items-center gap-3 rounded-md border border-zinc-100 px-4 py-3 transition-colors hover:border-zinc-200 dark:border-zinc-900 dark:hover:border-zinc-800">
      <OperationIcon operation={row.operation} />
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-700 uppercase tracking-wider dark:text-zinc-300">
            {row.tableName}
          </span>
          <Badge tone={operationTone(row.operation)}>{row.operation}</Badge>
          {changedFields.length > 0 && (
            <span className="text-xs text-zinc-500">
              {changedFields.slice(0, 5).join(", ")}
              {changedFields.length > 5 ? ` +${changedFields.length - 5}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <User className="h-3 w-3" />
            {row.staffName ?? "system"}
          </span>
          <span>·</span>
          <time
            dateTime={row.changedAt.toISOString()}
            className="font-mono"
            title={row.changedAt.toISOString()}
          >
            {formatRelative(row.changedAt)}
          </time>
          {detailHref && (
            <>
              <span>·</span>
              <Link
                href={detailHref}
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                view record →
              </Link>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function OperationIcon({ operation }: { operation: string }) {
  const className = "h-4 w-4 shrink-0";
  switch (operation) {
    case "INSERT":
      return <Plus className={`${className} text-emerald-600 dark:text-emerald-400`} />;
    case "UPDATE":
      return <PencilLine className={`${className} text-zinc-500`} />;
    case "DELETE":
      return <Trash2 className={`${className} text-rose-600 dark:text-rose-400`} />;
    default:
      return <Database className={`${className} text-zinc-400`} />;
  }
}

function operationTone(op: string): "default" | "success" | "muted" | "warning" {
  if (op === "INSERT") return "success";
  if (op === "DELETE") return "warning";
  return "muted";
}

/**
 * Compare oldValues and newValues JSONB to surface which fields actually
 * changed. For INSERTs, lists keys in newValues except defaults. For UPDATEs,
 * lists keys where new !== old.
 */
function diffFieldNames(oldV: unknown, newV: unknown): string[] {
  if (!newV || typeof newV !== "object") return [];
  const newObj = newV as Record<string, unknown>;
  if (!oldV || typeof oldV !== "object") {
    // INSERT — show meaningful keys, skip noisy ones
    return Object.keys(newObj)
      .filter((k) => !["id", "created_at", "updated_at", "version"].includes(k))
      .slice(0, 8);
  }
  const oldObj = oldV as Record<string, unknown>;
  const changed: string[] = [];
  for (const key of Object.keys(newObj)) {
    if (["updated_at", "version"].includes(key)) continue;
    if (JSON.stringify(newObj[key]) !== JSON.stringify(oldObj[key])) {
      changed.push(key);
    }
  }
  return changed;
}

function recordHref(table: string, id: string | null): string | null {
  if (!id) return null;
  switch (table) {
    case "outreach_brands":
      return `/brands/outreach/${id}`;
    case "crawl_brands":
      return `/brands/crawl/${id}`;
    case "campaigns":
      return `/campaigns/${id}`;
    case "cities":
      return `/cities/${id}`;
    case "city_campaigns":
      return `/city-campaigns/${id}`;
    case "events":
      return `/events/${id}`;
    case "venues":
      return `/venues/${id}`;
    default:
      return null;
  }
}

function formatRelative(d: Date): string {
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US");
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: { table?: string; staff?: string };
}) {
  if (totalPages <= 1) return null;
  const qs = (n: number) => {
    const usp = new URLSearchParams();
    if (searchParams.table) usp.set("table", searchParams.table);
    if (searchParams.staff) usp.set("staff", searchParams.staff);
    usp.set("page", String(n));
    return `/audit?${usp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between gap-3 border-zinc-200 border-t pt-4 dark:border-zinc-800">
      <Button asChild variant="outline" size="sm" disabled={page <= 1}>
        <Link href={qs(Math.max(1, page - 1))}>
          <ChevronLeft className="h-3 w-3" /> Newer
        </Link>
      </Button>
      <span className="font-mono text-xs text-zinc-500">
        {page} / {totalPages}
      </span>
      <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
        <Link href={qs(Math.min(totalPages, page + 1))}>
          Older <ChevronRight className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}

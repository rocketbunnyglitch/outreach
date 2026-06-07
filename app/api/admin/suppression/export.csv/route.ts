/**
 * GET /api/admin/suppression/export.csv
 *
 * Streams a CSV of the team's email_suppression list. Admin-only.
 *
 * Honors the same q + reason filters as the /admin/suppression
 * page, so an admin can search for "lavelle" + export just the
 * matching subset. No filters = export everything on the team.
 *
 * Format:
 *   Header row: Email, Reason, Notes, Source Thread, Created At, Created By
 *   One row per suppression, most-recent first (matches the on-page
 *   table ordering so an export is a snapshot of what the admin sees).
 *
 * Content-Disposition: attachment with a date-stamped filename so the
 * operator's Downloads folder stays clean on repeat exports.
 */

import { emailSuppression, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VALID_REASONS = new Set(["manual", "unsubscribe", "bounced", "complained"]);

export async function GET(req: Request) {
  const ctx = await requireAdmin();
  const { searchParams } = new URL(req.url);

  const query = (searchParams.get("q") ?? "").trim();
  const reasons = (searchParams.get("reason") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_REASONS.has(s));

  const baseWhere = eq(emailSuppression.teamId, ctx.staff.teamId);
  const filters: ReturnType<typeof and>[] = [baseWhere];
  if (query.length > 0) {
    filters.push(ilike(emailSuppression.email, `%${query.toLowerCase()}%`));
  }
  if (reasons.length > 0) {
    // OR across the chosen reasons; same shape as the page-side
    // multi-select.
    const reasonPredicates = reasons.map((r) =>
      eq(emailSuppression.reason, r as "manual" | "unsubscribe" | "bounced" | "complained"),
    );
    const reasonOr = or(...reasonPredicates);
    if (reasonOr) filters.push(reasonOr);
  }

  // No safety cap here -- export should be complete. The page UI
  // caps at 500 for render performance; the CSV path is one-shot
  // and the operator explicitly asked for the whole list.
  const rows = await db
    .select({
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
    .orderBy(desc(emailSuppression.createdAt));

  const headerRow = ["Email", "Reason", "Notes", "Source Thread", "Created At", "Created By"];
  const lines: string[] = [headerRow.map(csvEscape).join(",")];

  for (const row of rows) {
    const cells = [
      row.email,
      row.reason ?? "",
      row.notes ?? "",
      row.sourceThreadId ?? "",
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
      row.createdByName ?? "",
    ];
    lines.push(cells.map(csvEscape).join(","));
  }

  const body = `${lines.join("\n")}\n`;
  const datestamp = new Date().toISOString().slice(0, 10);
  const filterTag = query.length > 0 || reasons.length > 0 ? "-filtered" : "";
  const filename = `suppression${filterTag}-${datestamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Excel-safe CSV escaping:
 *   - Wrap any cell containing a comma, quote, or newline in quotes
 *   - Inside quotes, double up any existing quotes
 *   - Empty cells render as empty (no quotes needed)
 */
function csvEscape(value: string): string {
  if (value === "") return "";
  // Neutralize spreadsheet formula injection (leading = + - @ tab cr).
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

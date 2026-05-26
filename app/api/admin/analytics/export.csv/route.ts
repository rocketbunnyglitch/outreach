/**
 * GET /api/admin/analytics/export.csv?window=7
 *
 * Streams a CSV of the team analytics rollup over the requested
 * window. Admin-only (requireAdmin → notFound for non-admins).
 *
 * Format:
 *   Header row: Name, Email, Role, Calls, Emails Sent, SMS Sent,
 *               Total Touches, Avg Per Active Day, Day 1 .. Day N
 *   One row per staff, sorted by total touches DESC (matches the
 *   on-screen table)
 *
 * Content-Disposition: attachment with a date-stamped filename so
 * the operator's Downloads folder stays clean (no overwrites on
 * repeated exports).
 */

import { requireAdmin } from "@/lib/auth";
import { loadTeamAnalytics } from "@/lib/team-analytics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAdmin();
  const { searchParams } = new URL(req.url);
  const windowDays = Number(searchParams.get("window") ?? "7");

  const data = await loadTeamAnalytics({
    windowDays: Number.isFinite(windowDays) ? windowDays : 7,
  });

  // Generate per-day date headers (oldest first, matching the daily array)
  const dayHeaders: string[] = [];
  const start = new Date(`${data.windowStart}T00:00:00Z`);
  for (let i = 0; i < data.windowDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    dayHeaders.push(d.toISOString().slice(0, 10));
  }

  const headerRow = [
    "Name",
    "Email",
    "Role",
    "Calls",
    "Emails Sent",
    "SMS Sent",
    "Total Touches",
    "Avg Per Active Day",
    ...dayHeaders,
  ];

  const lines: string[] = [headerRow.map(csvEscape).join(",")];

  for (const row of data.rows) {
    const cells = [
      row.displayName,
      row.primaryEmail,
      row.role,
      String(row.calls),
      String(row.emailsSent),
      String(row.smsSent),
      String(row.totalTouches),
      String(row.avgPerActiveDay),
      ...row.daily.map((n) => String(n)),
    ];
    lines.push(cells.map(csvEscape).join(","));
  }

  // Totals row at the bottom for quick sanity check
  lines.push(""); // blank separator
  lines.push(
    [
      "TOTAL",
      "",
      "",
      String(data.totals.calls),
      String(data.totals.emailsSent),
      String(data.totals.smsSent),
      String(data.totals.totalTouches),
      "",
    ]
      .map(csvEscape)
      .join(","),
  );

  const body = `${lines.join("\n")}\n`;
  const filename = `team-analytics-${data.windowStart}-to-${data.windowEnd}.csv`;

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
 *   • Wrap any cell containing a comma, quote, or newline in quotes
 *   • Inside quotes, double up any existing quotes
 *   • Empty cells render as empty (no quotes needed)
 */
function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

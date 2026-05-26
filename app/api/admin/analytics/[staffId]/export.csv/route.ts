/**
 * GET /api/admin/analytics/[staffId]/export.csv?window=30
 *
 * Per-staff CSV export — daily breakdown + top venues + activity
 * feed in one downloadable file. Admin-only.
 *
 * Multi-section CSV: three blocks separated by a blank line and a
 * SECTION marker row. Excel and Google Sheets handle this fine —
 * each block reads as its own table when the user pastes/imports.
 *
 *   Section 1: Daily breakdown
 *     Date, Calls, Emails Sent, SMS Sent, Viber, Total
 *   Section 2: Top venues
 *     Rank, Venue, City, Calls, Emails, SMS, Viber, Total, Last Touch
 *   Section 3: Recent activity
 *     Timestamp, Channel, Venue, City, Outcome, Notes
 *
 * Returns 404 (via notFound from loadStaffActivityProfile) when the
 * staffId doesn't resolve to an active staff member.
 */

import { requireAdmin } from "@/lib/auth";
import { loadStaffActivityProfile } from "@/lib/team-analytics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ staffId: string }> }) {
  await requireAdmin();
  const { staffId } = await params;
  const { searchParams } = new URL(req.url);
  const windowDays = Number(searchParams.get("window") ?? "30");

  const profile = await loadStaffActivityProfile({
    staffId,
    windowDays: Number.isFinite(windowDays) ? windowDays : 30,
  });
  if (!profile) {
    return new NextResponse("Staff not found", { status: 404 });
  }

  const sections: string[] = [];

  // Header
  sections.push(
    [
      `# ${profile.staff.displayName} (${profile.staff.primaryEmail}) · ${profile.staff.role}`,
      `# Window: ${profile.windowStart} → ${profile.windowEnd} (${profile.windowDays} days)`,
      `# Totals: ${profile.totals.calls} calls, ${profile.totals.emailsSent} emails, ${profile.totals.smsSent} sms, ${profile.totals.viberTouches} viber, ${profile.totals.totalTouches} total`,
    ].join("\n"),
  );

  // Section 1: Daily breakdown
  sections.push(
    [
      "## DAILY BREAKDOWN",
      ["Date", "Calls", "Emails Sent", "SMS Sent", "Viber", "Total"].map(csvEscape).join(","),
      ...profile.daily.map((d) =>
        [
          d.date,
          String(d.calls),
          String(d.emailsSent),
          String(d.smsSent),
          String(d.viberTouches),
          String(d.total),
        ]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n"),
  );

  // Section 2: Top venues
  sections.push(
    [
      "## TOP VENUES",
      ["Rank", "Venue", "City", "Calls", "Emails", "SMS", "Viber", "Total", "Last Touch"]
        .map(csvEscape)
        .join(","),
      ...profile.topVenues.map((v, i) =>
        [
          String(i + 1),
          v.venueName,
          v.cityName ?? "",
          String(v.calls),
          String(v.emails),
          String(v.sms),
          String(v.viber),
          String(v.totalTouches),
          v.lastTouchAt,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n"),
  );

  // Section 3: Recent activity (last 30)
  sections.push(
    [
      "## RECENT ACTIVITY",
      ["Timestamp", "Channel", "Venue", "City", "Outcome", "Notes"].map(csvEscape).join(","),
      ...profile.recentActivity.map((a) =>
        [a.createdAt, a.channel, a.venueName, a.cityName ?? "", a.outcome, a.notes ?? ""]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n"),
  );

  const body = `${sections.join("\n\n")}\n`;
  const safeName = profile.staff.displayName.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  const filename = `${safeName}-activity-${profile.windowStart}-to-${profile.windowEnd}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

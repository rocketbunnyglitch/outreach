"use server";

/**
 * Team activity feed loader.
 *
 * Reads audit_log + outreach_log over the last N hours (default 4) and
 * synthesizes a per-staff summary: how many venues each teammate touched,
 * which actions, plus the most recent timeline.
 *
 * No new schema — uses existing tables. The cost is one query into each
 * table over a small time window (4h * the team's pace = low hundreds
 * of rows in the worst case).
 */

import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface TeamActivityEntry {
  staffId: string;
  displayName: string;
  /** Count of distinct action verbs in the window */
  counts: {
    /** Venue records they touched via inline edits, status changes, etc. */
    edits: number;
    /** Outreach contacts they made (calls, emails, sms, viber, AI sends) */
    outreach: number;
    /** Archives (soft-deletes) */
    archives: number;
    /** New records created (venues, leads, etc.) */
    creates: number;
  };
  /** Most recent timestamp across all activity */
  lastActiveAt: string;
  /** Sample of recent events for the popover */
  recent: Array<{
    when: string;
    verb: string;
    target: string;
  }>;
}

export interface TeamActivitySummary {
  entries: TeamActivityEntry[];
  windowHours: number;
  /** Total event count across all staff in the window */
  totalEvents: number;
}

const VERB_LABELS: Record<string, string> = {
  // outreach channels
  email: "emailed",
  call: "called",
  sms: "texted",
  viber: "messaged",
  ai_draft: "drafted to",
  // audit verbs (synthesized below)
  edit: "edited",
  archive: "archived",
  create: "added",
  status: "updated status",
};

export async function loadTeamActivity(windowHours = 4): Promise<TeamActivitySummary> {
  await requireStaff();

  const hours = Math.max(1, Math.min(windowHours, 24));

  type AuditRow = {
    table_name: string;
    operation: "INSERT" | "UPDATE" | "DELETE";
    changed_at: string;
    changed_by: string | null;
    display_name: string | null;
    target_name: string | null;
  };
  type OutreachRow = {
    occurred_at: string;
    staff_member_id: string;
    display_name: string;
    channel: string;
    venue_name: string;
  };

  // Two queries — audit_log gives edits/creates/archives, outreach_log
  // gives channel-specific contact attempts.
  const [auditResult, outreachResult] = await Promise.all([
    db.execute<AuditRow>(sql`
      SELECT
        al.table_name,
        al.operation::text AS operation,
        al.changed_at::text,
        al.changed_by::text AS changed_by,
        sm.display_name,
        -- Try to extract a venue name from the new/old values so the
        -- 'target' column in the popover is human-readable. Falls back
        -- to the table name when no name field present.
        COALESCE(
          al.new_values->>'name',
          al.old_values->>'name',
          NULLIF(al.table_name, '')
        ) AS target_name
      FROM audit_log al
      LEFT JOIN staff_members sm ON sm.id = al.changed_by
      WHERE al.changed_at > NOW() - (${hours} || ' hours')::interval
        AND al.changed_by IS NOT NULL
        AND al.table_name IN (
          'venues', 'cold_outreach_entries', 'venue_events',
          'crawl_slots', 'events'
        )
      ORDER BY al.changed_at DESC
      LIMIT 500
    `),
    db.execute<OutreachRow>(sql`
      SELECT
        ol.occurred_at::text AS occurred_at,
        ol.staff_member_id::text AS staff_member_id,
        sm.display_name,
        ol.channel::text AS channel,
        v.name AS venue_name
      FROM outreach_log ol
      JOIN staff_members sm ON sm.id = ol.staff_member_id
      JOIN venues v ON v.id = ol.venue_id
      WHERE ol.occurred_at > NOW() - (${hours} || ' hours')::interval
      ORDER BY ol.occurred_at DESC
      LIMIT 500
    `),
  ]);

  function unwrap<T>(r: unknown): T[] {
    return Array.isArray(r) ? (r as T[]) : ((r as { rows: T[] }).rows ?? []);
  }

  const auditRows = unwrap<AuditRow>(auditResult);
  const outreachRows = unwrap<OutreachRow>(outreachResult);

  // Bucket by staff_id
  const byStaff = new Map<string, TeamActivityEntry>();

  function ensure(staffId: string, displayName: string): TeamActivityEntry {
    let e = byStaff.get(staffId);
    if (!e) {
      e = {
        staffId,
        displayName: displayName ?? "Unknown",
        counts: { edits: 0, outreach: 0, archives: 0, creates: 0 },
        lastActiveAt: new Date(0).toISOString(),
        recent: [],
      };
      byStaff.set(staffId, e);
    }
    return e;
  }

  // Audit events
  for (const r of auditRows) {
    if (!r.changed_by || !r.display_name) continue;
    const entry = ensure(r.changed_by, r.display_name);

    // Bucket the verb
    let verb: string;
    if (r.operation === "INSERT") {
      entry.counts.creates++;
      verb = "create";
    } else if (r.operation === "DELETE") {
      entry.counts.archives++;
      verb = "archive";
    } else {
      entry.counts.edits++;
      verb = "edit";
    }

    // Update lastActiveAt
    if (r.changed_at > entry.lastActiveAt) {
      entry.lastActiveAt = r.changed_at;
    }

    // Sample for the recent timeline (cap at 5 per staff for popover)
    if (entry.recent.length < 5) {
      entry.recent.push({
        when: r.changed_at,
        verb: VERB_LABELS[verb] ?? verb,
        target: r.target_name ?? r.table_name,
      });
    }
  }

  // Outreach events
  for (const r of outreachRows) {
    const entry = ensure(r.staff_member_id, r.display_name);
    entry.counts.outreach++;
    if (r.occurred_at > entry.lastActiveAt) entry.lastActiveAt = r.occurred_at;
    if (entry.recent.length < 5) {
      entry.recent.push({
        when: r.occurred_at,
        verb: VERB_LABELS[r.channel] ?? r.channel,
        target: r.venue_name,
      });
    }
  }

  // Sort each staff's recent timeline by time, then sort staff by
  // lastActiveAt descending (most-recent-active first)
  const entries = [...byStaff.values()];
  for (const e of entries) {
    e.recent.sort((a, b) => (a.when < b.when ? 1 : -1));
  }
  entries.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));

  return {
    entries,
    windowHours: hours,
    totalEvents: auditRows.length + outreachRows.length,
  };
}

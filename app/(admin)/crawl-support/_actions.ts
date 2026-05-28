"use server";

import { events, callLogs, cities, crawlIssues, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import type { ReverseSearchResults } from "@/lib/crawl-support-types";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { desc, eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const uuid = z.string().uuid();

const createSchema = z.object({
  issueType: z.enum([
    "venue_not_expecting",
    "capacity",
    "door_line",
    "wristband_checkin",
    "final_venue",
    "wrong_address",
    "manager_unavailable",
    "schedule_confusion",
    "attendee_complaint",
    "staff_no_show",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  eventId: uuid.nullable().optional(),
  venueId: uuid.nullable().optional(),
  callerContact: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  assignedStaffId: uuid.nullable().optional(),
});

export async function createCrawlIssue(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid issue input." };
  const d = parsed.data;
  try {
    // Denormalise city_campaign from the chosen crawl so issues scope cleanly
    // even when no city_campaign was passed directly.
    let cityCampaignId: string | null = null;
    if (d.eventId) {
      const [ev] = await db
        .select({ ccId: events.cityCampaignId })
        .from(events)
        .where(eq(events.id, d.eventId))
        .limit(1);
      cityCampaignId = ev?.ccId ?? null;
    }
    const id = await withAuditContext(staff.id, async (tx) => {
      const [row] = await tx
        .insert(crawlIssues)
        .values({
          issueType: d.issueType,
          severity: d.severity ?? "medium",
          eventId: d.eventId ?? null,
          venueId: d.venueId ?? null,
          cityCampaignId,
          callerContact: d.callerContact ?? null,
          notes: d.notes ?? null,
          assignedStaffId: d.assignedStaffId ?? null,
          status: d.assignedStaffId ? "in_progress" : "open",
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: crawlIssues.id });
      if (!row) throw new Error("crawl_issues insert returned no row");
      return row.id;
    });
    revalidatePath("/crawl-support");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "createCrawlIssue failed");
    return { ok: false, error: "Couldn't log the issue (is the crawl_issues table migrated?)." };
  }
}

export async function resolveCrawlIssue(id: string): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Bad id." };
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(crawlIssues)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: staff.id,
          updatedBy: staff.id,
        })
        .where(eq(crawlIssues.id, id));
    });
    revalidatePath("/crawl-support");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "resolveCrawlIssue failed");
    return { ok: false, error: "Couldn't resolve the issue." };
  }
}

export async function assignCrawlIssue(
  id: string,
  staffId: string,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  if (!uuid.safeParse(id).success || !uuid.safeParse(staffId).success) {
    return { ok: false, error: "Bad id." };
  }
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(crawlIssues)
        .set({ assignedStaffId: staffId, status: "in_progress", updatedBy: staff.id })
        .where(eq(crawlIssues.id, id));
    });
    revalidatePath("/crawl-support");
    return { ok: true, data: { id } };
  } catch (err) {
    logger.error({ err }, "assignCrawlIssue failed");
    return { ok: false, error: "Couldn't assign the issue." };
  }
}

/**
 * Cross-entity reverse lookup for the support tab — find a venue/city/recent
 * caller by name, phone (partial), or email. Read-only; guarded so a missing
 * call_logs table degrades gracefully instead of nuking venue/city results.
 */
export async function reverseSearch(query: string): Promise<ReverseSearchResults> {
  await requireStaff();
  const empty: ReverseSearchResults = { venues: [], cities: [], calls: [] };
  const q = query.trim();
  if (q.length < 2) return empty;
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");

  try {
    const venueRows = await db
      .select({
        id: venues.id,
        name: venues.name,
        phoneE164: venues.phoneE164,
        email: venues.email,
      })
      .from(venues)
      .where(or(ilike(venues.name, like), ilike(venues.phoneE164, like), ilike(venues.email, like)))
      .limit(8);

    const cityRows = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(ilike(cities.name, like))
      .limit(5);

    // Recent callers — own try/catch so a pre-migration call_logs table doesn't
    // drop the venue/city results above.
    let calls: ReverseSearchResults["calls"] = [];
    if (digits.length >= 3) {
      try {
        const callRows = await db
          .select({
            id: callLogs.id,
            fromE164: callLogs.fromE164,
            callerName: callLogs.callerName,
            venueName: venues.name,
            occurredAt: callLogs.occurredAt,
          })
          .from(callLogs)
          .leftJoin(venues, eq(venues.id, callLogs.matchedVenueId))
          .where(ilike(callLogs.fromE164, `%${digits}%`))
          .orderBy(desc(callLogs.occurredAt))
          .limit(5);
        calls = callRows.map((r) => ({
          id: r.id,
          fromE164: r.fromE164 ?? null,
          callerName: r.callerName ?? null,
          matchedVenueName: r.venueName ?? null,
          occurredAtIso: (r.occurredAt instanceof Date
            ? r.occurredAt
            : new Date(r.occurredAt)
          ).toISOString(),
        }));
      } catch (err) {
        logger.warn({ err }, "reverseSearch calls lookup failed (call_logs not migrated?)");
      }
    }

    return {
      venues: venueRows.map((v) => ({
        id: v.id,
        name: v.name,
        phoneE164: v.phoneE164 ?? null,
        email: v.email ?? null,
      })),
      cities: cityRows,
      calls,
    };
  } catch (err) {
    logger.warn({ err }, "reverseSearch failed");
    return empty;
  }
}

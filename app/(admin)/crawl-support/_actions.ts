"use server";

import { events, crawlIssues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
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

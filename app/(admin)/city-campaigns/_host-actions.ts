"use server";

/**
 * Crawl host assignment. Up to 2 hosts per crawl, each internal or
 * external. Operator session-12 P3.
 */

import { crawlHosts, externalHosts, internalHosts } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export interface HostOption {
  id: string;
  name: string;
  type: "internal" | "external";
}

/**
 * All active hosts (internal + external) for the assignment picker.
 */
export async function loadHostOptions(): Promise<HostOption[]> {
  await requireStaff();
  const [internal, external] = await Promise.all([
    db
      .select({ id: internalHosts.id, name: internalHosts.name })
      .from(internalHosts)
      .where(isNull(internalHosts.archivedAt))
      .orderBy(asc(internalHosts.name)),
    db
      .select({ id: externalHosts.id, name: externalHosts.fullName })
      .from(externalHosts)
      .where(isNull(externalHosts.archivedAt))
      .orderBy(asc(externalHosts.fullName)),
  ]);
  return [
    ...internal.map((h) => ({ id: h.id, name: h.name, type: "internal" as const })),
    ...external.map((h) => ({ id: h.id, name: h.name, type: "external" as const })),
  ];
}

const assignSchema = z.object({
  eventId: uuid,
  cityCampaignId: uuid,
  hostType: z.enum(["internal", "external"]),
  hostId: uuid,
});

export async function assignCrawlHost(
  input: z.infer<typeof assignSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid host assignment." };
  const { eventId, cityCampaignId, hostType, hostId } = parsed.data;

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const existing = await tx
        .select({ id: crawlHosts.id, slot: crawlHosts.slot })
        .from(crawlHosts)
        .where(eq(crawlHosts.eventId, eventId))
        .orderBy(asc(crawlHosts.slot));

      // Cap at 2 hosts per crawl.
      if (existing.length >= 2) {
        return { capped: true as const };
      }

      // Don't double-add the same host.
      const dupe = await tx
        .select({ id: crawlHosts.id })
        .from(crawlHosts)
        .where(
          and(
            eq(crawlHosts.eventId, eventId),
            hostType === "internal"
              ? eq(crawlHosts.internalHostId, hostId)
              : eq(crawlHosts.externalHostId, hostId),
          ),
        )
        .limit(1)
        .then((r) => r[0]);
      if (dupe) return { id: dupe.id };

      // Next free slot (1 or 2).
      const usedSlots = new Set(existing.map((e) => e.slot));
      const slot = usedSlots.has(1) ? 2 : 1;

      const [row] = await tx
        .insert(crawlHosts)
        .values({
          eventId,
          hostType,
          internalHostId: hostType === "internal" ? hostId : null,
          externalHostId: hostType === "external" ? hostId : null,
          slot,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: crawlHosts.id });
      return { id: row?.id ?? "" };
    });

    if ("capped" in result) {
      return { ok: false, error: "A crawl can have at most 2 hosts. Remove one first." };
    }
    revalidatePath(`/city-campaigns/${cityCampaignId}`);
    return { ok: true, data: { id: result.id } };
  } catch (err) {
    logger.error({ err, eventId }, "assignCrawlHost failed");
    return { ok: false, error: "Couldn't assign the host." };
  }
}

const removeSchema = z.object({
  crawlHostId: uuid,
  cityCampaignId: uuid,
});

export async function removeCrawlHost(
  input: z.infer<typeof removeSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  try {
    await withAuditContext(staff.id, async (tx) =>
      tx.delete(crawlHosts).where(eq(crawlHosts.id, parsed.data.crawlHostId)),
    );
    revalidatePath(`/city-campaigns/${parsed.data.cityCampaignId}`);
    return { ok: true, data: { id: parsed.data.crawlHostId } };
  } catch (err) {
    logger.error({ err }, "removeCrawlHost failed");
    return { ok: false, error: "Couldn't remove the host." };
  }
}

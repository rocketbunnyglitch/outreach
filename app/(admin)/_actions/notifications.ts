"use server";

/**
 * Notifications API.
 *
 * Public actions (called from the bell dropdown):
 *   • listMyNotifications        — recent + unread count
 *   • markNotificationsRead      — by id list or 'all'
 *
 * Server-only helper:
 *   • emitNotification           — call from any server action to
 *                                  enqueue a notification for a staff
 *                                  member. Quietly drops if disabled.
 */

import { notifications } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------
// list — recent notifications + unread count for the current staff
// ---------------------------------------------------------------
export interface NotificationListing {
  items: NotificationRow[];
  unreadCount: number;
}

export async function listMyNotifications(limit = 25): Promise<NotificationListing> {
  const { staff } = await requireStaff();
  const capped = Math.max(1, Math.min(limit, 100));

  const [items, unreadCountResult] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        linkPath: notifications.linkPath,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        metadata: notifications.metadata,
      })
      .from(notifications)
      .where(eq(notifications.staffId, staff.id))
      .orderBy(desc(notifications.createdAt))
      .limit(capped),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.staffId, staff.id), isNull(notifications.readAt))),
  ]);

  return {
    items: items.map((r) => ({
      id: r.id,
      kind: r.kind as string,
      title: r.title,
      body: r.body,
      linkPath: r.linkPath,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
    })),
    unreadCount: Number(unreadCountResult[0]?.count ?? 0),
  };
}

// ---------------------------------------------------------------
// mark notifications read — explicit ids or 'all'
// ---------------------------------------------------------------
const markReadSchema = z.object({
  ids: z.string().optional(),
  all: z.string().optional(),
});

export async function markNotificationsRead(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ marked: number }>> {
  const { staff } = await requireStaff();

  const parsed = markReadSchema.safeParse({
    ids: formData.get("ids") || undefined,
    all: formData.get("all") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid payload." };

  const idList = parsed.data.ids
    ? parsed.data.ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => uuidPattern.test(s))
    : [];

  const markAll = parsed.data.all === "true";

  if (!markAll && idList.length === 0) {
    return { ok: false, error: "Nothing to mark." };
  }

  try {
    const result = await withAuditContext(staff.id, async (tx) => {
      const whereClause = markAll
        ? and(eq(notifications.staffId, staff.id), isNull(notifications.readAt))
        : and(
            eq(notifications.staffId, staff.id),
            inArray(notifications.id, idList),
            isNull(notifications.readAt),
          );

      return tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(whereClause)
        .returning({ id: notifications.id });
    });

    revalidatePath("/");
    return { ok: true, data: { marked: result.length } };
  } catch (err) {
    logger.error({ err }, "markNotificationsRead failed");
    return { ok: false, error: "Couldn't mark read." };
  }
}

// ---------------------------------------------------------------
// emit — internal helper used by other server actions
// ---------------------------------------------------------------
export async function emitNotification(input: {
  staffId: string;
  kind:
    | "reply"
    | "mention"
    | "email_invalid"
    | "ai_draft_failed"
    | "edit_conflict"
    | "admin_message";
  title: string;
  body?: string | null;
  linkPath?: string | null;
  metadata?: Record<string, unknown>;
  /** Suppress duplicates of the same (kind, staffId, linkPath) within
      the last N minutes. Prevents 'ZeroBounce invalid' spam when the
      same email is re-validated multiple times. Default 30. */
  dedupeMinutes?: number;
}): Promise<{ created: boolean; id: string | null }> {
  if (!uuidPattern.test(input.staffId)) return { created: false, id: null };

  const dedupeWindow = input.dedupeMinutes ?? 30;

  try {
    // Dedupe check
    if (input.linkPath && dedupeWindow > 0) {
      const recent = await db.execute<{ id: string }>(sql`
        SELECT id::text FROM notifications
        WHERE staff_id = ${input.staffId}
          AND kind = ${input.kind}::notification_kind
          AND link_path = ${input.linkPath}
          AND created_at > NOW() - (${dedupeWindow} || ' minutes')::interval
        LIMIT 1
      `);
      const recentList: Array<{ id: string }> = Array.isArray(recent)
        ? (recent as unknown as Array<{ id: string }>)
        : ((recent as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      if (recentList.length > 0) {
        return { created: false, id: recentList[0]?.id ?? null };
      }
    }

    const [row] = await db
      .insert(notifications)
      .values({
        staffId: input.staffId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        linkPath: input.linkPath ?? null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: notifications.id });

    return { created: true, id: row?.id ?? null };
  } catch (err) {
    logger.error({ err, input }, "emitNotification failed");
    return { created: false, id: null };
  }
}

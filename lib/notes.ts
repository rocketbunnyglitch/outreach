/**
 * Notes query helpers.
 *
 * Read-only side. The server actions (create, delete) live colocated
 * with the UI at app/(admin)/_components/notes-actions.ts.
 */

import { notes, staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import type { NoteCreateInput } from "@/lib/validation/notes";
import { and, eq, sql } from "drizzle-orm";

export interface NoteRow {
  id: string;
  body: string;
  mentions: string[];
  authorName: string;
  authorEmail: string;
  isOwnNote: boolean;
  createdAt: Date;
}

/**
 * List active notes for one target. Newest first. Returns 50 max.
 * Soft-deleted notes are excluded.
 */
export async function listNotes(
  targetType: NoteCreateInput["targetType"],
  targetId: string,
  currentStaffId: string,
): Promise<NoteRow[]> {
  const rows = await db
    .select({
      id: notes.id,
      body: notes.body,
      mentions: notes.mentions,
      authorStaffId: notes.authorStaffId,
      authorName: staffMembers.displayName,
      authorEmail: staffMembers.primaryEmail,
      createdAt: notes.createdAt,
    })
    .from(notes)
    .innerJoin(staffMembers, eq(staffMembers.id, notes.authorStaffId))
    .where(and(eq(notes.targetType, targetType), eq(notes.targetId, targetId)))
    .orderBy(sql`${notes.createdAt} DESC`)
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    mentions: r.mentions,
    authorName: r.authorName,
    authorEmail: r.authorEmail,
    isOwnNote: r.authorStaffId === currentStaffId,
    createdAt: r.createdAt,
  }));
}

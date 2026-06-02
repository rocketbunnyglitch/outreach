import "server-only";

/**
 * Internal thread notes + @-mentions.
 *
 * Phase D of the email-system audit. Each thread can have an
 * ordered list of free-text notes that operators write to
 * coordinate. Notes support @-mentions: tag another operator
 * with @display-name (handle), and they get the thread surfaced
 * in their "Mentioned" inbox scope.
 *
 * Mention parsing is server-side from the body string — the
 * client renders the raw text and we extract @tokens that match
 * real teammates on save. This way the source of truth is the
 * note body, not a separate "mentioned-ids" array the client
 * could lie about.
 */

import { emailThreadMentions, emailThreadNotes, staffMembers } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const NOTE_MAX = 2000;
/** Matches @-tags: @firstname, @first.last, @first-last, etc.
 *  Stops at whitespace + most punctuation. Case-insensitive. */
const MENTION_RE = /@([a-z0-9][a-z0-9._-]{1,30})/gi;

export interface ThreadNoteRow {
  id: string;
  body: string;
  authorId: string;
  authorName: string | null;
  createdAt: Date;
  /** Display names of staff who were @-tagged in this note. Used by
   *  the UI to bold their names when rendering. */
  mentionedNames: string[];
}

export async function loadThreadNotes(threadId: string): Promise<ThreadNoteRow[]> {
  const rows = await db
    .select({
      id: emailThreadNotes.id,
      body: emailThreadNotes.body,
      authorId: emailThreadNotes.authorId,
      authorName: staffMembers.displayName,
      createdAt: emailThreadNotes.createdAt,
    })
    .from(emailThreadNotes)
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreadNotes.authorId))
    .where(and(eq(emailThreadNotes.threadId, threadId), isNull(emailThreadNotes.deletedAt)))
    .orderBy(desc(emailThreadNotes.createdAt));

  if (rows.length === 0) return [];

  // Pull mentioned-name lists in a second query (cheap; one row
  // per mention per note). Avoids a more complex aggregate join.
  const noteIds = rows.map((r) => r.id);
  const mentions =
    noteIds.length > 0
      ? await db
          .select({
            noteId: emailThreadMentions.noteId,
            displayName: staffMembers.displayName,
          })
          .from(emailThreadMentions)
          .leftJoin(staffMembers, eq(staffMembers.id, emailThreadMentions.mentionedUserId))
          .where(
            sql`${emailThreadMentions.noteId} IN (${sql.join(
              noteIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
      : [];

  const byNote = new Map<string, string[]>();
  for (const m of mentions) {
    if (!m.displayName) continue;
    const list = byNote.get(m.noteId) ?? [];
    list.push(m.displayName);
    byNote.set(m.noteId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorId: r.authorId,
    authorName: r.authorName,
    createdAt: r.createdAt,
    mentionedNames: byNote.get(r.id) ?? [],
  }));
}

// =========================================================================
// Mention support — for the "Mentioned" inbox scope.
// =========================================================================

export interface MentionedThreadRow {
  threadId: string;
  noteId: string;
  body: string | null;
  authorName: string | null;
  createdAt: Date;
}

/** Returns all unacknowledged mentions for the calling user.
 *  Backs the inbox scope chip + the dashboard alert. */
export async function loadUnacknowledgedMentions(userId: string): Promise<MentionedThreadRow[]> {
  return db
    .select({
      threadId: emailThreadMentions.threadId,
      noteId: emailThreadMentions.noteId,
      body: emailThreadNotes.body,
      authorName: staffMembers.displayName,
      createdAt: emailThreadMentions.createdAt,
    })
    .from(emailThreadMentions)
    .leftJoin(emailThreadNotes, eq(emailThreadNotes.id, emailThreadMentions.noteId))
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreadMentions.authorId))
    .where(
      and(
        eq(emailThreadMentions.mentionedUserId, userId),
        isNull(emailThreadMentions.acknowledgedAt),
      ),
    )
    .orderBy(desc(emailThreadMentions.createdAt));
}

export async function countUnacknowledgedMentions(userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(emailThreadMentions)
    .where(
      and(
        eq(emailThreadMentions.mentionedUserId, userId),
        isNull(emailThreadMentions.acknowledgedAt),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

// =========================================================================
// Actions
// =========================================================================

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Create a note on a thread. Parses @-mentions out of the body
 * server-side and inserts one row per mentioned user in
 * email_thread_mentions.
 *
 * Lookup is by lowercased display name with non-alpha replaced.
 * @manny matches "Manny", "manny ramirez" (first token), etc.
 * Multi-match on a single token: skip (ambiguous — operator can
 * disambiguate with a longer handle).
 */
export async function createThreadNote(input: {
  threadId: string;
  body: string;
}): Promise<ActionResult> {
  const { staff } = await requireStaff();
  const body = input.body.trim().slice(0, NOTE_MAX);
  if (!body) return { ok: false, error: "Note body required." };

  try {
    // Extract candidate mention tokens.
    const tokens = new Set<string>();
    MENTION_RE.lastIndex = 0;
    for (;;) {
      const m = MENTION_RE.exec(body);
      if (m === null) break;
      const tok = m[1];
      if (tok) tokens.add(tok.toLowerCase());
    }

    // Resolve tokens against staff_members on the same team. We
    // match by normalized display name (lowercased, non-alpha
    // stripped) so @manny matches "Manny", @first-last matches
    // "First Last," etc.
    const mentionedUserIds: string[] = [];
    if (tokens.size > 0) {
      const teamStaff = await db
        .select({ id: staffMembers.id, displayName: staffMembers.displayName })
        .from(staffMembers)
        .where(eq(staffMembers.teamId, staff.teamId));

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

      for (const tok of tokens) {
        const normTok = normalize(tok);
        const candidates = teamStaff.filter((s) => {
          const normName = normalize(s.displayName ?? "");
          // Match if the token is a prefix of the staff's name, or
          // equals the first whitespace-separated token of the name.
          if (normName.startsWith(normTok)) return true;
          const firstWord = normalize((s.displayName ?? "").split(/\s+/)[0] ?? "");
          return firstWord === normTok;
        });
        // Only accept unambiguous matches. Multiple matches = skip
        // (operator should refine with a longer handle).
        if (candidates.length === 1) {
          const cand = candidates[0];
          if (cand && cand.id !== staff.id) {
            mentionedUserIds.push(cand.id);
          }
        }
      }
    }

    // Insert the note + materialize mentions in one transaction.
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(emailThreadNotes)
        .values({
          threadId: input.threadId,
          authorId: staff.id,
          body,
        })
        .returning({ id: emailThreadNotes.id });

      const noteId = inserted[0]?.id;
      if (noteId && mentionedUserIds.length > 0) {
        await tx.insert(emailThreadMentions).values(
          mentionedUserIds.map((uid) => ({
            threadId: input.threadId,
            noteId,
            mentionedUserId: uid,
            authorId: staff.id,
          })),
        );
      }
    });

    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "[thread-notes] create failed");
    return { ok: false, error: "Couldn't save note." };
  }
}

export async function deleteThreadNote(input: { noteId: string }): Promise<ActionResult> {
  const { staff } = await requireStaff();
  try {
    // Soft-delete. Only the author can delete their own note (admins
    // can override via a future admin tool; v1 keeps the surface
    // strict — operators don't delete each other's notes).
    const updated = await db
      .update(emailThreadNotes)
      .set({ deletedAt: new Date() })
      .where(and(eq(emailThreadNotes.id, input.noteId), eq(emailThreadNotes.authorId, staff.id)))
      .returning({ id: emailThreadNotes.id });
    if (updated.length === 0) return { ok: false, error: "Note not found." };
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    logger.error({ err, noteId: input.noteId }, "[thread-notes] delete failed");
    return { ok: false, error: "Couldn't delete." };
  }
}

/** Mark every unack mention for this user on this thread as
 *  acknowledged. Fires automatically when the user opens the
 *  thread, OR explicitly via a dismiss button. */
export async function acknowledgeThreadMentions(input: {
  threadId: string;
}): Promise<ActionResult> {
  const { staff } = await requireStaff();
  try {
    await db
      .update(emailThreadMentions)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(emailThreadMentions.threadId, input.threadId),
          eq(emailThreadMentions.mentionedUserId, staff.id),
          isNull(emailThreadMentions.acknowledgedAt),
        ),
      );
    // NOTE: no revalidatePath here. This helper is awaited DURING the
    // render of /inbox/[threadId] (auto-ack on thread open), and
    // revalidatePath during render is unsupported -- it threw on every
    // open, spamming "[thread-notes] ack failed" and never revalidating.
    // The DB write above is what matters; the viewing page already loads
    // a fresh mention count this render, and force-dynamic re-fetches on
    // the next navigation. The client-action wrapper
    // (acknowledgeThreadMentionsAction) can revalidate if a client caller
    // is ever added.
    return { ok: true };
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "[thread-notes] ack failed");
    return { ok: false, error: "Couldn't acknowledge." };
  }
}

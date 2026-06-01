import "server-only";

/**
 * Mentions feed: every unacknowledged @-mention for the current operator,
 * enriched with thread + venue context for the dedicated /inbox/mentions
 * page.
 *
 * The "mentioned" inbox scope chip (backed by countUnacknowledgedMentions in
 * lib/thread-notes.ts) only shows a count. This feed powers a full list view
 * where each unread mention shows the note text, who wrote it, which thread
 * and venue it is on, and links straight to the thread.
 *
 * Unacknowledged = email_thread_mentions.acknowledged_at IS NULL for this
 * mentioned_user_id (same predicate the count + scope chip use).
 */

import {
  emailThreadMentions,
  emailThreadNotes,
  emailThreads,
  staffMembers,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, isNull } from "drizzle-orm";

export interface MentionFeedItem {
  /** The mentioning note's id. One card per note; also the key the
   *  acknowledge action targets. Unique per user (one mention row per
   *  (note, mentioned user)). */
  id: string;
  threadId: string;
  threadSubject: string | null;
  venueName: string | null;
  noteBody: string | null;
  authorName: string | null;
  createdAt: Date;
}

export async function loadMentionsFeed({
  currentUserId,
  limit = 100,
}: {
  currentUserId: string;
  limit?: number;
}): Promise<MentionFeedItem[]> {
  return db
    .select({
      id: emailThreadMentions.noteId,
      threadId: emailThreadMentions.threadId,
      threadSubject: emailThreads.subject,
      venueName: venues.name,
      noteBody: emailThreadNotes.body,
      authorName: staffMembers.displayName,
      createdAt: emailThreadMentions.createdAt,
    })
    .from(emailThreadMentions)
    .leftJoin(emailThreadNotes, eq(emailThreadNotes.id, emailThreadMentions.noteId))
    .leftJoin(emailThreads, eq(emailThreads.id, emailThreadMentions.threadId))
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(staffMembers, eq(staffMembers.id, emailThreadMentions.authorId))
    .where(
      and(
        eq(emailThreadMentions.mentionedUserId, currentUserId),
        isNull(emailThreadMentions.acknowledgedAt),
      ),
    )
    .orderBy(desc(emailThreadMentions.createdAt))
    .limit(limit);
}

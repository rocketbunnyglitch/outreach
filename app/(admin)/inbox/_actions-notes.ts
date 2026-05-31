"use server";

/**
 * Thread-notes server actions (Phase D).
 * Thin wrappers around lib/thread-notes helpers so client
 * components can fire them via useTransition.
 */

import {
  acknowledgeThreadMentions as _ack,
  createThreadNote as _create,
  deleteThreadNote as _delete,
} from "@/lib/thread-notes";

export async function createThreadNoteAction(input: { threadId: string; body: string }) {
  return _create(input);
}

export async function deleteThreadNoteAction(input: { noteId: string }) {
  return _delete(input);
}

export async function acknowledgeThreadMentionsAction(input: { threadId: string }) {
  return _ack(input);
}

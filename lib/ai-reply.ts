import "server-only";

/**
 * AI-assisted reply drafter for the inbox composer.
 *
 * Given a thread id, this loads:
 *   - The thread's subject, classification, and venue context (if any)
 *   - The latest inbound message body (what we're replying to)
 *   - The most recent outbound message (what we previously said,
 *     so the AI doesn't repeat itself or contradict tone)
 * and calls Claude via lib/ai.generateCompletion to produce a draft
 * reply. The operator reviews + edits before sending — we never
 * auto-send.
 *
 * Why this lives separate from lib/ai.draftOutreachEmail:
 *   - draftOutreachEmail composes a FIRST-touch cold email from scratch
 *     using venue + campaign + slot inventory as context. Different
 *     prompt shape, different inputs.
 *   - draftReply continues an ONGOING thread. The most important
 *     input is the inbound message we're answering, not the abstract
 *     campaign context.
 *
 * Cost note: this is gated behind an explicit operator button click.
 * No automatic drafting on thread open — that would burn tokens on
 * every triage glance.
 */

import { cities, emailMessages, emailThreads, venues } from "@/db/schema";
import { generateCompletion } from "@/lib/ai";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";

export type DraftReplyResult =
  | { ok: true; data: { body: string } }
  | {
      ok: false;
      reason: "not_configured" | "thread_not_found" | "no_inbound" | "ai_error";
      message: string;
    };

/**
 * Draft a reply for the given thread.
 *
 * Returns { ok: false, reason: 'no_inbound' } when the thread has
 * no inbound messages — there's nothing for the AI to reply to.
 * The UI gates the AI-draft button on classification anyway, so this
 * is mostly defensive.
 */
export async function draftReply(opts: { threadId: string }): Promise<DraftReplyResult> {
  const { staff } = await requireStaff();

  // Pull thread + venue (if attached). Thread also carries
  // classification, which tells the prompt what tone to take.
  const threadRow = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      classification: emailThreads.classification,
      venueId: emailThreads.venueId,
      venueName: venues.name,
      cityName: cities.name,
    })
    .from(emailThreads)
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(emailThreads.id, opts.threadId))
    .limit(1);

  const thread = threadRow[0];
  if (!thread) {
    return { ok: false, reason: "thread_not_found", message: "Thread not found." };
  }

  // Latest inbound message — the one we're replying to.
  const latestInbound = await db
    .select({
      bodyText: emailMessages.bodyText,
      fromAddress: emailMessages.fromAddress,
      sentAt: emailMessages.sentAt,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, opts.threadId), eq(emailMessages.direction, "inbound")))
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);

  const inbound = latestInbound[0];
  if (!inbound || !inbound.bodyText) {
    return {
      ok: false,
      reason: "no_inbound",
      message: "No inbound message on this thread to reply to.",
    };
  }

  // Latest outbound — useful so the AI knows what was last said and
  // doesn't restate or contradict. May be absent on freshly-replied
  // threads.
  const latestOutbound = await db
    .select({ bodyText: emailMessages.bodyText, sentAt: emailMessages.sentAt })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, opts.threadId), eq(emailMessages.direction, "outbound")))
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);
  const outbound = latestOutbound[0];

  const system = `You are a polished outreach assistant for a bar-crawl events company. You're drafting a REPLY to an inbound email on an existing conversation.

Style rules:
- Match the inbound message's tone (warm if they were warm, professional if they were professional).
- Keep it concise — 3-5 short paragraphs maximum. Operators send a lot of these and reviewers read fast.
- No preamble like "Thanks for getting back to me!" unless the inbound was unusually friendly.
- No closing signature — the operator's email signature is appended after sending.
- Plain prose, no markdown, no bullet lists unless absolutely necessary.
- Address what the inbound actually asked. If they asked a specific question, answer it directly.
- If the inbound expressed interest, propose a concrete next step (call, meeting, sending more info).
- If the inbound asked for someone else / wanted to be passed to a manager, gracefully acknowledge and ask for the right contact.
- Never make up specifics (dates, prices, names) — if you don't have the information, leave a clearly marked placeholder like [confirm time slot] for the operator to fill in.

Output ONLY the reply body. No subject line, no greeting like "Hi [name]" if the inbound didn't use one, no signature.`;

  const classificationLine =
    thread.classification && thread.classification !== "unclassified"
      ? `Inbound classified as: ${thread.classification}`
      : "Inbound classification: not set";

  const venueLine = thread.venueName
    ? `Venue context: ${thread.venueName}${thread.cityName ? ` in ${thread.cityName}` : ""}`
    : "Venue context: none linked";

  const previousReplyBlock = outbound?.bodyText
    ? `\n\nMost recent outbound we sent on this thread (for tone continuity — don't repeat):\n${outbound.bodyText.slice(0, 1500)}`
    : "";

  const prompt = `Thread subject: ${thread.subject ?? "(no subject)"}
${classificationLine}
${venueLine}
Operator drafting this reply: ${staff.displayName ?? staff.primaryEmail ?? "unknown"}

Latest inbound message (what we're replying to):
${inbound.bodyText.slice(0, 4000)}${previousReplyBlock}

Draft the reply now.`;

  const result = await generateCompletion({
    system,
    prompt,
    tag: "inbox_reply_draft",
    maxTokens: 800,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason === "not_configured" ? "not_configured" : "ai_error",
      message: result.message,
    };
  }

  // The model occasionally wraps replies in quotes or adds a brief
  // preamble despite the system instructions. Trim aggressively.
  const cleaned = result.text.trim();
  return { ok: true, data: { body: cleaned } };
}

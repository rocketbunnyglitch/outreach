import "server-only";

/**
 * AI-assisted reply drafter for the inbox composer.
 *
 * Two entry points:
 *   draftReply(opts)        — non-streaming, returns full draft as one
 *                              string. Used by the existing server
 *                              action (draftAiReplyAction).
 *   buildReplyPromptContext — exported so the streaming route handler
 *                              (/api/inbox/ai-draft-stream) shares the
 *                              same prompt + auth + DB loads.
 *
 * Template merge mode:
 *   When opts.templateId is provided, the prompt includes the
 *   template's subject + body as a "starting structure" the model
 *   should adapt + fill in. The template's merge fields ({{venue.name}}
 *   etc.) are LEFT raw in the prompt — the model is asked to fill
 *   them with the venue context (which is in the same prompt) and
 *   to leave [bracketed placeholders] for anything still missing.
 *   This is different from the deterministic renderTemplate path
 *   (used by the compose modal's template picker) — there the
 *   substitution is pure JS and unresolved fields get [??field??]
 *   markers; here the model handles the merge so it can adapt
 *   surrounding sentences to the inbound message.
 */

import { cities, emailMessages, emailTemplates, emailThreads, venues } from "@/db/schema";
import { generateCompletion, isAiConfigured } from "@/lib/ai";
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

export interface ReplyPromptContext {
  /** The system prompt — same for streaming + non-streaming. */
  system: string;
  /** The user prompt body — thread + inbound + optional template. */
  prompt: string;
}

/**
 * Build the AI prompt for the given thread (and optional template).
 *
 * Returns either { ok: true, ctx } or a structured failure so the
 * caller can map it to its own response shape (server action vs.
 * SSE route).
 *
 * Auth: requireStaff is called inside, so unauthenticated callers
 * get the auth error before any DB work happens.
 */
export async function buildReplyPromptContext(opts: {
  threadId: string;
  templateId?: string | null;
}): Promise<
  | { ok: true; ctx: ReplyPromptContext }
  | { ok: false; reason: "not_configured" | "thread_not_found" | "no_inbound"; message: string }
> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "ANTHROPIC_API_KEY is not set on the server.",
    };
  }

  const { staff } = await requireStaff();

  // Pull thread + venue (if attached).
  const threadRow = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      classification: emailThreads.classification,
      venueId: emailThreads.venueId,
      venueName: venues.name,
      cityName: cities.name,
      venuePhone: venues.phoneE164,
      venueEmail: venues.email,
      venueWebsite: venues.websiteUrl,
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

  // Latest inbound message.
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

  // Latest outbound — for tone continuity (so the AI doesn't repeat
  // what we just said). Optional.
  const latestOutbound = await db
    .select({ bodyText: emailMessages.bodyText, sentAt: emailMessages.sentAt })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, opts.threadId), eq(emailMessages.direction, "outbound")))
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);
  const outbound = latestOutbound[0];

  // Optional template lookup. We resolve here (not on the client) so
  // the prompt builder has the canonical template text — the client
  // could send anything otherwise.
  let template: { name: string; subject: string; body: string } | null = null;
  if (opts.templateId) {
    const [row] = await db
      .select({
        name: emailTemplates.name,
        subject: emailTemplates.subjectTemplate,
        body: emailTemplates.bodyTemplateText,
      })
      .from(emailTemplates)
      .where(eq(emailTemplates.id, opts.templateId))
      .limit(1);
    if (row) template = row;
  }

  // System prompt — base rules apply to every draft.
  // When a template is provided, an additional rule asks the model
  // to preserve the template's outline.
  const baseSystem = `You are a polished outreach assistant for a bar-crawl events company. You're drafting a REPLY to an inbound email on an existing conversation.

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

  const templateSystem = template
    ? `

Additionally — the operator picked a TEMPLATE as a starting structure for this reply. Use it as the outline:
- Preserve the template's overall flow + key points
- Adapt sentences as needed to match the inbound message's tone + answer their specific question
- Fill in merge fields like {{venue.name}} using the venue context provided below; if a field can't be resolved from context, replace it with a [bracketed placeholder] the operator can fill in
- Don't keep the template's exact phrasing verbatim if the inbound demands a different angle — the template is a guide, not a script`
    : "";

  const system = `${baseSystem}${templateSystem}`;

  const classificationLine =
    thread.classification && thread.classification !== "unclassified"
      ? `Inbound classified as: ${thread.classification}`
      : "Inbound classification: not set";

  const venueLine = thread.venueName
    ? `Venue context: ${thread.venueName}${thread.cityName ? ` in ${thread.cityName}` : ""}${thread.venuePhone ? ` · phone ${thread.venuePhone}` : ""}${thread.venueEmail ? ` · email ${thread.venueEmail}` : ""}${thread.venueWebsite ? ` · website ${thread.venueWebsite}` : ""}`
    : "Venue context: none linked";

  const previousReplyBlock = outbound?.bodyText
    ? `\n\nMost recent outbound we sent on this thread (for tone continuity — don't repeat):\n${outbound.bodyText.slice(0, 1500)}`
    : "";

  const templateBlock = template
    ? `\n\n--- TEMPLATE OUTLINE (${template.name}) ---\nSubject template: ${template.subject}\n\nBody template:\n${template.body}\n--- END TEMPLATE ---`
    : "";

  const prompt = `Thread subject: ${thread.subject ?? "(no subject)"}
${classificationLine}
${venueLine}
Operator drafting this reply: ${staff.displayName ?? staff.primaryEmail ?? "unknown"}

Latest inbound message (what we're replying to):
${inbound.bodyText.slice(0, 4000)}${previousReplyBlock}${templateBlock}

Draft the reply now.`;

  return { ok: true, ctx: { system, prompt } };
}

/**
 * Non-streaming draft — calls generateCompletion and returns the
 * full string. Used by the server action path; the streaming route
 * uses buildReplyPromptContext directly + the SDK's messages.stream.
 */
export async function draftReply(opts: {
  threadId: string;
  templateId?: string | null;
}): Promise<DraftReplyResult> {
  const built = await buildReplyPromptContext(opts);
  if (!built.ok) {
    return { ok: false, reason: built.reason, message: built.message };
  }

  const result = await generateCompletion({
    system: built.ctx.system,
    prompt: built.ctx.prompt,
    tag: "inbox_reply_draft",
    maxTokens: 1000,
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason === "not_configured" ? "not_configured" : "ai_error",
      message: result.message,
    };
  }
  return { ok: true, data: { body: result.text.trim() } };
}

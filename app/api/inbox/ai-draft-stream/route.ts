/**
 * POST /api/inbox/ai-draft-stream
 *
 * Body: { threadId: string, templateId?: string | null }
 *
 * Streams an AI-generated reply draft as Server-Sent Events. Each
 * text delta arrives as a `data: {"text":"..."}` line; the stream
 * ends with `data: {"done":true}`. Errors land as `data: {"error":"..."}`.
 *
 * Why SSE and not plain Response streaming:
 *   - SSE has built-in framing — we don't have to invent a delimiter
 *   - EventSource is widely supported, but here we use fetch +
 *     ReadableStream on the client (the request is POST, not GET,
 *     so EventSource doesn't apply); the `data: ` prefix is still
 *     the cleanest framing for line-buffered parsing.
 *   - The client can incrementally append text to the textarea
 *     without waiting for the full draft.
 *
 * Auth: buildReplyPromptContext calls requireStaff() so the route
 * is gated through the same path as the non-streaming action.
 */

import { streamCompletion } from "@/lib/ai";
import { buildReplyPromptContext } from "@/lib/ai-reply";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Body {
  threadId?: string;
  templateId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.threadId || !UUID_RE.test(body.threadId)) {
    return NextResponse.json({ error: "Invalid threadId" }, { status: 400 });
  }
  if (body.templateId && !UUID_RE.test(body.templateId)) {
    return NextResponse.json({ error: "Invalid templateId" }, { status: 400 });
  }

  const built = await buildReplyPromptContext({
    threadId: body.threadId,
    templateId: body.templateId ?? null,
  });
  if (!built.ok) {
    // Same status-code mapping as the non-streaming action would
    // surface, so the client treats both endpoints' errors uniformly.
    const status = built.reason === "not_configured" ? 503 : 400;
    return NextResponse.json({ error: built.message, reason: built.reason }, { status });
  }

  // Set up the SSE stream. We use a TransformStream so we can write
  // chunks from an async loop without holding the route handler.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamCompletion({
          system: built.ctx.system,
          prompt: built.ctx.prompt,
          tag: "inbox_reply_draft_stream",
          maxTokens: 1000,
        })) {
          if (chunk.kind === "text") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`));
          } else if (chunk.kind === "error") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: chunk.message })}\n\n`),
            );
            break;
          } else if (chunk.kind === "done") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          }
        }
      } catch (err) {
        logger.error({ err }, "ai-draft-stream route handler errored");
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "AI stream failed" })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Tell intermediate proxies not to buffer.
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

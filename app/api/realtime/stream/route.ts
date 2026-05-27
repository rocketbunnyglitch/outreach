/**
 * GET /api/realtime/stream?channel=<channel>
 *
 * Server-Sent Events endpoint. Subscribes to the requested Redis channel
 * and forwards messages to the browser. Used by the useRealtimeChannel
 * client hook in the data-table package.
 *
 * Why SSE and not WebSocket?
 *   - One-way is enough for v1 (server pushes change events; clients
 *     mutate via existing server actions over HTTPS, not over the socket)
 *   - Auto-reconnect built into EventSource at no cost
 *   - Works through corporate proxies that block WebSockets
 *   - Plays nice with HTTP/2 multiplexing in Caddy
 *
 * Auth:
 *   Requires an authenticated staff session. Without it, returns 401 and
 *   the EventSource will throw an error event (handled client-side).
 *
 * Allowed channels:
 *   The query param must start with "realtime:" to prevent subscribers
 *   from listening to arbitrary internal Redis channels (BullMQ, session
 *   pubsub, etc).
 *
 * Heartbeat:
 *   Every 25s we send a ":heartbeat\n\n" comment so the connection stays
 *   alive through Caddy's default 60s upstream timeout. EventSource
 *   ignores comment lines, so the browser sees nothing.
 *
 * Connection lifecycle:
 *   1. Client opens EventSource
 *   2. Server authenticates and spins up a Redis subscriber
 *   3. Messages stream as `event: realtime\ndata: <json>\n\n`
 *   4. On close (tab navigated, network drop), AbortSignal fires,
 *      subscriber is cleaned up
 */

import { getCurrentStaff } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { subscribeRealtime } from "@/lib/realtime-publish";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 25_000;

export async function GET(req: Request) {
  // -----------------------------------------------------------------
  // Auth — getCurrentStaff (not requireStaff) so we return 401 instead
  // of redirecting. EventSource handles 401 by closing + emitting error.
  // -----------------------------------------------------------------
  const ctx = await getCurrentStaff();
  if (!ctx) {
    return new Response("Unauthorized", { status: 401 });
  }

  // -----------------------------------------------------------------
  // Validate channel param
  // -----------------------------------------------------------------
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");
  if (!channel) {
    return new Response("Missing ?channel=", { status: 400 });
  }
  if (!channel.startsWith("realtime:")) {
    return new Response("Channel must start with 'realtime:'", { status: 400 });
  }

  // -----------------------------------------------------------------
  // SSE stream setup
  // -----------------------------------------------------------------
  const encoder = new TextEncoder();
  let unsubscribe: (() => Promise<void>) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function safeEnqueue(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller closed by client; swallow
        }
      }

      // Initial connection confirmation
      safeEnqueue(`event: open\ndata: {"channel":"${channel}"}\n\n`);

      // Heartbeat to keep proxies from idling the connection out
      heartbeat = setInterval(() => {
        safeEnqueue(`:heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_INTERVAL_MS);

      // Subscribe to Redis. The message handler enqueues a `realtime`
      // SSE event for every published payload.
      try {
        unsubscribe = await subscribeRealtime(channel, (event) => {
          safeEnqueue(`event: realtime\ndata: ${JSON.stringify(event)}\n\n`);
        });
      } catch (err) {
        logger.warn({ err, channel }, "realtime stream: subscribe failed");
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ message: "subscribe failed" })}\n\n`);
        controller.close();
        return;
      }
    },

    async cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) await unsubscribe();
    },
  });

  // -----------------------------------------------------------------
  // Tied to AbortSignal so disconnects trigger cleanup
  // -----------------------------------------------------------------
  req.signal.addEventListener("abort", () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) void unsubscribe();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      // Tell nginx/caddy not to buffer the stream
      "X-Accel-Buffering": "no",
    },
  });
}

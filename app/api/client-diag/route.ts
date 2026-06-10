import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

/**
 * Pre-React diagnostic beacon sink (lib/client-diag.ts posts here on chunk
 * errors / hydration crashes / no-hydrate watchdog / early window.onerror).
 *
 * History: this was downgraded to a body-discarding 204 no-op over log-
 * injection concerns -- which silently removed ALL client-side #418/chunk
 * telemetry (the 2026-06-10 QA pass found hydration regressions had become
 * undiagnosable in prod). Restored with sanitization instead of a blanket
 * drop:
 *   - hard size cap on the request body, fields allowlisted by name
 *   - every value is control-character-stripped and length-capped; nested
 *     values (mutLog, extra, attr lists) are JSON-stringified first
 *   - logged through pino (structured JSON -- values are escaped, so a
 *     crafted message cannot fabricate or split log lines)
 * Still returns 204 unconditionally so the dying page's beacon never
 * retries or errors.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_000;
const REASON_RE = /^[a-z0-9_.: -]{1,48}$/i;

function sanitize(v: unknown, max: number): string | null {
  if (v == null) return null;
  let s: string;
  if (typeof v === "string") s = v;
  else {
    try {
      s = JSON.stringify(v) ?? "";
    } catch {
      return null;
    }
  }
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) out += ch;
    if (out.length >= max) break;
  }
  out = out.trim();
  return out.length > 0 ? out : null;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const raw = await req.text();
    if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return new NextResponse(null, { status: 204 });
    }
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!REASON_RE.test(reason)) {
      return new NextResponse(null, { status: 204 });
    }
    logger.warn(
      {
        clientDiag: {
          reason,
          href: sanitize(body.href, 300),
          ref: sanitize(body.ref, 300),
          ua: sanitize(body.ua, 300),
          readyState: sanitize(body.readyState, 16),
          ts: sanitize(body.ts, 40),
          hydrated: body.hydrated === true,
          online: body.online !== false,
          bodyChildCount: typeof body.bodyChildCount === "number" ? body.bodyChildCount : null,
          textLen: typeof body.textLen === "number" ? body.textLen : null,
          htmlAttrs: sanitize(body.htmlAttrs, 400),
          bodyAttrs: sanitize(body.bodyAttrs, 400),
          mutLog: sanitize(body.mutLog, 2400),
          extra: sanitize(body.extra, 4000),
          snapErr: sanitize(body.snapErr, 200),
        },
      },
      "client-diag beacon",
    );
  } catch {
    // Malformed body -- drop silently; never 4xx (the beacon fires during
    // page-death, nothing can handle an error response).
  }
  return new NextResponse(null, { status: 204 });
}

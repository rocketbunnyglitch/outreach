import "server-only";

/**
 * Quo phone-system client.
 *
 * Quo is the operator's outbound phone line provider for cold-outreach
 * calls + SMS. Each outreach_brand has a quo_line_e164 (the "from"
 * number that's shown to recipients); per-staff override lives on
 * staff_members.quo_line_e164_override so individual reps can dial from
 * their own line when appropriate.
 *
 * REST API shape — matches OpenPhone's pattern, which Quo's API is
 * compatible with (Quo runs on top of OpenPhone infrastructure):
 *
 *   Auth:      Authorization: <API_KEY>     (no Bearer prefix)
 *   Base URL:  https://api.openphone.com/v1 (overridable via env)
 *   Encoding:  application/json
 *
 * Activation:
 *   QUO_API_KEY=...
 *   QUO_API_BASE_URL=https://api.openphone.com/v1   (optional)
 *   QUO_WEBHOOK_SIGNING_SECRET=...                  (for webhook verify)
 *
 * Without QUO_API_KEY, every function returns null/false so the UI
 * surfaces a graceful "Quo not configured" state instead of erroring.
 */

import { logger } from "@/lib/logger";

const DEFAULT_BASE_URL = "https://api.openphone.com/v1";

export function isQuoConfigured(): boolean {
  return !!process.env.QUO_API_KEY;
}

function baseUrl(): string {
  return process.env.QUO_API_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL;
}

function quoHeaders(): HeadersInit {
  return {
    Authorization: process.env.QUO_API_KEY ?? "",
    "Content-Type": "application/json",
  };
}

export interface QuoPhoneNumber {
  id: string;
  e164: string;
  name: string | null;
}

export interface QuoMessageResult {
  id: string;
  status: string;
  to: string[];
  from: string;
}

export interface QuoCall {
  id: string;
  direction: "incoming" | "outgoing";
  status: string;
  /** Total duration in seconds for completed calls; null otherwise. */
  durationSeconds: number | null;
  to: string;
  from: string;
  createdAt: string;
}

/**
 * List the Quo phone numbers attached to the configured account.
 * Used by /settings/inboxes to populate brand's quo_line dropdown.
 */
export async function listQuoPhoneNumbers(): Promise<QuoPhoneNumber[]> {
  if (!isQuoConfigured()) return [];

  try {
    const response = await fetch(`${baseUrl()}/phone-numbers`, {
      method: "GET",
      headers: quoHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "quo list phone-numbers non-200");
      return [];
    }
    const json = (await response.json()) as {
      data?: Array<{ id: string; phoneNumber?: string; name?: string }>;
    };
    return (json.data ?? []).map((p) => ({
      id: p.id,
      e164: p.phoneNumber ?? "",
      name: p.name ?? null,
    }));
  } catch (err) {
    logger.warn({ err }, "quo list phone-numbers failed");
    return [];
  }
}

/**
 * Send an SMS via Quo. Returns the message id on success, null on
 * failure or when Quo isn't configured.
 *
 * `from` must be a Quo number id (NOT the E.164) — Quo's API keys
 * phone numbers internally by id. Resolve the id once when the brand
 * is set up, store it on outreach_brands.quo_phone_number_id.
 */
export async function sendQuoSms(opts: {
  fromPhoneNumberId: string;
  toE164: string;
  body: string;
}): Promise<QuoMessageResult | null> {
  if (!isQuoConfigured()) return null;

  try {
    const response = await fetch(`${baseUrl()}/messages`, {
      method: "POST",
      headers: quoHeaders(),
      body: JSON.stringify({
        content: opts.body,
        from: opts.fromPhoneNumberId,
        to: [opts.toE164],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logger.warn({ status: response.status, errBody }, "quo sms send non-200");
      return null;
    }
    const json = (await response.json()) as {
      data?: { id?: string; status?: string; to?: string[]; from?: string };
    };
    const d = json.data;
    if (!d?.id) return null;
    return {
      id: d.id,
      status: d.status ?? "queued",
      to: d.to ?? [opts.toE164],
      from: d.from ?? opts.fromPhoneNumberId,
    };
  } catch (err) {
    logger.warn({ err }, "quo sms send failed");
    return null;
  }
}

/**
 * Fetch a call by id. Used by the webhook handler when a call ends —
 * we get a partial payload via webhook, then re-fetch the full record
 * to capture final duration + status.
 */
export async function fetchQuoCall(callId: string): Promise<QuoCall | null> {
  if (!isQuoConfigured()) return null;

  try {
    const response = await fetch(`${baseUrl()}/calls/${encodeURIComponent(callId)}`, {
      method: "GET",
      headers: quoHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: {
        id: string;
        direction?: "incoming" | "outgoing";
        status?: string;
        duration?: number;
        to?: string;
        from?: string;
        createdAt?: string;
      };
    };
    const d = json.data;
    if (!d?.id) return null;
    return {
      id: d.id,
      direction: d.direction ?? "outgoing",
      status: d.status ?? "unknown",
      durationSeconds: d.duration ?? null,
      to: d.to ?? "",
      from: d.from ?? "",
      createdAt: d.createdAt ?? new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ err, callId }, "quo call fetch failed");
    return null;
  }
}

/**
 * Verify a Quo webhook signature. Quo signs the request body with the
 * webhook secret using HMAC-SHA256, base64-encoded, in the
 * `x-openphone-signature` header (format: `hmac;v1;<timestamp>;<sig>`).
 *
 * Returns true when the signature is valid AND the timestamp is within
 * the last 5 minutes (anti-replay).
 *
 * Without QUO_WEBHOOK_SIGNING_SECRET set, returns false so unverified
 * payloads are dropped — fail closed.
 */
export async function verifyQuoWebhookSignature(opts: {
  signatureHeader: string | null;
  rawBody: string;
}): Promise<boolean> {
  const secret = process.env.QUO_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    logger.warn("quo webhook called but signing secret not configured");
    return false;
  }
  if (!opts.signatureHeader) return false;

  // Format: hmac;v1;<timestamp>;<signature>
  const parts = opts.signatureHeader.split(";");
  if (parts.length !== 4 || parts[0] !== "hmac" || parts[1] !== "v1") return false;
  const [, , timestamp, providedSig] = parts;
  if (!timestamp || !providedSig) return false;

  // Anti-replay: reject if more than 5 minutes old
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    logger.warn({ ts }, "quo webhook timestamp out of window");
    return false;
  }

  // Compute expected = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) → base64
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestamp}.${opts.rawBody}`),
  );
  const expected = Buffer.from(new Uint8Array(signature)).toString("base64");

  // Constant-time comparison
  if (expected.length !== providedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ providedSig.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Map a Quo call status string to our outreach_outcome enum so the
 * webhook handler can log results consistently.
 */
export function mapQuoCallStatusToOutcome(
  status: string,
  durationSeconds: number | null,
): "voicemail" | "no_answer" | "callback_requested" | "sent" {
  const s = status.toLowerCase();
  // Connected and lasted > 30s → meaningful conversation
  if (s === "completed" && (durationSeconds ?? 0) > 30) return "sent";
  if (s === "voicemail" || s === "answered_by_voicemail") return "voicemail";
  if (s === "no_answer" || s === "missed" || s === "unanswered") return "no_answer";
  // Default: assume answered briefly → treat as no_answer (operator can
  // update the outreach_log entry manually if needed)
  return "no_answer";
}

/**
 * Viber deep-link helpers.
 *
 * Viber doesn't expose a REST API for SMB / personal use — the 2-3
 * outreach staff use the actual Viber app (shared account) to reach
 * venues in countries Quo doesn't service well. Our job is to:
 *
 *   1. Open the right Viber screen with one tap from the cold-
 *      outreach row (deep-link)
 *   2. Log the touch to outreach_log with channel='viber' so the
 *      attempt counts in per-staff analytics
 *
 * The deep links work cross-platform — iOS, Android, and Viber
 * Desktop all register the viber:// scheme.
 */

export interface ViberLinkOpts {
  /** E.164 number including the leading '+'. */
  phoneE164: string;
}

/**
 * Build a deep link that opens the Viber chat with a specific number.
 * Returns null if the number isn't a recognizable E.164 — the UI then
 * falls back to a manual-copy state.
 *
 * Format: `viber://chat?number=PHONE` (no '+' in the query — Viber
 * accepts both but the no-plus form is more reliable on Android).
 */
export function buildViberChatLink(opts: ViberLinkOpts): string | null {
  const cleaned = normalizeForViber(opts.phoneE164);
  if (!cleaned) return null;
  return `viber://chat?number=${cleaned}`;
}

/**
 * Build a deep link that initiates a Viber call to a specific number.
 * Uses the dialer/contact action; the receiving Viber client decides
 * whether to ring as audio or video based on the user's prior choice.
 *
 * Format: `viber://contact?number=PHONE`
 */
export function buildViberCallLink(opts: ViberLinkOpts): string | null {
  const cleaned = normalizeForViber(opts.phoneE164);
  if (!cleaned) return null;
  return `viber://contact?number=${cleaned}`;
}

/**
 * Strip the leading '+' and any non-digits from an E.164 number. Viber
 * deep links want the raw digit string after the country code.
 *
 * Returns null for empty/invalid input so the UI can show a disabled
 * state rather than open a broken link.
 */
function normalizeForViber(phoneE164: string): string | null {
  if (!phoneE164) return null;
  const digits = phoneE164.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

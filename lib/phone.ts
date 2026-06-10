/**
 * Phone normalization -- pure + client-safe (no db, no server-only). Lets staff
 * paste a number in ANY format (Google national "(416) 555-1234", dashed,
 * spaced, with or without a country code) and get clean E.164 without being
 * nagged about the format.
 *
 * Bare numbers default to North America: a 10-digit number becomes +1XXXXXXXXXX.
 * Numbers that already start with "+" are kept as their international form. For
 * other lengths we keep the digits behind a "+" (best effort) -- the venue form
 * normalizes on blur and the server re-normalizes on save, so the operator
 * never has to format anything by hand.
 */

/** Normalize a phone string to E.164 ("+" + digits). Returns "" when empty. */
export function toE164(raw: string | null | undefined, defaultCountryCode = "1"): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (hasPlus) return `+${digits}`;
  // No leading "+": infer. NANP 10-digit -> +1; 11-digit starting with 1 -> +1.
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Otherwise assume the digits already carry a country code.
  return `+${digits}`;
}

/** True when s is a valid E.164 number (+ then 10-15 digits, first 1-9). */
export function isE164(s: string): boolean {
  return /^\+[1-9]\d{9,14}$/.test(s);
}

/**
 * Shared route allowlist for MACHINE endpoints (2026-06-11 security
 * audit): routes that must be reachable WITHOUT a staff browser
 * session because their callers are machines, and each one enforces
 * its own credential at the route layer:
 *
 *   /api/cron/*        X-Cron-Secret (env CRON_SECRET)
 *   /api/engine/*      X-Engine-Api-Key (env ENGINE_API_KEY, fails closed)
 *   /api/webhooks/*    provider signature (e.g. Quo/OpenPhone HMAC)
 *   /api/sms/inbound   Twilio signature (fails closed when unconfigured)
 *   /api/track/*       per-message tracking token (garbage token = no-op gif)
 *
 * Used by BOTH auth.config.ts authorized() and middleware.ts so the
 * two layers can never drift apart again (the drift bounced Quo
 * webhooks and open-pixel hits to /login with a 307 — discovered by
 * probing the live domain unauthenticated).
 *
 * Edge-safe: pure string checks, no imports.
 */
export function isMachineRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/engine") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/sms/inbound") ||
    pathname.startsWith("/api/track/")
  );
}

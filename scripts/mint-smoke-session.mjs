/**
 * Mint a short-lived NextAuth (Auth.js v5) session JWT so the deploy smoke
 * test can exercise AUTHENTICATED server renders. Login is Google OAuth, so
 * a headless browser login would be flaky; encoding a session token with the
 * server's own NEXTAUTH_SECRET is deterministic and uses zero external deps
 * (the app's node_modules provide @auth/core).
 *
 * The app's jwt callback (auth.ts) treats `staffId` as the identity and
 * backfills role/teamId from the users table on each request, so a minimal
 * { sub, staffId } payload for a REAL users row is a fully valid session.
 *
 * Usage:
 *   node --env-file=/var/www/outreach/.env scripts/mint-smoke-session.mjs \
 *     --staff-id <uuid>
 * Prints the raw JWE token (cookie value for __Secure-authjs.session-token)
 * to stdout. Exits non-zero on any problem; the smoke test treats that as
 * "skip authed checks", never as a deploy failure.
 */

const args = process.argv.slice(2);
const idx = args.indexOf("--staff-id");
const staffId = idx >= 0 ? args[idx + 1] : null;
if (!staffId) {
  console.error("usage: mint-smoke-session.mjs --staff-id <uuid>");
  process.exit(1);
}
const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
if (!secret) {
  console.error("NEXTAUTH_SECRET not in env (run with --env-file)");
  process.exit(1);
}

// The decode salt is the cookie name the server reads the token from.
const COOKIE_NAME = "__Secure-authjs.session-token";

let encode;
try {
  ({ encode } = await import("@auth/core/jwt"));
} catch {
  // Fallback for layouts where @auth/core is nested under next-auth.
  ({ encode } = await import("next-auth/jwt"));
}

const token = await encode({
  token: {
    sub: staffId,
    staffId,
    name: "Deploy Smoke",
    email: "smoke@deploy.local",
  },
  secret,
  salt: COOKIE_NAME,
  maxAge: 15 * 60, // 15 minutes -- long enough for one smoke run
});

process.stdout.write(token);

/**
 * scripts/bootstrap-admin.ts
 *
 * One-time bootstrap: creates the first admin user with an emailed
 * password. Use this immediately after running migrations 0040-0044
 * on a fresh database (the rename TRUNCATE'd all users).
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=<longpass> \
 *     ADMIN_NAME="Your Name" \
 *     pnpm tsx scripts/bootstrap-admin.ts
 *
 * Safety:
 *   - Aborts if the users table already has rows (so it can't
 *     accidentally clobber a real admin)
 *   - Aborts if ADMIN_PASSWORD is shorter than the MIN_PASSWORD_LENGTH
 *     from lib/passwords
 *   - Defaults to role=admin, status=active, the seeded BarCrawlConnect
 *     team
 *   - Stores ONLY the bcrypt hash of the password. The raw value is
 *     never logged or persisted.
 *
 * After this seeds, the operator signs in at /login and uses /admin/users
 * (commit 5) to invite the rest of the team via magic-link or set-now.
 */

import "dotenv/config";
import { teams, users } from "@/db/schema";
import { DEFAULT_TEAM_ID } from "@/db/schema/teams";
import { db } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/passwords";
import { eq, sql } from "drizzle-orm";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = (process.env.ADMIN_NAME ?? "").trim() || email.split("@")[0] || "Admin";

  if (!email) {
    console.error("ADMIN_EMAIL is required.");
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`ADMIN_EMAIL doesn't look like a real email: ${email}`);
    process.exit(1);
  }
  const validation = validatePassword(password);
  if (!validation.ok) {
    console.error(`ADMIN_PASSWORD invalid: ${validation.error}`);
    process.exit(1);
  }

  // Safety gate: refuse if any users already exist.
  const counts = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM users`,
  );
  const total = Number.parseInt(counts.rows[0]?.count ?? "0", 10);
  if (total > 0) {
    console.error(
      `Refusing to bootstrap: users table has ${total} rows. Use /admin/users (after logging in as an existing admin) to add more.`,
    );
    process.exit(2);
  }

  // Ensure the default team exists. The migration 0040 should have
  // seeded it, but double-check so the bootstrap is safe to run on a
  // partially-migrated DB.
  const teamRows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, DEFAULT_TEAM_ID))
    .limit(1);
  if (!teamRows[0]) {
    console.error(
      `Default team ${DEFAULT_TEAM_ID} not found. Run migration 0040 before bootstrapping.`,
    );
    process.exit(3);
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(users)
    .values({
      displayName: name,
      primaryEmail: email,
      role: "admin",
      status: "active",
      teamId: DEFAULT_TEAM_ID,
      passwordHash,
      passwordSetAt: new Date(),
      passwordMustChange: false,
      timezone: "America/Toronto",
    })
    .returning({ id: users.id });

  const u = inserted[0];
  if (!u) {
    console.error("Insert succeeded but returning was empty — unexpected.");
    process.exit(4);
  }
  // biome-ignore lint/suspicious/noConsoleLog: CLI script output is the deliverable
  console.log(`Bootstrapped admin user ${email} (id=${u.id}). Sign in at /login.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(99);
});

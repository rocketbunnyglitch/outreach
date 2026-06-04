/**
 * One-shot: create the "Gela" graphics-designer user + assign her the
 * graphics_designer engine role. Idempotent (safe to re-run). Temporary creds
 * per operator instruction; the admin will change the email/password later.
 *
 * Run on the box with the prod env:
 *   DATABASE_URL=... npx tsx scripts/create-gela.ts
 *
 * Uses raw pg + bcryptjs (no server-only imports) so tsx can run it directly.
 */

import { hash } from "bcryptjs";
import { Pool } from "pg";

const TEAM_ID = "00000000-0000-0000-0000-000000000001";
const EMAIL = "gela@events-perse.com";
const NAME = "Gela";
// Temporary; admin will reset. password_must_change is set so a first login is
// forced to rotate it.
const TEMP_PW = "ChangeMe-Gela-2026!";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE primary_email = $1",
      [EMAIL],
    );
    let userId: string;
    const found = existing.rows[0];
    if (found) {
      userId = found.id;
      console.log(`[gela] user already exists: ${userId}`);
    } else {
      const pwHash = await hash(TEMP_PW, 10);
      const r = await pool.query<{ id: string }>(
        `INSERT INTO users
           (display_name, primary_email, role, status, team_id,
            password_hash, password_set_at, password_must_change, timezone, title)
         VALUES ($1, $2, 'outreach', 'active', $3, $4, now(), true, 'Asia/Manila', 'Graphics & Web')
         RETURNING id`,
        [NAME, EMAIL, TEAM_ID, pwHash],
      );
      userId = r.rows[0]?.id ?? "";
      console.log(`[gela] created user ${userId} (${EMAIL}); temp password: ${TEMP_PW}`);
    }

    await pool.query(
      `INSERT INTO engine_role_assignments (team_id, role_key, user_id, updated_by, updated_at)
       VALUES ($1, 'graphics_designer', $2, $2, now())
       ON CONFLICT (team_id, role_key)
       DO UPDATE SET user_id = EXCLUDED.user_id, updated_by = EXCLUDED.user_id, updated_at = now()`,
      [TEAM_ID, userId],
    );
    console.log(`[gela] assigned graphics_designer -> ${userId}`);

    const check = await pool.query(
      `SELECT u.display_name, u.primary_email, u.role, era.role_key
       FROM users u
       JOIN engine_role_assignments era ON era.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    console.log("[gela] verify:", JSON.stringify(check.rows));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

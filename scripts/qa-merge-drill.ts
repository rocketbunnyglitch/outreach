/**
 * P302 audit drill: live venue-merge exercise on synthetic rows.
 *
 * Creates two throwaway venues, gives the source contact fields the
 * survivor lacks, plants a clean-repoint row (venue_domain_aliases) and a
 * guaranteed unique-collision pair (cold_outreach_entries on the same
 * city campaign), runs mergeVenues, asserts every contract, then tears
 * the synthetic rows down completely.
 *
 * Run: npx tsx scripts/qa-merge-drill.ts
 */
import { db } from "@/lib/db";
import { mergeVenues } from "@/lib/venue-merge";
import { sql } from "drizzle-orm";

function rows<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

const checks: Array<[string, boolean, string?]> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push([name, ok, detail]);
  console.info(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const admin = rows<{ id: string }>(
    await db.execute(sql`SELECT id FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1`),
  )[0];
  const cc = rows<{ id: string; city_id: string }>(
    await db.execute(sql`SELECT id, city_id FROM city_campaigns ORDER BY created_at ASC LIMIT 1`),
  )[0];
  if (!admin || !cc) throw new Error("need an admin staffer and a city campaign");

  // --- setup -------------------------------------------------------------
  const made = rows<{ id: string; name: string }>(
    await db.execute(sql`
      INSERT INTO venues (city_id, name, email, phone_e164, google_place_id, internal_notes, created_by, updated_by)
      VALUES
        (${cc.city_id}::uuid, '[QA-MERGE-DRILL] Source', 'qa-merge-src@example.invalid', '+14165550111', 'qa-merge-drill-place', 'QA merge drill source note', ${admin.id}::uuid, ${admin.id}::uuid),
        (${cc.city_id}::uuid, '[QA-MERGE-DRILL] Survivor', NULL, NULL, NULL, '', ${admin.id}::uuid, ${admin.id}::uuid)
      RETURNING id, name
    `),
  );
  const src = made.find((m) => m.name.includes("Source"));
  const dst = made.find((m) => m.name.includes("Survivor"));
  if (!src || !dst) throw new Error("venue setup failed");
  console.info(`source=${src.id}  survivor=${dst.id}  cc=${cc.id}`);

  // Clean-repoint row: alias only on the source.
  await db.execute(sql`
    INSERT INTO venue_domain_aliases (venue_id, domain) VALUES (${src.id}::uuid, 'qa-merge-drill.invalid')
  `);
  // Collision pair: both venues on the SAME city campaign.
  await db.execute(sql`
    INSERT INTO cold_outreach_entries (city_campaign_id, venue_id) VALUES
      (${cc.id}::uuid, ${src.id}::uuid),
      (${cc.id}::uuid, ${dst.id}::uuid)
  `);

  // --- exercise ------------------------------------------------------------
  const result = await mergeVenues({
    sourceId: src.id,
    destId: dst.id,
    byStaffId: admin.id,
    reason: "P302 audit drill",
  });
  console.info("merge result:", JSON.stringify(result));

  // --- assert ------------------------------------------------------------
  check("merge returned ok", result.ok, result.error);
  check(
    "alias repointed (clean path)",
    result.repointed["venue_domain_aliases.venue_id"] === 1,
    JSON.stringify(result.repointed),
  );
  check(
    "collision left residual on source (savepoint path)",
    result.residual["cold_outreach_entries.venue_id"] === 1,
    JSON.stringify(result.residual),
  );

  const after = rows<{
    id: string;
    email: string | null;
    phone_e164: string | null;
    google_place_id: string | null;
    internal_notes: string;
    archived_at: string | null;
    merged_into_venue_id: string | null;
  }>(
    await db.execute(sql`
      SELECT id, email, phone_e164, google_place_id, internal_notes, archived_at, merged_into_venue_id
      FROM venues WHERE id IN (${src.id}::uuid, ${dst.id}::uuid)
    `),
  );
  const s2 = after.find((r) => r.id === src.id);
  const d2 = after.find((r) => r.id === dst.id);
  check("survivor inherited email", d2?.email === "qa-merge-src@example.invalid");
  check("survivor inherited phone", d2?.phone_e164 === "+14165550111");
  check(
    "survivor claimed google_place_id (moved, not copied)",
    d2?.google_place_id === "qa-merge-drill-place",
  );
  check("source released google_place_id", s2?.google_place_id === null);
  check(
    "survivor notes carry merge marker",
    (d2?.internal_notes ?? "").includes("[merged from duplicate]"),
  );
  check("source archived", s2?.archived_at !== null);
  check("source chained to survivor", s2?.merged_into_venue_id === dst.id);

  const alias = rows<{ venue_id: string }>(
    await db.execute(
      sql`SELECT venue_id FROM venue_domain_aliases WHERE domain = 'qa-merge-drill.invalid'`,
    ),
  )[0];
  check("alias row now points at survivor", alias?.venue_id === dst.id);

  const coe = rows<{ venue_id: string; n: string }>(
    await db.execute(sql`
      SELECT venue_id, count(*)::text AS n FROM cold_outreach_entries
      WHERE venue_id IN (${src.id}::uuid, ${dst.id}::uuid) GROUP BY venue_id
    `),
  );
  check(
    "coe rows: 1 on survivor + 1 residual on source (none lost)",
    coe.length === 2 && coe.every((r) => r.n === "1"),
    JSON.stringify(coe),
  );

  const decision = rows<{ decision: string }>(
    await db.execute(sql`
      SELECT decision FROM venue_duplicate_decisions
      WHERE venue_low_id = LEAST(${src.id}::uuid, ${dst.id}::uuid)
        AND venue_high_id = GREATEST(${src.id}::uuid, ${dst.id}::uuid)
    `),
  )[0];
  check("pair decision recorded as merged", decision?.decision === "merged");

  const audit = rows<{ n: string }>(
    await db.execute(sql`
      SELECT count(*)::text AS n FROM audit_log
      WHERE record_id IN (${src.id}::uuid, ${dst.id}::uuid) AND changed_at > now() - interval '5 minutes'
    `),
  )[0];
  check("audit_log captured the merge updates", Number(audit?.n ?? 0) >= 2, `${audit?.n} rows`);

  // --- teardown (synthetic rows only) -------------------------------------
  await db.execute(
    sql`DELETE FROM cold_outreach_entries WHERE venue_id IN (${src.id}::uuid, ${dst.id}::uuid)`,
  );
  await db.execute(sql`DELETE FROM venue_domain_aliases WHERE domain = 'qa-merge-drill.invalid'`);
  await db.execute(sql`
    DELETE FROM venue_duplicate_decisions
    WHERE venue_low_id = LEAST(${src.id}::uuid, ${dst.id}::uuid)
      AND venue_high_id = GREATEST(${src.id}::uuid, ${dst.id}::uuid)
  `);
  await db.execute(
    sql`DELETE FROM audit_log WHERE record_id IN (${src.id}::uuid, ${dst.id}::uuid)`,
  );
  await db.execute(sql`DELETE FROM venues WHERE id IN (${src.id}::uuid, ${dst.id}::uuid)`);
  const leftover = rows<{ n: string }>(
    await db.execute(
      sql`SELECT count(*)::text AS n FROM venues WHERE name LIKE '[QA-MERGE-DRILL]%'`,
    ),
  )[0];
  check("teardown clean (no drill venues remain)", leftover?.n === "0");

  const failed = checks.filter(([, ok]) => !ok);
  console.info(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("drill crashed:", err);
  process.exit(1);
});

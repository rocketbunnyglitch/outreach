/**
 * Phase 3 milestone test:
 *   - Open a transaction with `withAuditContext(bryleId, ...)`
 *   - Mutate a crawl_brand row
 *   - Verify audit_log.changed_by captured Bryle's UUID
 *
 * This validates the chain that the brand server actions use:
 *   requireStaff() → staff.id → withAuditContext(staff.id, tx) → SET LOCAL
 *   app.current_user_id → audit trigger reads it → audit_log.changed_by
 *
 * Runs against the live Postgres database directly. Bypasses the HTTP layer
 * because exercising Server Action POST/RSC protocols from curl is brittle
 * and not necessary to validate the audit chain.
 */

import { eq } from "drizzle-orm";
import { auditLog, crawlBrands, staffMembers } from "../db/schema";
import { db, withAuditContext } from "../lib/db";

async function main() {
  // Resolve Bryle's staff_member.id
  const [bryle] = await db
    .select()
    .from(staffMembers)
    .where(eq(staffMembers.primaryEmail, "bryle@example.local"))
    .limit(1);
  if (!bryle) throw new Error("Bryle not found in staff_members");

  // Resolve fright-crawl's crawl_brand.id
  const [fc] = await db
    .select()
    .from(crawlBrands)
    .where(eq(crawlBrands.slug, "fright-crawl"))
    .limit(1);
  if (!fc) throw new Error("fright-crawl not found");

  const newTagline = `Phase 3 audit attribution test ${Date.now()}`;

  // The same chain a server action would use:
  await withAuditContext(bryle.id, async (tx) => {
    await tx.update(crawlBrands).set({ tagline: newTagline }).where(eq(crawlBrands.id, fc.id));
  });

  // Inspect the audit_log row that the trigger fired
  const auditRows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.recordId, fc.id))
    .orderBy(auditLog.changedAt);
  const latest = auditRows[auditRows.length - 1];
  if (!latest) throw new Error("No audit_log row found");

  if (latest.changedBy !== bryle.id) {
    console.error("FAIL: audit_log.changed_by did not capture Bryle's id");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

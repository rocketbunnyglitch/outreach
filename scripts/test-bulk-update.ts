/**
 * Phase 4d test: bulk venue update via withAuditContext.
 *
 * Skips the action wrapper (needs NextAuth session); exercises the same
 * SQL path the action uses.
 */
import { inArray } from "drizzle-orm";
import { auditLog, venues } from "../db/schema";
import { db, withAuditContext } from "../lib/db";

const bryleId = "fdb89cf3-c3cc-4115-a751-49600d743637";

async function main() {
  const allVenues = await db
    .select({ id: venues.id, name: venues.name, doNotContact: venues.doNotContact })
    .from(venues);
  if (allVenues.length < 2) {
    console.error(`FAIL: need at least 2 venues, have ${allVenues.length}`);
    process.exit(1);
  }
  const ids = allVenues.slice(0, 2).map((v) => v.id);

  await withAuditContext(bryleId, async (tx) =>
    tx
      .update(venues)
      .set({ doNotContact: true, doNotContactReason: "Phase 4d bulk test", updatedBy: bryleId })
      .where(inArray(venues.id, ids)),
  );

  // Verify both were updated
  const updated = await db
    .select({ id: venues.id, doNotContact: venues.doNotContact })
    .from(venues)
    .where(inArray(venues.id, ids));
  const allDnc = updated.every((v) => v.doNotContact);
  if (!allDnc) {
    console.error("FAIL: not all marked DNC");
    console.error(updated);
    process.exit(1);
  }

  // Verify audit_log has UPDATE entries for both, attributed to Bryle
  const audits = await db.select().from(auditLog).where(inArray(auditLog.recordId, ids));
  const updateAudits = audits.filter((a) => a.operation === "UPDATE" && a.changedBy === bryleId);
  if (updateAudits.length < 2) {
    console.error(`FAIL: expected 2 UPDATE audits, got ${updateAudits.length}`);
    process.exit(1);
  }

  // Clean up: revert
  await withAuditContext(bryleId, async (tx) =>
    tx
      .update(venues)
      .set({ doNotContact: false, doNotContactReason: null, updatedBy: bryleId })
      .where(inArray(venues.id, ids)),
  );
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

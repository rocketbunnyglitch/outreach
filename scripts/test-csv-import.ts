/**
 * Phase 4b milestone test: CSV parse + Zod + audit-context insert.
 *
 * Doesn't go through the Server Action (requires a NextAuth session this
 * CLI script can't synthesize). Exercises the same three pieces the action
 * uses: papaparse with our header transform, venueCsvRowSchema validation,
 * and withAuditContext(bryle.id, ...) insert.
 */

import { eq } from "drizzle-orm";
import { parse } from "papaparse";
import { auditLog, cities, venues } from "../db/schema";
import { db, withAuditContext } from "../lib/db";
import { venueCsvRowSchema } from "../lib/validation/csv-import";

const bryleId = "fdb89cf3-c3cc-4115-a751-49600d743637";

async function main() {
  const csv = `name,city,country,phone,email,capacity,serves_alcohol,dnc,notes
The Phantom Pub Phase4b,Toronto,Canada,+14165550987,phantom@example.com,120,yes,no,Phase 4b test venue
BadEmail Place,Toronto,,,not-an-email,40,yes,no,
`;

  const parsed = parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  const validated: { name: string; phone?: string }[] = [];
  const errors: string[] = [];
  for (const row of parsed.data) {
    const result = venueCsvRowSchema.safeParse(row);
    if (!result.success) {
      errors.push(`row "${row.name}": ${result.error.issues[0]?.message ?? "unknown"}`);
      continue;
    }
    validated.push({ name: result.data.name, phone: result.data.phone });
  }

  if (validated.length !== 1 || errors.length !== 1) {
    console.error(`FAIL: expected 1 valid + 1 rejected, got ${validated.length}+${errors.length}`);
    process.exit(1);
  }
  const first = validated[0];
  if (!first) {
    console.error("FAIL: no validated row to insert");
    process.exit(1);
  }
  if (!errors[0]?.includes("BadEmail")) {
    console.error("FAIL: BadEmail row should have been rejected");
    process.exit(1);
  }

  const [toronto] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, "Toronto"))
    .limit(1);
  if (!toronto) {
    console.error("FAIL: Toronto not seeded");
    process.exit(1);
  }

  const insertedId = await withAuditContext(bryleId, async (tx) => {
    const [row] = await tx
      .insert(venues)
      .values({
        cityId: toronto.id,
        name: first.name,
        phoneE164: first.phone,
        servesAlcohol: true,
        doNotContact: false,
        internalNotes: "",
        createdBy: bryleId,
        updatedBy: bryleId,
      })
      .returning({ id: venues.id });
    if (!row) throw new Error("insert returned no row");
    return row.id;
  });

  const audits = await db.select().from(auditLog).where(eq(auditLog.recordId, insertedId));
  const insertAudit = audits.find((a) => a.operation === "INSERT");
  if (!insertAudit || insertAudit.changedBy !== bryleId) {
    console.error("FAIL: audit_log changed_by not set to Bryle");
    console.error(insertAudit);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

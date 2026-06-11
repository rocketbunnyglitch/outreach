import "server-only";

/**
 * Venue merge (CRM plan D1): fold a duplicate venue into its survivor
 * with ALL outreach history preserved.
 *
 * How it works, inside one transaction:
 *   1. Every FK column referencing venues(id) is discovered from
 *      information_schema at run time — a new table with a venue_id
 *      added next month is re-pointed automatically, not forgotten.
 *   2. Each referencing table is re-pointed source -> dest under a
 *      SAVEPOINT. If a unique constraint collides (e.g. both venues
 *      have a cold_outreach_entries row on the same city-campaign),
 *      we roll back that table only and retry re-pointing JUST the
 *      rows that don't collide. The residual rows stay on the source
 *      venue — which is archived, not deleted, and chains to the
 *      survivor via merged_into_venue_id. History is never destroyed.
 *   3. Scalar contact fields the survivor is missing (email, phone,
 *      website, contact name, place id) are copied over from the
 *      source. google_place_id is UNIQUE, so it is moved (cleared on
 *      source first).
 *   4. The source is archived + chained; the pair decision 'merged' is
 *      recorded so the duplicate checker never re-warns.
 *
 * Audited via withAuditContext (every UPDATE lands in audit_log).
 */

import { withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

export interface MergeResult {
  ok: boolean;
  /** Per-table re-point counts, e.g. { email_threads: 12 }. */
  repointed: Record<string, number>;
  /** Tables where unique collisions left residual rows on the source. */
  residual: Record<string, number>;
  error?: string;
}

type FkRef = { table_name: string; column_name: string };

/** Tables we must NOT blanket-re-point. */
const SKIP_TABLES = new Set([
  "venues", // merged_into_venue_id chain — handled explicitly
  "venue_duplicate_decisions", // pair history must keep its original ids
]);

export async function mergeVenues(args: {
  sourceId: string;
  destId: string;
  byStaffId: string;
  reason?: string;
}): Promise<MergeResult> {
  const { sourceId, destId, byStaffId } = args;
  if (sourceId === destId) {
    return { ok: false, repointed: {}, residual: {}, error: "Source and survivor are the same." };
  }

  const repointed: Record<string, number> = {};
  const residual: Record<string, number> = {};

  try {
    await withAuditContext(byStaffId, async (tx) => {
      // Lock + validate both rows.
      const pair = await tx.execute<{ id: string; merged_into_venue_id: string | null }>(sql`
        SELECT id, merged_into_venue_id FROM venues
        WHERE id IN (${sourceId}::uuid, ${destId}::uuid) AND archived_at IS NULL
        FOR UPDATE
      `);
      const pairRows = Array.isArray(pair)
        ? pair
        : ((pair as unknown as { rows: { id: string }[] }).rows ?? []);
      if (pairRows.length !== 2) {
        throw new Error("Both venues must exist and be unarchived to merge.");
      }

      // 1. Discover every FK column referencing venues(id).
      const fkRes = await tx.execute<FkRef>(sql`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND ccu.table_name = 'venues'
          AND ccu.column_name = 'id'
      `);
      const refs = (
        Array.isArray(fkRes)
          ? (fkRes as unknown as FkRef[])
          : ((fkRes as unknown as { rows: FkRef[] }).rows ?? [])
      ).filter((r) => !SKIP_TABLES.has(r.table_name));

      // 2. Re-point each referencing table, savepoint-guarded.
      for (const ref of refs) {
        const tbl = sql.raw(`"${ref.table_name}"`);
        const col = sql.raw(`"${ref.column_name}"`);
        await tx.execute(sql`SAVEPOINT repoint`);
        try {
          const res = await tx.execute(sql`
            UPDATE ${tbl} SET ${col} = ${destId}::uuid WHERE ${col} = ${sourceId}::uuid
          `);
          const n = Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
          if (n > 0) repointed[`${ref.table_name}.${ref.column_name}`] = n;
          await tx.execute(sql`RELEASE SAVEPOINT repoint`);
        } catch {
          // Unique collision somewhere in this table: retry with only the
          // rows that won't collide on ANY unique index involving the column
          // is table-specific — instead, re-point row by row and keep the
          // colliders on the source (reachable via the merge chain).
          await tx.execute(sql`ROLLBACK TO SAVEPOINT repoint`);
          const idsRes = await tx.execute<{ id: string }>(sql`
            SELECT id FROM ${tbl} WHERE ${col} = ${sourceId}::uuid
          `);
          const ids = (
            Array.isArray(idsRes)
              ? (idsRes as unknown as { id: string }[])
              : ((idsRes as unknown as { rows: { id: string }[] }).rows ?? [])
          ).map((r) => r.id);
          let moved = 0;
          for (const rowId of ids) {
            await tx.execute(sql`SAVEPOINT repoint_row`);
            try {
              await tx.execute(sql`
                UPDATE ${tbl} SET ${col} = ${destId}::uuid WHERE id = ${rowId}::uuid
              `);
              await tx.execute(sql`RELEASE SAVEPOINT repoint_row`);
              moved += 1;
            } catch {
              await tx.execute(sql`ROLLBACK TO SAVEPOINT repoint_row`);
            }
          }
          if (moved > 0) repointed[`${ref.table_name}.${ref.column_name}`] = moved;
          const left = ids.length - moved;
          if (left > 0) residual[`${ref.table_name}.${ref.column_name}`] = left;
        }
      }

      // 3. Copy contact fields the survivor is missing (read first, then
      //    write — google_place_id is UNIQUE, so to MOVE it the source must
      //    release it before the survivor claims it).
      const srcRes = await tx.execute<{
        email: string | null;
        phone_e164: string | null;
        website_url: string | null;
        contact_name: string | null;
        address: string | null;
        google_place_id: string | null;
        internal_notes: string;
      }>(sql`
        SELECT email, phone_e164, website_url, contact_name, address,
               google_place_id, internal_notes
        FROM venues WHERE id = ${sourceId}::uuid
      `);
      const src = (
        Array.isArray(srcRes)
          ? (srcRes as unknown as Record<string, unknown>[])
          : ((srcRes as unknown as { rows: Record<string, unknown>[] }).rows ?? [])
      )[0] as {
        email: string | null;
        phone_e164: string | null;
        website_url: string | null;
        contact_name: string | null;
        address: string | null;
        google_place_id: string | null;
        internal_notes: string;
      };
      if (src.google_place_id) {
        // Release on source first; the survivor claims it below only if it
        // has none of its own.
        await tx.execute(
          sql`UPDATE venues SET google_place_id = NULL WHERE id = ${sourceId}::uuid`,
        );
      }
      await tx.execute(sql`
        UPDATE venues SET
          email = COALESCE(email, ${src.email}),
          phone_e164 = COALESCE(phone_e164, ${src.phone_e164}),
          website_url = COALESCE(website_url, ${src.website_url}),
          contact_name = COALESCE(contact_name, ${src.contact_name}),
          address = COALESCE(address, ${src.address}),
          google_place_id = COALESCE(google_place_id, ${src.google_place_id}),
          internal_notes = CASE
            WHEN ${src.internal_notes} <> '' AND internal_notes NOT LIKE '%' || ${src.internal_notes} || '%'
              THEN internal_notes || E'\n\n[merged from duplicate] ' || ${src.internal_notes}
            ELSE internal_notes
          END
        WHERE id = ${destId}::uuid
      `);

      // 4. Archive + chain the source; remember the decision.
      await tx.execute(sql`
        UPDATE venues
        SET archived_at = now(), merged_into_venue_id = ${destId}::uuid
        WHERE id = ${sourceId}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO venue_duplicate_decisions
          (venue_low_id, venue_high_id, decision, reason, decided_by)
        VALUES (
          LEAST(${sourceId}::uuid, ${destId}::uuid),
          GREATEST(${sourceId}::uuid, ${destId}::uuid),
          'merged',
          ${args.reason ?? null},
          ${byStaffId}::uuid
        )
        ON CONFLICT (venue_low_id, venue_high_id)
          DO UPDATE SET decision = 'merged', decided_by = ${byStaffId}::uuid
      `);
    });

    logger.info({ sourceId, destId, byStaffId, repointed, residual }, "venues merged");
    return { ok: true, repointed, residual };
  } catch (err) {
    logger.error({ err, sourceId, destId }, "venue merge failed (transaction rolled back)");
    return {
      ok: false,
      repointed: {},
      residual: {},
      error: err instanceof Error ? err.message : "Merge failed.",
    };
  }
}

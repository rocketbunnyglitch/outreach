/**
 * migrate-cadence-state.ts (Phase 1.11) -- one-time backfill that gives every
 * existing email_thread a cadence_state for the new cadence engine, and seeds
 * venue_campaign_touch_log from past outbound emails so the cadence floor has
 * history.
 *
 * Idempotent + safe to re-run: only fills cadence_state where it is NULL and
 * only logs an outbound message that is not already in the touch log.
 *
 * Own pg Pool from DATABASE_URL (not lib/db) so it stays decoupled from the app
 * env and is runnable against a scratch DB. Run on a scratch/dev copy first,
 * eyeball the counts, then run against prod when ready -- nothing else changes
 * behavior until you also schedule the cadence-advance cron.
 *
 *   DATABASE_URL=... npx tsx scripts/migrate-cadence-state.ts
 *   DATABASE_URL=... npx tsx scripts/migrate-cadence-state.ts --dry-run
 */

import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl });

  // Each step is an idempotent UPDATE guarded by `cadence_state IS NULL`, in
  // priority order: terminal thread states first, then the follow_up_stage
  // ladder. carries over the old schedule into cadence_next_due_at.
  const steps: Array<{ label: string; sql: string }> = [
    {
      label: "closed_won -> confirmed",
      sql: `UPDATE email_threads SET cadence_state='confirmed'
            WHERE cadence_state IS NULL AND state='closed_won'`,
    },
    {
      label: "closed_lost -> declined_this_campaign",
      sql: `UPDATE email_threads SET cadence_state='declined_this_campaign'
            WHERE cadence_state IS NULL AND state='closed_lost'`,
    },
    {
      label: "closed_dnc -> opt_out_permanent",
      sql: `UPDATE email_threads SET cadence_state='opt_out_permanent'
            WHERE cadence_state IS NULL AND state='closed_dnc'`,
    },
    {
      label: "follow_up_stage=2 -> cold_exhausted_ready_for_handoff",
      sql: `UPDATE email_threads SET cadence_state='cold_exhausted_ready_for_handoff'
            WHERE cadence_state IS NULL AND follow_up_stage=2`,
    },
    {
      label: "follow_up_stage=1 -> cold_pending_touch_2",
      sql: `UPDATE email_threads
            SET cadence_state='cold_pending_touch_2', cadence_next_due_at=follow_up_next_due_at
            WHERE cadence_state IS NULL AND follow_up_stage=1`,
    },
    {
      label: "follow_up_stage=0 + outbound -> cold_sent_touch_1",
      sql: `UPDATE email_threads et
            SET cadence_state='cold_sent_touch_1',
                cadence_next_due_at = COALESCE(et.follow_up_next_due_at,
                  (SELECT MAX(em.sent_at) + INTERVAL '5 days' FROM email_messages em
                   WHERE em.thread_id=et.id AND em.direction='outbound'))
            WHERE et.cadence_state IS NULL AND et.follow_up_stage=0
              AND EXISTS (SELECT 1 FROM email_messages em
                          WHERE em.thread_id=et.id AND em.direction='outbound')`,
    },
  ];

  console.log(dryRun ? "[migrate-cadence] DRY RUN (no writes)\n" : "[migrate-cadence] applying\n");

  for (const step of steps) {
    if (dryRun) {
      const countSql = step.sql.replace(
        /^UPDATE email_threads(?: et)?\s+SET[\s\S]*?WHERE/i,
        (m) => {
          const where = m.slice(m.toUpperCase().lastIndexOf("WHERE"));
          return `SELECT count(*) FROM email_threads et ${where}`;
        },
      );
      try {
        const r = await pool.query(countSql);
        console.log(`  would update ${r.rows[0].count}  (${step.label})`);
      } catch {
        console.log(`  (dry-run count skipped) ${step.label}`);
      }
    } else {
      const r = await pool.query(step.sql);
      console.log(`  updated ${r.rowCount}  (${step.label})`);
    }
  }

  // Backfill the touch log from past outbound emails (for the cadence floor).
  const touchLogSql = `
    INSERT INTO venue_campaign_touch_log
      (venue_id, campaign_id, staff_outreach_email_id, outreach_brand_id, touch_kind, sent_at, email_message_id)
    SELECT et.venue_id, cc.campaign_id, et.staff_outreach_email_id, et.outreach_brand_id,
           'backfill', em.sent_at, em.id
    FROM email_messages em
    JOIN email_threads et ON et.id = em.thread_id
    JOIN city_campaigns cc ON cc.id = et.city_campaign_id
    WHERE em.direction='outbound'
      AND et.venue_id IS NOT NULL
      AND et.staff_outreach_email_id IS NOT NULL
      AND et.outreach_brand_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM venue_campaign_touch_log v WHERE v.email_message_id = em.id)`;

  if (dryRun) {
    const r = await pool.query(
      `SELECT count(*) FROM email_messages em
       JOIN email_threads et ON et.id = em.thread_id
       JOIN city_campaigns cc ON cc.id = et.city_campaign_id
       WHERE em.direction='outbound' AND et.venue_id IS NOT NULL
         AND et.staff_outreach_email_id IS NOT NULL AND et.outreach_brand_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM venue_campaign_touch_log v WHERE v.email_message_id = em.id)`,
    );
    console.log(`\n  would log ${r.rows[0].count} outbound touches`);
  } else {
    const r = await pool.query(touchLogSql);
    console.log(`\n  logged ${r.rowCount} outbound touches into venue_campaign_touch_log`);
  }

  // Summary.
  const summary = await pool.query(
    `SELECT count(*) FILTER (WHERE cadence_state IS NOT NULL) AS with_state,
            count(*) AS total FROM email_threads`,
  );
  console.log(
    `\n[migrate-cadence] ${summary.rows[0].with_state}/${summary.rows[0].total} threads now have cadence_state`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import "server-only";

/**
 * misclassification-data -- loader for the Phase 6.5 misclassification review
 * surface (/misclassifications).
 *
 * Read-only. Pairs the AI's suggested classification (from the LATEST
 * classifier_runs row per thread) against the operator-confirmed classification
 * (email_threads.classification) and surfaces the threads where they DIFFER.
 *
 * Definition of "misclassified" (documented for the operator):
 *   - classifier_runs has at least one run for the thread (the AI produced a
 *     suggestion). We read the most recent run by run_at.
 *   - email_threads.classification is set to a real operator-confirmed value
 *     (NOT 'unclassified') -- i.e. a human actually triaged the thread.
 *   - the AI's run.classification differs from the operator's
 *     email_threads.classification.
 * When all three hold, the AI guessed and the operator overrode it -- that is a
 * miss worth reviewing. Threads the operator never confirmed (still
 * 'unclassified') are excluded: there's no ground truth to compare against yet.
 *
 * Team scope: optional. When teamId is passed we restrict to threads whose
 * connected account (staff_outreach_emails.team_id) is on that team, matching
 * the inbox's team-scoping. The admin page passes the viewer's team.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface MisclassificationRow {
  threadId: string;
  subject: string | null;
  /** Operator-confirmed classification (email_threads.classification). */
  confirmedClassification: string;
  /** AI suggestion from the latest classifier_runs row. */
  suggestedClassification: string;
  /** 0.000-1.000 model confidence for the latest run. */
  confidence: number;
  model: string;
  /** Reference-doc section codes the run retrieved (e.g. ["6.3", "8.4"]). */
  retrievedSectionCodes: string[];
  runAt: Date;
  venueName: string | null;
  cityName: string | null;
}

export interface LoadMisclassificationsInput {
  /** When set, restrict to threads on this team (via the connected account). */
  teamId?: string;
  /** Hard cap on rows returned. The page passes a sane default. */
  limit: number;
}

/**
 * loadMisclassifications -- the join described above. One round-trip:
 * a LATERAL pull of the latest classifier_runs row per thread, joined to the
 * thread + venue + city, filtered to genuine operator overrides.
 */
export async function loadMisclassifications(
  input: LoadMisclassificationsInput,
): Promise<MisclassificationRow[]> {
  const { teamId, limit } = input;
  const safeLimit = Math.max(1, Math.min(limit, 500));

  // Team filter is applied inside the SQL via the joined connected account.
  // When teamId is absent we skip the predicate entirely (admin-wide view).
  const teamPredicate = teamId ? sql`AND soe.team_id = ${teamId}` : sql``;

  type RawRow = {
    thread_id: string;
    subject: string | null;
    confirmed_classification: string;
    suggested_classification: string;
    confidence: string;
    model: string;
    retrieved_section_codes: string[] | null;
    run_at: string;
    venue_name: string | null;
    city_name: string | null;
  };

  const result = await db.execute<RawRow>(sql`
    SELECT
      et.id                       AS thread_id,
      et.subject                  AS subject,
      et.classification::text     AS confirmed_classification,
      cr.classification::text     AS suggested_classification,
      cr.confidence::text         AS confidence,
      cr.model                    AS model,
      cr.retrieved_section_codes  AS retrieved_section_codes,
      cr.run_at                   AS run_at,
      v.name                      AS venue_name,
      c.name                      AS city_name
    FROM email_threads et
    JOIN staff_outreach_emails soe ON soe.id = et.staff_outreach_email_id
    JOIN LATERAL (
      SELECT r.classification, r.confidence, r.model, r.retrieved_section_codes, r.run_at
      FROM classifier_runs r
      WHERE r.thread_id = et.id
      ORDER BY r.run_at DESC
      LIMIT 1
    ) cr ON TRUE
    LEFT JOIN venues v ON v.id = et.venue_id
    LEFT JOIN city_campaigns cc ON cc.id = et.city_campaign_id
    LEFT JOIN cities c ON c.id = cc.city_id
    WHERE et.classification <> 'unclassified'::reply_classification
      AND cr.classification <> et.classification
      ${teamPredicate}
    ORDER BY cr.run_at DESC
    LIMIT ${safeLimit}
  `);

  const rows: RawRow[] = Array.isArray(result)
    ? (result as unknown as RawRow[])
    : ((result as unknown as { rows: RawRow[] }).rows ?? []);

  return rows.map((r) => ({
    threadId: r.thread_id,
    subject: r.subject,
    confirmedClassification: r.confirmed_classification,
    suggestedClassification: r.suggested_classification,
    confidence: Number(r.confidence),
    model: r.model,
    retrievedSectionCodes: r.retrieved_section_codes ?? [],
    runAt: new Date(r.run_at),
    venueName: r.venue_name,
    cityName: r.city_name,
  }));
}

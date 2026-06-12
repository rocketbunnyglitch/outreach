import "server-only";

/**
 * The learning-loop corpus (operator request 2026-06-11): mine real
 * email history into example stores that make the classifier and the
 * reply suggestions smarter every week the campaign runs.
 *
 *   extractReplyExamples()           inbound venue message -> the reply an
 *                                    operator actually sent (next outbound
 *                                    in-thread within 14 days)
 *   extractClassificationExamples()  inbound message -> the human-settled
 *                                    classification on its thread
 *   labelOutcomes()                  stamp each reply example with what
 *                                    happened next: confirmed / declined /
 *                                    ghosted
 *   retrieveReplyExamples()          FTS top-k similar past exchanges,
 *                                    boosted by confirmed outcomes +
 *                                    composer acceptance feedback
 *   retrieveClassificationExamples() FTS top-k labeled messages for
 *                                    classifier few-shot
 *
 * House retrieval style: Postgres FTS over generated tsvector columns
 * (same as the reference-doc system) — inspectable, no embeddings.
 * All functions are idempotent and safe to re-run; the nightly cron
 * (app/api/cron/reply-corpus) runs extract + label every day, so the
 * corpus densifies automatically as deep-resyncs land.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

/** Cap stored texts so a pasted novella doesn't bloat retrieval. */
const TEXT_CAP = 4000;
/** A reply more than 14 days after the inbound isn't "the reply". */
const REPLY_WINDOW_DAYS = 14;
/** Outcomes settle once the example is at least this old. */
const OUTCOME_MIN_AGE_DAYS = 3;
/** No further inbound this long after our reply = ghosted. */
const GHOST_DAYS = 14;

export interface CorpusRunSummary {
  replyExamplesInserted: number;
  classificationExamplesInserted: number;
  outcomesLabeled: number;
}

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

/**
 * Pair every inbound message with the NEXT outbound message in the same
 * thread (the operator's actual reply). Idempotent via the UNIQUE
 * constraint on inbound_message_id. Pure SQL set operation — one pass,
 * no N+1.
 */
export async function extractReplyExamples(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    WITH pairs AS (
      SELECT
        m_in.id            AS inbound_message_id,
        m_in.thread_id     AS thread_id,
        m_in.body_text     AS inbound_text,
        m_out.id           AS reply_message_id,
        m_out.body_text    AS reply_text,
        m_out.sent_at      AS replied_at,
        t.classification::text AS classification,
        ca.email_address   AS sender_inbox,
        t.venue_id         AS venue_id,
        c.name             AS city_name,
        cc.priority        AS city_priority,
        cc.campaign_id     AS campaign_id,
        ROW_NUMBER() OVER (
          PARTITION BY m_in.id ORDER BY m_out.sent_at ASC
        ) AS rn
      FROM email_messages m_in
      JOIN email_threads t  ON t.id = m_in.thread_id
      JOIN connected_accounts ca ON ca.id = t.staff_outreach_email_id
      JOIN email_messages m_out
        ON m_out.thread_id = m_in.thread_id
       AND m_out.direction = 'outbound'
       AND m_out.sent_at > m_in.sent_at
       AND m_out.sent_at < m_in.sent_at + (${REPLY_WINDOW_DAYS} || ' days')::interval
      LEFT JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      LEFT JOIN cities c ON c.id = cc.city_id
      WHERE m_in.direction = 'inbound'
        AND COALESCE(TRIM(m_in.body_text), '') <> ''
        -- Bounce notifiers are machine mail, not venue correspondence.
        AND m_in.from_email_normalized !~* '(mailer-daemon|postmaster)@'
        -- Staff inter-inbox mail ingests as "inbound" from OUR domains;
        -- learning venue-reply patterns from our own writing poisons
        -- the few-shot corpus (146 rows purged, FULL_AUDIT P081).
        AND lower(split_part(m_in.from_email_normalized, '@', 2)) NOT IN (
          SELECT lower(split_part(email_address, '@', 2)) FROM connected_accounts
        )
    ),
    ins AS (
      INSERT INTO reply_examples (
        thread_id, inbound_message_id, reply_message_id, inbound_text,
        reply_text, replied_at, classification, sender_inbox, venue_id,
        city_name, city_priority, campaign_id
      )
      SELECT
        thread_id, inbound_message_id, reply_message_id,
        LEFT(inbound_text, ${TEXT_CAP}), LEFT(reply_text, ${TEXT_CAP}),
        replied_at, classification, sender_inbox, venue_id,
        city_name, city_priority, campaign_id
      FROM pairs
      WHERE rn = 1 AND COALESCE(TRIM(reply_text), '') <> ''
      ON CONFLICT (inbound_message_id) DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM ins
  `);
  return rowsOf<{ n: number }>(res)[0]?.n ?? 0;
}

/**
 * Latest inbound message per thread whose classification a human has
 * settled (anything except 'unclassified'). was_override = the AI's
 * last suggestion differed from the final label, when a classifier run
 * recorded one — those examples are gold (exactly where the AI was
 * wrong).
 */
export async function extractClassificationExamples(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    WITH latest_inbound AS (
      SELECT DISTINCT ON (m.thread_id)
        m.id, m.thread_id, m.body_text,
        t.classification::text AS final_label
      FROM email_messages m
      JOIN email_threads t ON t.id = m.thread_id
      WHERE m.direction = 'inbound'
        AND t.classification::text <> 'unclassified'
        AND COALESCE(TRIM(m.body_text), '') <> ''
        AND m.from_email_normalized !~* '(mailer-daemon|postmaster)@'
        -- Same own-domain guard as the reply extractor: never learn
        -- classification from our own staff's inter-inbox mail.
        AND lower(split_part(m.from_email_normalized, '@', 2)) NOT IN (
          SELECT lower(split_part(email_address, '@', 2)) FROM connected_accounts
        )
      ORDER BY m.thread_id, m.sent_at DESC
    ),
    ins AS (
      INSERT INTO classification_examples (message_id, thread_id, text, final_label, was_override)
      SELECT li.id, li.thread_id, LEFT(li.body_text, ${TEXT_CAP}), li.final_label,
        -- P284: was_override was never written (defaulted false), so the
        -- accuracy loop read 0% forever. True when the classifier's last
        -- suggestion for the thread differs from the human-settled label.
        COALESCE((
          SELECT cr.classification::text <> li.final_label
          FROM classifier_runs cr
          WHERE cr.thread_id = li.thread_id
          ORDER BY cr.run_at DESC LIMIT 1
        ), false)
      FROM latest_inbound li
      ON CONFLICT (message_id) DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM ins
  `);
  return rowsOf<{ n: number }>(res)[0]?.n ?? 0;
}

/**
 * Stamp pending reply examples with what happened next:
 *   confirmed  the venue got a confirmed venue_event after the reply
 *   declined   the thread's classification settled on decline/unsubscribe
 *   ghosted    no inbound after our reply for GHOST_DAYS
 * Anything still ambiguous stays 'pending' for the next run.
 */
export async function labelOutcomes(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    WITH labeled AS (
      UPDATE reply_examples re
      SET outcome = sub.new_outcome, outcome_at = now()
      FROM (
        SELECT
          re2.id,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM venue_events ve
              WHERE ve.venue_id = re2.venue_id
                AND ve.status IN ('confirmed', 'scheduled', 'contract_signed')
                AND ve.confirmed_at > re2.replied_at
            ) THEN 'confirmed'
            WHEN EXISTS (
              SELECT 1 FROM email_threads t
              WHERE t.id = re2.thread_id
                AND t.classification::text IN ('decline', 'unsubscribe')
            ) THEN 'declined'
            WHEN re2.replied_at < now() - (${GHOST_DAYS} || ' days')::interval
              AND NOT EXISTS (
                SELECT 1 FROM email_messages m
                WHERE m.thread_id = re2.thread_id
                  AND m.direction = 'inbound'
                  AND m.sent_at > re2.replied_at
              ) THEN 'ghosted'
            ELSE NULL
          END AS new_outcome
        FROM reply_examples re2
        WHERE re2.outcome = 'pending'
          AND re2.replied_at < now() - (${OUTCOME_MIN_AGE_DAYS} || ' days')::interval
      ) sub
      WHERE re.id = sub.id AND sub.new_outcome IS NOT NULL
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM labeled
  `);
  return rowsOf<{ n: number }>(res)[0]?.n ?? 0;
}

/** One full corpus pass (nightly cron + on-demand backfill). */
export async function runCorpusBuild(): Promise<CorpusRunSummary> {
  const replyExamplesInserted = await extractReplyExamples();
  const classificationExamplesInserted = await extractClassificationExamples();
  const outcomesLabeled = await labelOutcomes();
  const summary = { replyExamplesInserted, classificationExamplesInserted, outcomesLabeled };
  logger.info(summary, "reply-corpus build complete");
  return summary;
}

// =========================================================================
// Retrieval
// =========================================================================

export type RetrievedReplyExample = {
  id: string;
  inboundText: string;
  replyText: string;
  outcome: string;
  senderInbox: string | null;
  cityName: string | null;
};

/**
 * Top-k past exchanges most similar to `messageText`. Ranking: FTS rank,
 * boosted for confirmed outcomes (+0.3), penalized for rewritten-heavy
 * feedback, lightly boosted for accepted-heavy feedback. Returns [] on
 * any failure — retrieval must never break classification or chips.
 */
export async function retrieveReplyExamples(
  messageText: string,
  k = 3,
): Promise<RetrievedReplyExample[]> {
  const query = messageText.slice(0, 1500);
  if (!query.trim()) return [];
  try {
    const res = await db.execute<RetrievedReplyExample>(sql`
      SELECT
        id,
        LEFT(inbound_text, 700)  AS "inboundText",
        LEFT(reply_text, 1200)   AS "replyText",
        outcome,
        sender_inbox             AS "senderInbox",
        city_name                AS "cityName"
      FROM reply_examples,
           websearch_to_tsquery('english', ${query}) q
      WHERE search_tsv @@ q
      ORDER BY
        ts_rank(search_tsv, q)
          + CASE WHEN outcome = 'confirmed' THEN 0.3 ELSE 0 END
          + LEAST(accepted_count, 5) * 0.05
          - LEAST(rewritten_count, 5) * 0.05
        DESC
      LIMIT ${k}
    `);
    return rowsOf<RetrievedReplyExample>(res);
  } catch (err) {
    logger.warn({ err }, "retrieveReplyExamples failed (non-fatal)");
    return [];
  }
}

export type RetrievedClassificationExample = {
  text: string;
  finalLabel: string;
};

/** Top-k human-labeled messages similar to `messageText` for few-shot.
 *  Overrides rank first — they encode exactly where the AI was wrong. */
export async function retrieveClassificationExamples(
  messageText: string,
  k = 6,
): Promise<RetrievedClassificationExample[]> {
  const query = messageText.slice(0, 1500);
  if (!query.trim()) return [];
  try {
    const res = await db.execute<RetrievedClassificationExample>(sql`
      SELECT LEFT(text, 500) AS "text", final_label AS "finalLabel"
      FROM classification_examples,
           websearch_to_tsquery('english', ${query}) q
      WHERE search_tsv @@ q
      ORDER BY
        ts_rank(search_tsv, q) + CASE WHEN was_override THEN 0.4 ELSE 0 END DESC
      LIMIT ${k}
    `);
    return rowsOf<RetrievedClassificationExample>(res);
  } catch (err) {
    logger.warn({ err }, "retrieveClassificationExamples failed (non-fatal)");
    return [];
  }
}

/**
 * Composer feedback: credit/penalize the examples behind a suggestion
 * once the operator sends. bucket: sent-as-is -> accepted, light edit ->
 * edited, heavy rewrite -> rewritten.
 */
export async function recordSuggestionFeedback(
  exampleIds: string[],
  bucket: "accepted" | "edited" | "rewritten",
): Promise<void> {
  if (exampleIds.length === 0) return;
  const col =
    bucket === "accepted"
      ? sql`accepted_count = accepted_count + 1`
      : bucket === "edited"
        ? sql`edited_count = edited_count + 1`
        : sql`rewritten_count = rewritten_count + 1`;
  try {
    await db.execute(sql`
      UPDATE reply_examples SET ${col}
      WHERE id = ANY(${sql.raw(`ARRAY[${exampleIds.map((id) => `'${id.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)})
    `);
  } catch (err) {
    logger.warn({ err, bucket }, "recordSuggestionFeedback failed (non-fatal)");
  }
}

/**
 * Similarity bucket between the seeded suggestion and what was actually
 * sent. Token-overlap (Jaccard) — cheap, language-agnostic enough.
 */
export function feedbackBucket(seeded: string, sent: string): "accepted" | "edited" | "rewritten" {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const a = norm(seeded);
  const b = norm(sent);
  if (a.size === 0 || b.size === 0) return "rewritten";
  let common = 0;
  for (const w of a) if (b.has(w)) common += 1;
  const jaccard = common / (a.size + b.size - common);
  if (jaccard >= 0.9) return "accepted";
  if (jaccard >= 0.55) return "edited";
  return "rewritten";
}

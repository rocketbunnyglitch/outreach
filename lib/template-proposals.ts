import "server-only";

/**
 * Template-proposal engine — the bridge from "rank/suggest existing templates"
 * to "evolve the template library".
 *
 * The reply corpus (reply_examples) already captures every inbound→staff-reply
 * pair, outcome-labeled (confirmed/declined/ghosted) and feedback-counted. The
 * existing learning loop RANKS templates (Loop C) and SUGGESTS past replies
 * (quick-reply chips), but nothing turns a recurring, high-performing staff
 * reply that NO template covers into a new template. This does.
 *
 * generateTemplateProposals() feeds an LLM the existing template bodies (so it
 * knows what's covered) plus the campaign's best staff replies (confirmed
 * outcome / accepted-heavy), and asks it to surface recurring reply intents
 * that are NOT yet templated and draft a clean, merge-field-correct template
 * for each. Results land in template_proposals (status='pending'); the operator
 * reviews on /admin/learning and promotes (→ a real email_template) or
 * dismisses. The engine proposes; the human decides — same boundary as the
 * rest of the system (see [[reference_send_safety_boundary]]).
 */

import { generateCompletion } from "@/lib/ai";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { MERGE_FIELD_KEYS } from "@/lib/template-merge-context";
import { sql } from "drizzle-orm";

function rows<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

/** Normalized intent key so re-runs don't pile duplicate proposals. */
function dedupeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .sort()
    .join("-")
    .slice(0, 120);
}

export interface GenerateResult {
  ok: boolean;
  created: number;
  considered: number;
  error?: string;
}

const MAX_REPLIES = 50;
const MIN_REPLY_LEN = 40;

/**
 * Mine high-performing, uncovered staff replies for this campaign and draft
 * candidate templates. Idempotent against live (pending/promoted) proposals:
 * a re-run won't duplicate an intent already on the board.
 */
export async function generateTemplateProposals(args: {
  campaignId: string;
  byUserId: string;
}): Promise<GenerateResult> {
  const { campaignId, byUserId } = args;

  // 1. What's already covered — existing template bodies for this campaign +
  //    the brand-scoped cold set (any campaign, deduped by code).
  const existing = rows<{ code: string; subject: string; body: string }>(
    await db.execute(sql`
      SELECT DISTINCT ON (template_code)
        template_code AS code,
        COALESCE(subject_template, '') AS subject,
        LEFT(COALESCE(body_template_text, ''), 600) AS body
      FROM email_templates
      WHERE archived_at IS NULL
        AND (campaign_id = ${campaignId}::uuid OR campaign_id IS NULL)
      ORDER BY template_code
    `),
  );

  // 2. The campaign's best staff replies that are worth learning from:
  //    confirmed outcome (strongest) or operator-accepted, real prose.
  const replies = rows<{
    id: string;
    inbound: string;
    reply: string;
    outcome: string | null;
  }>(
    await db.execute(sql`
      SELECT reply_message_id AS id,
             LEFT(inbound_text, 600) AS inbound,
             LEFT(reply_text, 900)   AS reply,
             outcome
      FROM reply_examples
      WHERE campaign_id = ${campaignId}::uuid
        AND length(COALESCE(reply_text, '')) >= ${MIN_REPLY_LEN}
        AND (outcome = 'confirmed' OR accepted_count > rewritten_count)
      ORDER BY (outcome = 'confirmed') DESC, accepted_count DESC, replied_at DESC
      LIMIT ${MAX_REPLIES}
    `),
  );

  if (replies.length < 3) {
    return { ok: true, created: 0, considered: replies.length };
  }

  // 3. Already-live proposals. The model rephrases titles run-to-run, so a
  //    dedupe_key match alone misses near-duplicate intents — we ALSO feed the
  //    existing proposals into the prompt as "already suggested, do not repeat".
  const livePropRows = rows<{ dedupe_key: string; title: string; body: string }>(
    await db.execute(sql`
      SELECT dedupe_key, title, LEFT(suggested_body, 300) AS body
      FROM template_proposals
      WHERE campaign_id = ${campaignId}::uuid AND status IN ('pending', 'promoted')
    `),
  );
  const liveKeys = new Set(livePropRows.map((r) => r.dedupe_key));
  const alreadyProposedBlock = livePropRows
    .map((r) => `- ${r.title}: ${r.body.replace(/\s+/g, " ")}`)
    .join("\n")
    .slice(0, 4000);

  // 4. Ask the model to find UNCOVERED recurring intents + draft templates.
  const existingBlock = existing
    .map((t) => `[${t.code}] ${t.subject}\n${t.body}`)
    .join("\n---\n")
    .slice(0, 9000);
  const replyBlock = replies
    .map(
      (r, i) =>
        `#${i}${r.outcome === "confirmed" ? " (venue CONFIRMED)" : ""}\nVENUE: ${r.inbound.replace(/\s+/g, " ")}\nSTAFF REPLY: ${r.reply.replace(/\s+/g, " ")}`,
    )
    .join("\n===\n")
    .slice(0, 14000);

  const system = [
    "You curate the template library for a venue-outreach team running bar crawls.",
    "Goal: turn recurring, high-performing staff replies into reusable templates the team is currently writing by hand.",
    "",
    "You will be given (A) the EXISTING templates and (B) high-performing staff replies (many led to the venue confirming).",
    "Find recurring reply INTENTS in (B) that are NOT already covered by an existing template in (A) — e.g. a common objection answer, a deposit/insurance question, a scheduling-flexibility reply.",
    "You will also be given (C) intents ALREADY suggested — do NOT propose anything that overlaps with (A) or (C).",
    "Only propose an intent that appears in MULTIPLE replies and is genuinely missing from (A) and (C). Quality over quantity: 0-4 proposals. If everything is already covered, return an empty array.",
    "",
    "For each, write a CLEAN, reusable template (not a copy of one reply) that captures the winning pattern.",
    "",
    'ALSO: if an EXISTING template in (A) is clearly weaker than how staff actually reply in (B) for that same moment, you may propose an IMPROVED version of it. For those, set "kind":"improvement" and "targetCode": the existing template\'s code (the [CODE] in brackets). For brand-new templates set "kind":"new". Prefer improving an existing template over adding a near-duplicate new one.',
    "",
    `Use ONLY these merge-field placeholders where a value varies, exactly as written: ${MERGE_FIELD_KEYS.map((k) => `{{${k}}}`).join(", ")}.`,
    "End the body with {{signature_block}}. Keep the tone warm and human, matching the staff replies. Never invent merge fields.",
    "",
    'Return ONLY a JSON array, no prose. Each item: {"kind": "new" | "improvement", "targetCode": existing code if improvement else null, "title": short label, "subject": email subject, "body": full template body, "rationale": 1 sentence why it is worth adding/changing, "exampleIndexes": [the #numbers of supporting replies]}.',
  ].join("\n");

  const prompt = [
    `EXISTING TEMPLATES (A):\n${existingBlock}`,
    alreadyProposedBlock
      ? `\n\nALREADY SUGGESTED — DO NOT REPEAT (C):\n${alreadyProposedBlock}`
      : "",
    `\n\nHIGH-PERFORMING STAFF REPLIES (B):\n${replyBlock}`,
  ].join("");

  const ai = await generateCompletion({
    system,
    prompt,
    tag: "template_proposals",
    maxTokens: 3000,
  });
  if (!ai.ok) {
    logger.warn({ campaignId, reason: ai.reason }, "template-proposals: AI call failed");
    return { ok: false, created: 0, considered: replies.length, error: ai.message };
  }

  type RawProposal = {
    kind?: string;
    targetCode?: string | null;
    title?: string;
    subject?: string;
    body?: string;
    rationale?: string;
    exampleIndexes?: number[];
  };
  let parsed: RawProposal[];
  try {
    const jsonText = ai.text.slice(ai.text.indexOf("["), ai.text.lastIndexOf("]") + 1);
    parsed = JSON.parse(jsonText) as RawProposal[];
    if (!Array.isArray(parsed)) throw new Error("not an array");
  } catch (err) {
    logger.warn(
      { campaignId, err, raw: ai.text.slice(0, 200) },
      "template-proposals: parse failed",
    );
    return {
      ok: false,
      created: 0,
      considered: replies.length,
      error: "Could not parse AI output.",
    };
  }

  // The codes that actually exist (so an "improvement" targetCode the model
  // invents is downgraded to a plain 'new' proposal rather than dangling).
  const existingCodes = new Set(existing.map((t) => t.code));

  // 5. Persist the genuinely-new / improving ones.
  let created = 0;
  for (const p of parsed) {
    const title = (p.title ?? "").trim();
    const body = (p.body ?? "").trim();
    if (!title || body.length < 30) continue;

    const targetCode =
      p.kind === "improvement" && p.targetCode && existingCodes.has(p.targetCode.trim())
        ? p.targetCode.trim()
        : null;
    const kind = targetCode ? "improvement" : "new";
    // Improvements dedupe by their target (one live improvement per template);
    // new proposals dedupe by normalized title.
    const key = targetCode ? `improve-${targetCode.toLowerCase()}` : dedupeKey(title);
    if (!key || liveKeys.has(key)) continue;
    liveKeys.add(key);

    const idxs = Array.isArray(p.exampleIndexes) ? p.exampleIndexes : [];
    const exampleIds = idxs
      .map((i) => replies[i]?.id)
      .filter((v): v is string => typeof v === "string");
    const confirmed = idxs.filter((i) => replies[i]?.outcome === "confirmed").length;

    await db.execute(sql`
      INSERT INTO template_proposals
        (campaign_id, kind, target_template_code, target_template_id,
         title, suggested_subject, suggested_body, rationale,
         example_message_ids, support_count, confirmed_count, dedupe_key, model, created_by)
      VALUES (
        ${campaignId}::uuid, ${kind}, ${targetCode},
        ${
          targetCode
            ? sql`(SELECT id FROM email_templates WHERE template_code = ${targetCode} AND archived_at IS NULL AND (campaign_id = ${campaignId}::uuid OR campaign_id IS NULL) ORDER BY campaign_id NULLS LAST LIMIT 1)`
            : sql`NULL`
        },
        ${title}, ${(p.subject ?? "").trim()}, ${body},
        ${(p.rationale ?? "").trim()},
        ${`{${exampleIds.map((id) => `"${id}"`).join(",")}}`}::uuid[],
        ${exampleIds.length}, ${confirmed}, ${key}, 'template_proposals', ${byUserId}::uuid
      )
      ON CONFLICT DO NOTHING
    `);
    created += 1;
  }

  logger.info({ campaignId, created, considered: replies.length }, "template-proposals generated");
  return { ok: true, created, considered: replies.length };
}

export interface ProposalRow {
  id: string;
  kind: "new" | "improvement";
  targetTemplateCode: string | null;
  title: string;
  suggestedSubject: string;
  suggestedBody: string;
  rationale: string;
  supportCount: number;
  confirmedCount: number;
  createdAt: string;
}

/** Pending proposals for the campaign, newest first. */
export async function listTemplateProposals(campaignId: string): Promise<ProposalRow[]> {
  return rows<ProposalRow>(
    await db.execute(sql`
      SELECT id,
             kind,
             target_template_code AS "targetTemplateCode",
             title,
             suggested_subject AS "suggestedSubject",
             suggested_body    AS "suggestedBody",
             rationale,
             support_count     AS "supportCount",
             confirmed_count   AS "confirmedCount",
             created_at        AS "createdAt"
      FROM template_proposals
      WHERE campaign_id = ${campaignId}::uuid AND status = 'pending'
      ORDER BY confirmed_count DESC, support_count DESC, created_at DESC
    `),
  );
}

export interface PromoteResult {
  ok: boolean;
  templateId?: string;
  error?: string;
}

/**
 * Promote a proposal into a real (usable) template under the campaign's
 * outreach brand. Given a generated custom code so it's immediately live in the
 * template editor where the operator can refine the code/stage/brand. Atomic.
 */
export async function promoteProposal(args: {
  proposalId: string;
  byUserId: string;
  code?: string;
}): Promise<PromoteResult> {
  const { proposalId, byUserId } = args;
  try {
    const p = rows<{
      campaign_id: string | null;
      kind: string;
      target_template_id: string | null;
      title: string;
      suggested_subject: string;
      suggested_body: string;
      status: string;
    }>(
      await db.execute(sql`
        SELECT campaign_id, kind, target_template_id, title, suggested_subject,
               suggested_body, status
        FROM template_proposals WHERE id = ${proposalId}::uuid
      `),
    )[0];
    if (!p) return { ok: false, error: "Proposal not found." };
    if (p.status !== "pending") return { ok: false, error: `Already ${p.status}.` };
    if (!p.campaign_id) return { ok: false, error: "Proposal has no campaign." };

    // Improvement: update the target template IN PLACE (version-bumped, audited)
    // rather than creating a new one. Falls through to "create new" if the
    // target was archived/deleted since the proposal was generated.
    if (p.kind === "improvement" && p.target_template_id) {
      const upd = rows<{ id: string }>(
        await db.execute(sql`
          WITH t AS (
            UPDATE email_templates
            SET subject_template = ${p.suggested_subject},
                body_template_text = ${p.suggested_body},
                version = version + 1,
                updated_at = now(),
                updated_by = ${byUserId}::uuid
            WHERE id = ${p.target_template_id}::uuid AND archived_at IS NULL
            RETURNING id
          ), pr AS (
            UPDATE template_proposals
            SET status = 'promoted', promoted_template_id = (SELECT id FROM t),
                decided_at = now(), decided_by = ${byUserId}::uuid,
                updated_at = now(), updated_by = ${byUserId}::uuid
            WHERE id = ${proposalId}::uuid AND EXISTS (SELECT 1 FROM t)
            RETURNING id
          )
          SELECT id FROM t
        `),
      )[0];
      if (upd?.id) return { ok: true, templateId: upd.id };
      // Target gone — fall through and create it fresh instead.
    }

    const brand = rows<{ outreach_brand_id: string | null }>(
      await db.execute(sql`
        SELECT outreach_brand_id FROM campaigns WHERE id = ${p.campaign_id}::uuid
      `),
    )[0];
    if (!brand?.outreach_brand_id) {
      return { ok: false, error: "Campaign has no outreach brand to attach the template to." };
    }

    const code =
      args.code?.trim() ||
      `PROP-${proposalId.slice(0, 8)}`.toUpperCase().replace(/[^A-Z0-9-]/g, "");

    const inserted = rows<{ id: string }>(
      await db.execute(sql`
        WITH ins AS (
          INSERT INTO email_templates
            (outreach_brand_id, campaign_id, stage, name, template_code,
             subject_template, body_template_text, created_by, updated_by)
          VALUES (
            ${brand.outreach_brand_id}::uuid, ${p.campaign_id}::uuid, 'custom',
            ${p.title.slice(0, 200)}, ${code},
            ${p.suggested_subject}, ${p.suggested_body},
            ${byUserId}::uuid, ${byUserId}::uuid
          )
          RETURNING id
        ), upd AS (
          UPDATE template_proposals
          SET status = 'promoted', promoted_template_id = (SELECT id FROM ins),
              decided_at = now(), decided_by = ${byUserId}::uuid,
              updated_at = now(), updated_by = ${byUserId}::uuid
          WHERE id = ${proposalId}::uuid
          RETURNING id
        )
        SELECT id FROM ins
      `),
    )[0];

    return { ok: true, templateId: inserted?.id };
  } catch (err) {
    logger.error({ err, proposalId }, "template-proposals: promote failed");
    return { ok: false, error: err instanceof Error ? err.message : "Promote failed." };
  }
}

/** Operator dismissed a proposal; it won't block future re-proposals of the intent. */
export async function dismissProposal(args: {
  proposalId: string;
  byUserId: string;
}): Promise<{ ok: boolean }> {
  await db.execute(sql`
    UPDATE template_proposals
    SET status = 'dismissed', decided_at = now(), decided_by = ${args.byUserId}::uuid,
        updated_at = now(), updated_by = ${args.byUserId}::uuid
    WHERE id = ${args.proposalId}::uuid AND status = 'pending'
  `);
  return { ok: true };
}

export interface ScheduledResult {
  campaigns: number;
  created: number;
}

/**
 * Hands-off weekly pass: generate proposals for every active campaign and, when
 * anything new lands, notify admins so the suggestions come TO them rather than
 * waiting to be checked. Triggered automatically (rides the nightly reply-corpus
 * cron on a 7-day gate) and on-demand via /api/cron/template-proposals. The
 * engine only DRAFTS — nothing is promoted or sent without a human.
 */
export async function runScheduledProposals(): Promise<ScheduledResult> {
  const camps = rows<{ id: string }>(
    await db.execute(sql`SELECT id FROM campaigns WHERE archived_at IS NULL`),
  );
  const actor = rows<{ id: string }>(
    await db.execute(
      sql`SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`,
    ),
  )[0];
  if (!actor) return { campaigns: 0, created: 0 };

  let created = 0;
  for (const c of camps) {
    try {
      const r = await generateTemplateProposals({ campaignId: c.id, byUserId: actor.id });
      created += r.created;
    } catch (err) {
      logger.warn({ err, campaignId: c.id }, "scheduled template-proposals: campaign failed");
    }
  }

  if (created > 0) {
    try {
      const admins = rows<{ id: string }>(
        await db.execute(sql`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`),
      );
      const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
      for (const a of admins) {
        await emitNotification({
          staffId: a.id,
          kind: "admin_message",
          title: `${created} new template suggestion${created === 1 ? "" : "s"} ready`,
          body: "The learning engine drafted template ideas from your team's best replies. Review on the Learning page.",
          linkPath: "/admin/learning",
          dedupeMinutes: 720,
        });
      }
    } catch (err) {
      logger.warn({ err }, "scheduled template-proposals: notify failed");
    }
  }

  logger.info({ campaigns: camps.length, created }, "scheduled template-proposals complete");
  return { campaigns: camps.length, created };
}

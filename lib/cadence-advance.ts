/**
 * Cadence-advance pass (Phase 1.10) -- the daily cron that turns due cadence
 * touches into review-ready engine drafts.
 *
 * For each email_thread whose cadence_state is actionable and whose
 * cadence_next_due_at has elapsed, it asks the cadence engine for the next
 * touch (planNextTouch), renders the recommended template against the venue +
 * sending alias, and creates an email_drafts row (a reply on the thread,
 * assigned to the thread owner) for the operator to review and send. The thread
 * is then paused (cadence_next_due_at = NULL) so the cron does not regenerate
 * the same draft; when the operator actually SENDS, recordTouch (wired into the
 * send pipeline in Phase 1.11) logs the touch and advances the state, which
 * resumes the cadence.
 *
 * Dormant until Phase 1.11 backfills cadence_state onto existing threads -- with
 * no cadence_state set, the scan returns nothing.
 *
 * [ReferenceDoc Section 6] cadence; the engine drafts, the operator sends.
 */

import "server-only";
import { randomUUID } from "node:crypto";
import {
  type CadenceState,
  cityCampaigns,
  connectedAccounts,
  emailDrafts,
  emailTemplates,
  emailThreads,
  venues,
} from "@/db/schema";
import { planNextTouch } from "@/lib/cadence-engine";
import { db } from "@/lib/db";
import { scoreDecision } from "@/lib/decision-confidence";
import { recordEngineDecision } from "@/lib/engine-decisions";
import { logger } from "@/lib/logger";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { and, eq, isNotNull, isNull, lte, notInArray } from "drizzle-orm";

export interface CadenceAdvanceResult {
  threadsScanned: number;
  draftsGenerated: number;
  skipped: number;
  errors: number;
}

// States with no pending automated touch -- the scan ignores them.
const TERMINAL_STATES: CadenceState[] = [
  "cold_exhausted_ready_for_handoff",
  "stalled_warm",
  "declined_this_campaign",
  "opt_out_permanent",
  "cancelled_by_them",
  "confirmed",
  "lifecycle_active",
];

const MAX_PER_RUN = 200;

function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * One cadence-advance pass. Idempotent: a thread is paused after a draft is
 * generated, so back-to-back runs converge. Per-thread failures are logged and
 * counted; they never abort the pass.
 */
export async function runCadenceAdvance(now: Date = new Date()): Promise<CadenceAdvanceResult> {
  const due = await db
    .select({
      id: emailThreads.id,
      venueId: emailThreads.venueId,
      cityCampaignId: emailThreads.cityCampaignId,
      staffOutreachEmailId: emailThreads.staffOutreachEmailId,
      assignedStaffId: emailThreads.assignedStaffId,
    })
    .from(emailThreads)
    .where(
      and(
        isNotNull(emailThreads.cadenceState),
        notInArray(emailThreads.cadenceState, TERMINAL_STATES),
        isNotNull(emailThreads.cadenceNextDueAt),
        lte(emailThreads.cadenceNextDueAt, now),
      ),
    )
    .limit(MAX_PER_RUN);

  let draftsGenerated = 0;
  let skipped = 0;
  let errors = 0;

  for (const t of due) {
    try {
      const generated = await advanceThread(t);
      if (generated) draftsGenerated++;
      else skipped++;
    } catch (err) {
      logger.error({ err, threadId: t.id }, "cadence-advance: thread failed");
      errors++;
    }
  }

  return { threadsScanned: due.length, draftsGenerated, skipped, errors };
}

interface DueThread {
  id: string;
  venueId: string | null;
  cityCampaignId: string | null;
  staffOutreachEmailId: string | null;
  assignedStaffId: string | null;
}

/** Generate the engine draft for one due thread + pause it. Returns false (and
 *  pauses the thread) when a draft can't be produced. */
async function advanceThread(t: DueThread): Promise<boolean> {
  const pause = () =>
    db.update(emailThreads).set({ cadenceNextDueAt: null }).where(eq(emailThreads.id, t.id));

  if (!t.venueId || !t.cityCampaignId) {
    await pause();
    return false;
  }

  const [cc] = await db
    .select({ campaignId: cityCampaigns.campaignId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, t.cityCampaignId))
    .limit(1);
  if (!cc?.campaignId) {
    await pause();
    return false;
  }

  const plan = await planNextTouch(t.venueId, cc.campaignId);
  if (!plan) {
    await pause();
    return false;
  }

  const aliasId = plan.recommendedAliasId || t.staffOutreachEmailId;
  if (!aliasId) {
    await pause();
    return false;
  }

  const [acct] = await db
    .select({ teamId: connectedAccounts.teamId, ownerUserId: connectedAccounts.ownerUserId })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, aliasId))
    .limit(1);
  const ownerUserId = t.assignedStaffId ?? acct?.ownerUserId ?? null;
  if (!acct?.teamId || !ownerUserId) {
    await pause();
    return false;
  }

  const [venue] = await db
    .select({ email: venues.email })
    .from(venues)
    .where(eq(venues.id, t.venueId))
    .limit(1);
  if (!venue?.email) {
    await pause();
    return false;
  }

  const [tpl] = await db
    .select({
      id: emailTemplates.id,
      subject: emailTemplates.subjectTemplate,
      body: emailTemplates.bodyTemplateText,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.campaignId, cc.campaignId),
        eq(emailTemplates.templateCode, plan.recommendedTemplateCode),
        isNull(emailTemplates.archivedAt),
      ),
    )
    .limit(1);
  if (!tpl) {
    await pause();
    return false;
  }

  const ctx = await buildFlatMergeContext({
    venueId: t.venueId,
    campaignId: cc.campaignId,
    cityCampaignId: t.cityCampaignId,
    staffId: ownerUserId,
    sendingAccountId: aliasId,
  });
  const subject = renderTemplate(tpl.subject, ctx).output;
  const bodyText = renderTemplate(tpl.body, ctx).output;

  const draftId = randomUUID();
  await db.insert(emailDrafts).values({
    id: draftId,
    ownerUserId,
    teamId: acct.teamId,
    connectedAccountId: aliasId,
    toAddresses: [venue.email],
    subject,
    bodyText,
    bodyHtml: textToHtml(bodyText),
    venueId: t.venueId,
    cityCampaignId: t.cityCampaignId,
    templateId: tpl.id,
    enginePickedTemplateId: tpl.id,
    // Reply on the existing thread so the follow-up keeps Gmail threading.
    mode: "reply",
    replyToThreadId: t.id,
  });

  // Shadow ledger (autonomy Phase A): record the engine's choice + confidence
  // so we can later measure how often the human sent it unchanged — the
  // evidence that earns this touch class the right to auto-send.
  const code = plan.recommendedTemplateCode;
  const kind: "cold_touch" | "lifecycle" | "reply" = /^T[1-8]$/.test(code)
    ? "cold_touch"
    : /^T(9|1[0-7])/.test(code)
      ? "lifecycle"
      : "reply";
  const conf = scoreDecision({
    // A cadence follow-up replies on a thread that already delivered, so the
    // recipient is established (not freshly re-validated here).
    recipientValidity: 0.8,
    templateConfidence: 1,
    cadenceClarity: 1,
    safetyClear: true,
  });
  await recordEngineDecision({
    draftId,
    threadId: t.id,
    venueId: t.venueId,
    campaignId: cc.campaignId,
    kind,
    templateCode: code,
    confidence: conf.score,
    factors: conf.factors,
    engineBodyLen: bodyText.length,
  });

  // Pause: the draft is the operator's to send. recordTouch (Phase 1.11) on
  // send advances the state + sets the next due, resuming the cadence.
  await pause();
  return true;
}

/**
 * Generate the engine draft for a single thread on demand (the worklist
 * "Draft now" action, Phase 2.4) -- the same logic the daily cron runs, pulled
 * forward for one thread. Loads the thread's cadence inputs and runs the shared
 * advanceThread path; returns true when a draft was created, false when the
 * thread can't be advanced (missing venue/campaign/template, etc.) or does not
 * exist. Like the cron, it pauses the thread after generating.
 */
export async function generateCadenceDraftForThread(threadId: string): Promise<boolean> {
  const [t] = await db
    .select({
      id: emailThreads.id,
      venueId: emailThreads.venueId,
      cityCampaignId: emailThreads.cityCampaignId,
      staffOutreachEmailId: emailThreads.staffOutreachEmailId,
      assignedStaffId: emailThreads.assignedStaffId,
    })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!t) return false;
  return advanceThread(t);
}

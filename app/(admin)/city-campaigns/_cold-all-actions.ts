"use server";

/**
 * "Cold All" -- bulk-queue a T1 cold opener to the selected venues. [feature]
 *
 * SAFETY: this does NOT send. It creates email_drafts marked
 * send_mode='operator_scheduled' + approved-by-the-operator-who-clicked, so the
 * EXISTING paced cron (lib/scheduled-send-runner.ts) sends them -- respecting
 * each inbox's daily cap, warmup ramp and 5-8 min cooldown. The operator's
 * single click IS the human approval for the batch; the per-recipient
 * suppression / DNC / duplicate checks still run server-side at send time.
 *
 * Behaviour (operator-approved 2026-06-10):
 *   - sends ONLY from the operator's OWN connected inboxes assigned to this
 *     campaign (primary + any alt), brand-aware per inbox.
 *   - SKIPS + reports venues with no/invalid email, on the suppression list,
 *     DNC, or already cold-sent (T1) this campaign.
 *   - distributes across inboxes respecting each one's remaining cap today,
 *     spilling overflow to following days (warmup-aware), with jittered times.
 *
 * dryRun=true returns the plan (counts + skip reasons + schedule span) without
 * writing anything, so the confirm dialog can preview it.
 */

import {
  campaignConnectedAccounts,
  cityCampaigns,
  coldOutreachEntries,
  connectedAccounts,
  emailDrafts,
  emailSuppression,
  emailTemplates,
  emailValidations,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { warmupRampCap } from "@/lib/inbox-warmup";
import { logger } from "@/lib/logger";
import { loadSendUsage } from "@/lib/send-cap";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { validateEmailsBatch } from "@/lib/zerobounce";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Hard ceiling on a single Cold All batch (keeps the per-draft render bounded). */
const MAX_BATCH = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
});

export interface ColdAllSkips {
  noEmail: number;
  invalidEmail: number;
  suppressed: number;
  dnc: number;
  alreadyContacted: number;
  /** ZeroBounce returned a non-green verdict (invalid/spamtrap/abuse/etc). */
  failedValidation: number;
}

export interface ColdAllPlan {
  ok: true;
  dryRun: boolean;
  queued: number;
  byAccount: Array<{ email: string; count: number }>;
  skipped: ColdAllSkips;
  /** How many distinct days the schedule spans (1 = all today). */
  daySpan: number;
  firstSendAt: string | null;
  lastSendAt: string | null;
  /** Server-formatted (pinned tz) labels so the client renders plain strings
   *  -- no client-side date work, no hydration risk. */
  firstSendLabel: string | null;
  lastSendLabel: string | null;
  /** Dry-run only: emails not yet ZeroBounce-checked. They're validated on
   *  confirm and only the green ones are queued. */
  pendingValidation: number;
}

export type ColdAllResult = ColdAllPlan | { ok: false; error: string };

interface AccountPlan {
  id: string;
  email: string;
  brandId: string | null;
  remainingToday: number;
  dailyCap: number;
  warmupStartedAt: Date | null;
}

interface Survivor {
  entryId: string;
  venueId: string;
  venueName: string;
  email: string;
}

/** Run an async mapper over items with bounded concurrency (no deps). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item !== undefined) results[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

// Cold sends only land 9:00-21:00 Toronto time. A batch queued in the evening
// previously kept spacing 6-12 min into the middle of the night -- bad optics
// and worse deliverability than business-hours sends.
const SEND_WINDOW_START_H = 9;
const SEND_WINDOW_END_H = 21;
const TORONTO_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hourCycle: "h23",
  timeZone: "America/Toronto",
});
function torontoHour(ms: number): number {
  return Number(TORONTO_HOUR_FMT.format(new Date(ms)));
}
/** Advance a timestamp (30-min steps, DST-safe) until it falls inside the
 *  send window. Worst case one hop to the next morning. */
function clampToSendWindow(ms: number): number {
  let out = ms;
  for (let i = 0; i < 48; i++) {
    const h = torontoHour(out);
    if (h >= SEND_WINDOW_START_H && h < SEND_WINDOW_END_H) return out;
    out += 30 * 60_000;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Assign each account's share of venues to concrete send times: fill today up to
 * the account's remaining cap, then spill to following days (warmup-aware),
 * spacing sends 6-12 min apart with jitter. Returns scheduled times + the day
 * index of each, both aligned to the input order.
 */
function scheduleTimes(
  acct: AccountPlan,
  count: number,
  now: number,
): { times: Date[]; maxDay: number } {
  const times: Date[] = [];
  let maxDay = 0;
  let day = 0;
  let placedThisDay = 0;
  let dayCap = Math.max(0, acct.remainingToday);
  let cursor = now + (1 + Math.random() * 3) * 60_000; // start ~1-4 min out
  for (let i = 0; i < count; i++) {
    while (placedThisDay >= dayCap) {
      day += 1;
      placedThisDay = 0;
      const dayDate = new Date(now + day * DAY_MS);
      dayCap = Math.max(1, warmupRampCap(acct.warmupStartedAt, acct.dailyCap, dayDate));
      cursor = now + day * DAY_MS + (1 + Math.random() * 3) * 60_000;
    }
    cursor = clampToSendWindow(cursor); // never schedule into the night (Toronto)
    times.push(new Date(cursor));
    if (day > maxDay) maxDay = day;
    placedThisDay += 1;
    cursor += (6 + Math.random() * 6) * 60_000; // 6-12 min jittered gap
  }
  return { times, maxDay };
}

export async function coldAllSelectedVenues(input: {
  entryIds: string[];
  cityCampaignId: string;
  dryRun: boolean;
}): Promise<ColdAllResult> {
  const { staff } = await requireStaff();
  const entryIds = (input.entryIds ?? []).filter((s) => typeof s === "string" && s.length > 0);
  if (entryIds.length === 0) return { ok: false, error: "No venues selected." };
  if (entryIds.length > MAX_BATCH) {
    return { ok: false, error: `Select at most ${MAX_BATCH} venues per Cold All.` };
  }

  // 1. Campaign for this city-campaign.
  const [cc] = await db
    .select({ campaignId: cityCampaigns.campaignId })
    .from(cityCampaigns)
    .where(eq(cityCampaigns.id, input.cityCampaignId))
    .limit(1);
  const campaignId = cc?.campaignId ?? null;
  if (!campaignId) return { ok: false, error: "Couldn't resolve the campaign for this list." };

  // 2. The operator's OWN connected inboxes assigned to this campaign.
  const accountRows = await db
    .select({
      id: connectedAccounts.id,
      email: connectedAccounts.emailAddress,
      status: connectedAccounts.status,
      paused: connectedAccounts.coldSendsPaused,
      dailyCap: connectedAccounts.dailyColdSendCap,
      warmupStartedAt: connectedAccounts.warmupStartedAt,
      brandId: campaignConnectedAccounts.outreachBrandId,
    })
    .from(connectedAccounts)
    .innerJoin(
      campaignConnectedAccounts,
      and(
        eq(campaignConnectedAccounts.connectedAccountId, connectedAccounts.id),
        eq(campaignConnectedAccounts.campaignId, campaignId),
      ),
    )
    .where(
      and(
        eq(connectedAccounts.ownerUserId, staff.id),
        eq(connectedAccounts.teamId, staff.teamId),
        eq(connectedAccounts.status, "connected"),
      ),
    );
  // Dedupe by connected account: a duplicate campaign_connected_accounts row
  // (it has no unique constraint on campaign+account) would otherwise count
  // one inbox twice -- doubling its planned share today. Prefer the row that
  // carries a brand so the T1 stays brand-matched.
  const accountById = new Map<string, (typeof accountRows)[number]>();
  for (const a of accountRows) {
    const prev = accountById.get(a.id);
    if (!prev || (!prev.brandId && a.brandId)) accountById.set(a.id, a);
  }
  const usableAccounts = [...accountById.values()].filter((a) => !a.paused);
  if (usableAccounts.length === 0) {
    return {
      ok: false,
      error:
        "You have no connected, un-paused inbox assigned to this campaign. Assign one on /campaign-info first.",
    };
  }

  // Remaining capacity today per inbox (warmup-aware, via the cap engine).
  const accounts: AccountPlan[] = [];
  for (const a of usableAccounts) {
    const usage = await loadSendUsage(a.id);
    accounts.push({
      id: a.id,
      email: a.email,
      brandId: a.brandId,
      remainingToday: Math.max(0, usage.remaining),
      dailyCap: a.dailyCap,
      warmupStartedAt: a.warmupStartedAt,
    });
  }

  // 3. Selected entries -> venue + email + flags.
  const entryRows = await db
    .select({
      entryId: coldOutreachEntries.id,
      status: coldOutreachEntries.status,
      venueId: venues.id,
      venueName: venues.name,
      email: venues.email,
      doNotContact: venues.doNotContact,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .where(
      and(
        inArray(coldOutreachEntries.id, entryIds),
        eq(coldOutreachEntries.cityCampaignId, input.cityCampaignId),
        isNull(coldOutreachEntries.archivedAt),
      ),
    );

  // 4. Dedup signal: venues that already have a T1 draft (sent or queued) here.
  const venueIds = entryRows.map((r) => r.venueId);
  const existingT1 =
    venueIds.length === 0
      ? []
      : await db
          .select({ venueId: emailDrafts.venueId })
          .from(emailDrafts)
          .where(
            and(
              inArray(emailDrafts.venueId, venueIds),
              eq(emailDrafts.cityCampaignId, input.cityCampaignId),
              eq(emailDrafts.touchType, "T1"),
            ),
          );
  const alreadyT1 = new Set(existingT1.map((r) => r.venueId).filter((v): v is string => !!v));

  // 5. Suppression set for the candidate emails (case-insensitive).
  const candidateEmails = entryRows.map((r) => r.email?.trim()).filter((e): e is string => !!e);
  const emailVariants = [...new Set(candidateEmails.flatMap((e) => [e, e.toLowerCase()]))];
  const suppRows =
    emailVariants.length === 0
      ? []
      : await db
          .select({ email: emailSuppression.email })
          .from(emailSuppression)
          .where(inArray(emailSuppression.email, emailVariants));
  const suppressed = new Set(suppRows.map((r) => r.email.toLowerCase()));

  // 6. Filter -> survivors + skip tally.
  const skipped: ColdAllSkips = {
    noEmail: 0,
    invalidEmail: 0,
    suppressed: 0,
    dnc: 0,
    alreadyContacted: 0,
    failedValidation: 0,
  };
  const survivors: Survivor[] = [];
  for (const r of entryRows) {
    if (r.doNotContact) {
      skipped.dnc += 1;
      continue;
    }
    if (alreadyT1.has(r.venueId) || r.status !== "not_contacted") {
      skipped.alreadyContacted += 1;
      continue;
    }
    const email = r.email?.trim() ?? "";
    if (!email) {
      skipped.noEmail += 1;
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      skipped.invalidEmail += 1;
      continue;
    }
    if (suppressed.has(email.toLowerCase())) {
      skipped.suppressed += 1;
      continue;
    }
    survivors.push({ entryId: r.entryId, venueId: r.venueId, venueName: r.venueName, email });
  }

  // 6b. ZeroBounce gate -- only queue emails ZeroBounce marks "valid" (green),
  //     so we never send to a bounce-prone address (the #1 deliverability risk).
  //     Dry-run uses cached verdicts only (free, fast); the real run validates
  //     any un-checked emails first, then queues only the green ones.
  let pendingValidation = 0;
  const greenSurvivors: Survivor[] = [];
  if (survivors.length > 0) {
    const lowerEmails = [...new Set(survivors.map((s) => s.email.toLowerCase()))];
    const valMap = new Map<string, string>();
    const loadVerdicts = async (emails: string[]) => {
      if (emails.length === 0) return;
      const rows = await db
        .select({ email: emailValidations.email, status: emailValidations.status })
        .from(emailValidations)
        .where(inArray(emailValidations.email, emails));
      for (const r of rows) valMap.set(r.email.toLowerCase(), r.status);
    };
    await loadVerdicts(lowerEmails);
    if (!input.dryRun) {
      const uncached = lowerEmails.filter((e) => !valMap.has(e));
      if (uncached.length > 0) {
        // ZeroBounce validates one email per API call; fully sequential this
        // was ~0.5s x N and a 400-venue batch blew past the proxy timeout.
        // Chunk + 4 concurrent workers keeps it polite but bounded.
        const chunks: string[][] = [];
        for (let i = 0; i < uncached.length; i += 10) chunks.push(uncached.slice(i, i + 10));
        await mapWithConcurrency(chunks, 4, (c) => validateEmailsBatch(c, staff.id));
        await loadVerdicts(uncached);
      }
    }
    for (const s of survivors) {
      const status = valMap.get(s.email.toLowerCase());
      if (status === "valid") greenSurvivors.push(s);
      else if (status === undefined)
        pendingValidation += 1; // dry-run: not yet checked (validated on confirm)
      else skipped.failedValidation += 1;
    }
  }

  // 7. Round-robin the green survivors across the operator's inboxes, then
  //    schedule each inbox's share (fill today, spill to later days).
  const now = Date.now();
  const perAccount: Array<{ acct: AccountPlan; items: Survivor[] }> = accounts.map((acct) => ({
    acct,
    items: [],
  }));
  greenSurvivors.forEach((s, i) => {
    const bucket = perAccount[i % perAccount.length];
    if (bucket) bucket.items.push(s);
  });

  interface Planned extends Survivor {
    accountId: string;
    brandId: string | null;
    scheduledFor: Date;
  }
  const planned: Planned[] = [];
  let maxDay = 0;
  for (const pa of perAccount) {
    if (pa.items.length === 0) continue;
    const { times, maxDay: d } = scheduleTimes(pa.acct, pa.items.length, now);
    if (d > maxDay) maxDay = d;
    pa.items.forEach((s, i) => {
      const when = times[i];
      if (!when) return;
      planned.push({
        ...s,
        accountId: pa.acct.id,
        brandId: pa.acct.brandId,
        scheduledFor: when,
      });
    });
  }

  const byAccount = perAccount
    .filter((pa) => pa.items.length > 0)
    .map((pa) => ({ email: pa.acct.email, count: pa.items.length }));
  const sortedTimes = planned.map((p) => p.scheduledFor.getTime()).sort((a, b) => a - b);
  const firstMs = sortedTimes[0];
  const lastMs = sortedTimes[sortedTimes.length - 1];
  const plan: ColdAllPlan = {
    ok: true,
    dryRun: input.dryRun,
    queued: planned.length,
    byAccount,
    skipped,
    daySpan: planned.length > 0 ? maxDay + 1 : 0,
    firstSendAt: firstMs != null ? new Date(firstMs).toISOString() : null,
    lastSendAt: lastMs != null ? new Date(lastMs).toISOString() : null,
    firstSendLabel: firstMs != null ? SEND_LABEL_FMT.format(new Date(firstMs)) : null,
    lastSendLabel: lastMs != null ? SEND_LABEL_FMT.format(new Date(lastMs)) : null,
    pendingValidation,
  };

  if (input.dryRun || planned.length === 0) return plan;

  // 8. Resolve the T1 template per brand (prefer brand+campaign, then brand-
  //    global, then any T1).
  const t1Rows = await db
    .select({
      id: emailTemplates.id,
      brandId: emailTemplates.outreachBrandId,
      campaignId: emailTemplates.campaignId,
      subjectTemplate: emailTemplates.subjectTemplate,
      bodyTemplateText: emailTemplates.bodyTemplateText,
    })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.templateCode, "T1"), isNull(emailTemplates.archivedAt)))
    // Deterministic order: with no ORDER BY the no-brand fallback below picked
    // whatever row Postgres returned first (an arbitrary brand's T1).
    .orderBy(emailTemplates.createdAt, emailTemplates.id);
  // Fallback for a brand-less inbox: prefer this campaign's T1 over a random
  // brand's global row.
  const defaultT1 = t1Rows.find((t) => t.campaignId === campaignId) ?? t1Rows[0];
  if (!defaultT1) return { ok: false, error: "No T1 template is configured." };
  const pickT1 = (brandId: string | null): (typeof t1Rows)[number] => {
    if (brandId) {
      const exact = t1Rows.find((t) => t.brandId === brandId && t.campaignId === campaignId);
      if (exact) return exact;
      const brandGlobal = t1Rows.find((t) => t.brandId === brandId);
      if (brandGlobal) return brandGlobal;
    }
    return defaultT1;
  };

  // 9. Render + insert drafts, mark entries emailed. Rendering reuses the same
  //    merge path as the composer so {{company_name}}/{{your_name}}/
  //    {{signature_block}} resolve to the sending inbox's brand + alias.
  // Merge-context building is several queries per venue; sequential it was the
  // dominant cost (a 400-venue batch ran minutes and risked the proxy timeout).
  // Bounded concurrency keeps order via index mapping.
  const draftValues: (typeof emailDrafts.$inferInsert)[] = await mapWithConcurrency(
    planned,
    8,
    async (p) => {
      const tpl = pickT1(p.brandId);
      const fields = await buildFlatMergeContext({
        venueId: p.venueId,
        campaignId,
        cityCampaignId: input.cityCampaignId,
        staffId: staff.id,
        sendingAccountId: p.accountId,
      });
      const subject = renderTemplate(tpl.subjectTemplate, fields).output;
      const bodyText = renderTemplate(tpl.bodyTemplateText, fields).output;
      return {
        teamId: staff.teamId,
        ownerUserId: staff.id,
        connectedAccountId: p.accountId,
        toAddresses: [p.email],
        subject,
        bodyText,
        bodyHtml: textToHtml(bodyText),
        venueId: p.venueId,
        cityCampaignId: input.cityCampaignId,
        templateId: tpl.id,
        scheduledFor: p.scheduledFor,
        sendMode: "operator_scheduled",
        requiresHumanApproval: false,
        approvedByStaffId: staff.id,
        approvedAt: new Date(),
        autoSendAllowed: false,
        recipientType: "venue",
        touchType: "T1",
      };
    },
  );

  const queuedEntryIds = planned.map((p) => p.entryId);
  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.insert(emailDrafts).values(draftValues);
      await tx
        .update(coldOutreachEntries)
        .set({ status: "email_sent", lastTouchAt: new Date(), updatedBy: staff.id })
        .where(inArray(coldOutreachEntries.id, queuedEntryIds));
    });
  } catch (err) {
    logger.error({ err, count: draftValues.length }, "coldAllSelectedVenues insert failed");
    return { ok: false, error: "Failed to queue the cold emails. See server logs." };
  }

  // Tracker auto-assign: bulk-scheduling a city's cold outreach claims the
  // city for this operator IF unassigned (mirrors queueColdSend; never
  // steals an existing assignment). Best-effort.
  try {
    await db
      .update(cityCampaigns)
      .set({ leadStaffId: staff.id, updatedBy: staff.id })
      .where(and(eq(cityCampaigns.id, input.cityCampaignId), isNull(cityCampaigns.leadStaffId)));
  } catch (err) {
    logger.warn({ err }, "coldAll: tracker auto-assign skipped (non-fatal)");
  }

  logger.info(
    { queued: planned.length, accounts: byAccount.length, daySpan: plan.daySpan, by: staff.id },
    "Cold All queued",
  );
  revalidatePath(`/city-campaigns/${input.cityCampaignId}`);
  revalidatePath("/email-queue");
  return plan;
}

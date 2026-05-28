import "server-only";

/**
 * Composer data loader.
 *
 * For the send composer on venue detail page: given a logged-in staff
 * member and a list of outreach brands, returns per-brand:
 *   - all active email templates
 *   - whether THIS staffer has a connected Gmail inbox for THIS brand
 *   - the current throttle status (effective cap, sent today, etc.)
 *
 * One pass per brand. Templates + inbox-row come from indexed queries;
 * throttle status is computed via lib/send-throttle.canSendNow.
 */

import { emailTemplates, staffOutreachEmails } from "@/db/schema";
import { db } from "@/lib/db";
import { isGmailOAuthConfigured } from "@/lib/gmail";
import { canSendNow } from "@/lib/send-throttle";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

export interface ComposerTemplate {
  id: string;
  name: string;
  stage: string;
  subjectTemplate: string;
  bodyTemplateText: string;
  bodyTemplateHtml: string | null;
}

export interface ComposerInbox {
  inboxId: string | null;
  emailAddress: string | null;
  mode: "live" | "dev" | "no_inbox";
  throttleOk: boolean;
  throttleMessage?: string;
  effectiveDailyCap?: number;
  sent24h?: number;
  warmupDay?: number | null;
}

export interface ComposerBrandConfig {
  templates: ComposerTemplate[];
  /** Default (first, alphabetical) connected inbox — back-compat single value. */
  inbox: ComposerInbox;
  /** All connected inboxes for this brand. Empty when none connected. */
  inboxes: ComposerInbox[];
}

export async function loadComposerData(opts: {
  staffMemberId: string;
  outreachBrandIds: string[];
}): Promise<Record<string, ComposerBrandConfig>> {
  const { staffMemberId, outreachBrandIds } = opts;
  if (outreachBrandIds.length === 0) return {};

  // Pull all templates for all brands in one query
  const allTemplates = await db
    .select({
      id: emailTemplates.id,
      outreachBrandId: emailTemplates.outreachBrandId,
      name: emailTemplates.name,
      stage: emailTemplates.stage,
      subjectTemplate: emailTemplates.subjectTemplate,
      bodyTemplateText: emailTemplates.bodyTemplateText,
      bodyTemplateHtml: emailTemplates.bodyTemplateHtml,
    })
    .from(emailTemplates)
    .where(
      and(
        inArray(emailTemplates.outreachBrandId, outreachBrandIds),
        isNull(emailTemplates.archivedAt),
      ),
    )
    .orderBy(asc(emailTemplates.name));

  const templatesByBrand = new Map<string, ComposerTemplate[]>();
  for (const t of allTemplates) {
    const list = templatesByBrand.get(t.outreachBrandId) ?? [];
    list.push({
      id: t.id,
      name: t.name,
      stage: t.stage,
      subjectTemplate: t.subjectTemplate,
      bodyTemplateText: t.bodyTemplateText,
      bodyTemplateHtml: t.bodyTemplateHtml,
    });
    templatesByBrand.set(t.outreachBrandId, list);
  }

  // Pull this staff member's connected inboxes for all brands at once
  const inboxes = await db
    .select({
      id: staffOutreachEmails.id,
      outreachBrandId: staffOutreachEmails.outreachBrandId,
      emailAddress: staffOutreachEmails.emailAddress,
      status: staffOutreachEmails.status,
      hasRefreshToken: staffOutreachEmails.gmailOauthRefreshToken,
    })
    .from(staffOutreachEmails)
    .where(
      and(
        eq(staffOutreachEmails.staffMemberId, staffMemberId),
        inArray(staffOutreachEmails.outreachBrandId, outreachBrandIds),
      ),
    );

  const inboxesByBrand = new Map<string, typeof inboxes>();
  for (const i of inboxes) {
    const list = inboxesByBrand.get(i.outreachBrandId) ?? [];
    list.push(i);
    inboxesByBrand.set(i.outreachBrandId, list);
  }

  // For each connected inbox, query throttle status in parallel
  const throttleByInbox = new Map<string, Awaited<ReturnType<typeof canSendNow>>>();
  await Promise.all(
    inboxes
      .filter((i) => i.status === "connected")
      .map(async (i) => {
        try {
          const result = await canSendNow({ staffOutreachEmailId: i.id });
          throttleByInbox.set(i.id, result);
        } catch {
          /* ignore */
        }
      }),
  );

  const oauthConfigured = isGmailOAuthConfigured();

  // Turn one connected inbox row into the composer's view of it.
  function toComposerInbox(raw: (typeof inboxes)[number]): ComposerInbox {
    const throttle = throttleByInbox.get(raw.id);
    const live = oauthConfigured && !!raw.hasRefreshToken;
    return {
      inboxId: raw.id,
      emailAddress: raw.emailAddress,
      mode: live ? "live" : "dev",
      throttleOk: throttle?.ok ?? !live,
      throttleMessage: throttle?.ok ? undefined : throttle?.reason,
      effectiveDailyCap: throttle?.ok ? throttle.effectiveDailyCap : undefined,
      sent24h: throttle?.ok ? throttle.sent24h : undefined,
      warmupDay: throttle?.ok ? throttle.warmupDay : undefined,
    };
  }

  const NO_INBOX: ComposerInbox = {
    inboxId: null,
    emailAddress: null,
    mode: "no_inbox",
    throttleOk: true, // dev-mode logging — no throttle restriction
  };

  // Assemble result
  const out: Record<string, ComposerBrandConfig> = {};
  for (const brandId of outreachBrandIds) {
    const connectedRaws = (inboxesByBrand.get(brandId) ?? [])
      .filter((i) => i.status === "connected")
      .sort((a, b) => a.emailAddress.localeCompare(b.emailAddress));
    const composerInboxes = connectedRaws.map(toComposerInbox);

    out[brandId] = {
      templates: templatesByBrand.get(brandId) ?? [],
      inbox: composerInboxes[0] ?? NO_INBOX,
      inboxes: composerInboxes,
    };
  }

  return out;
}

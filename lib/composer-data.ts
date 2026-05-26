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
  inbox: ComposerInbox;
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

  const inboxByBrand = new Map(inboxes.map((i) => [i.outreachBrandId, i]));

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

  // Assemble result
  const out: Record<string, ComposerBrandConfig> = {};
  for (const brandId of outreachBrandIds) {
    const inbox = inboxByBrand.get(brandId);
    const throttle = inbox ? throttleByInbox.get(inbox.id) : undefined;

    let composerInbox: ComposerInbox;
    if (!inbox || inbox.status !== "connected") {
      composerInbox = {
        inboxId: null,
        emailAddress: null,
        mode: "no_inbox",
        throttleOk: true, // dev-mode logging — no throttle restriction
      };
    } else if (!oauthConfigured || !inbox.hasRefreshToken) {
      composerInbox = {
        inboxId: inbox.id,
        emailAddress: inbox.emailAddress,
        mode: "dev",
        throttleOk: throttle?.ok ?? true,
        throttleMessage: throttle?.ok ? undefined : throttle?.reason,
        effectiveDailyCap: throttle?.ok ? throttle.effectiveDailyCap : undefined,
        sent24h: throttle?.ok ? throttle.sent24h : undefined,
        warmupDay: throttle?.ok ? throttle.warmupDay : undefined,
      };
    } else {
      composerInbox = {
        inboxId: inbox.id,
        emailAddress: inbox.emailAddress,
        mode: "live",
        throttleOk: throttle?.ok ?? false,
        throttleMessage: throttle?.ok ? undefined : throttle?.reason,
        effectiveDailyCap: throttle?.ok ? throttle.effectiveDailyCap : undefined,
        sent24h: throttle?.ok ? throttle.sent24h : undefined,
        warmupDay: throttle?.ok ? throttle.warmupDay : undefined,
      };
    }

    out[brandId] = {
      templates: templatesByBrand.get(brandId) ?? [],
      inbox: composerInbox,
    };
  }

  return out;
}

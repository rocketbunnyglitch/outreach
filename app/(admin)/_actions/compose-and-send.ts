"use server";

/**
 * Shared "compose new email" pipeline.
 *
 * Used by:
 *   - cold-outreach table mail button (one-off venue outreach)
 *   - venue summary strip "Email" button
 *   - any future "send mail to this address" UI
 *
 * Distinct from sendThreadReply: this one CREATES a new thread (no
 * existing Gmail threadId, no in-reply-to). It still goes through
 * lib/gmail.sendGmailMessage so the message lands in the operator's
 * Sent folder and the same poll-worker / state machine picks it up
 * on the next cycle as an outbound thread.
 *
 * The send-from inbox is chosen by the user from the modal — never
 * inferred — so a multi-account user always sees which Gmail they're
 * sending from.
 */

import {
  campaigns,
  cities,
  cityCampaigns,
  connectedAccounts,
  emailMessages,
  emailTemplates,
  emailThreads,
  outreachBrands,
  users,
  venues,
} from "@/db/schema";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchGmailContacts } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import type { SendUsage } from "@/lib/send-cap";
import { startOfLocalDay } from "@/lib/send-cap";
import type {
  DncBlock,
  DuplicateWarning,
  SafetyWarning,
  SuppressionBlock,
} from "@/lib/send-safety";
import { type TeamLabelSummary, ensureTeamLabel, listTeamLabels } from "@/lib/team-labels";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConnectedAccountOption {
  id: string;
  emailAddress: string;
  ownerDisplayName: string | null;
  /** "mine" if owned by current user; "team" otherwise. UI uses this
   *  to group + sort the dropdown so the user's own accounts come first. */
  scope: "mine" | "team";
  status: "connected" | "needs_reauth" | "disconnected";
  /** Optional signature HTML configured for this inbox. The composer
   *  auto-appends it on send if the operator hasn't already inlined
   *  a different signature in the draft. NULL = no signature. */
  signatureHtml: string | null;
  /** Cold sends used today on this account (operator-tz-aware day).
   *  Surfaced beside each option in the From picker so the operator
   *  can see remaining headroom before they pick. */
  coldSendsUsed: number;
  /** Daily cap (connected_accounts.daily_cold_send_cap). */
  coldSendCap: number;
  /** True when used >= cap. UI uses this to grey the option +
   *  block cold-outreach sends. */
  atCap: boolean;
  /** ISO expiry of the cold-send pacing cooldown (migration 0106), or null
   *  when none is active. Drives the composer's countdown ring. */
  coldSendCooldownUntil: string | null;
}

/**
 * List every connected Gmail account on the current user's team that
 * is sendable. Sorted: mine first (alpha), then team (alpha).
 * Excludes disconnected accounts since they can't send.
 */
export async function listSendableInboxes(): Promise<ConnectedAccountOption[]> {
  const { staff } = await requireStaff();

  const rows = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      ownerUserId: connectedAccounts.ownerUserId,
      status: connectedAccounts.status,
      signatureHtml: connectedAccounts.signatureHtml,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.teamId, staff.teamId));

  // Filter + classify in JS — the team's connected-accounts list is
  // small (under 20 even at full team size).
  const usable = rows.filter((r) => r.status === "connected" || r.status === "needs_reauth");

  // Fetch owner display names in one Drizzle query — tiny set, cheap.
  const ownerIds = Array.from(
    new Set(usable.map((r) => r.ownerUserId).filter(Boolean) as string[]),
  );
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];

  const ownerNameMap = new Map<string, string | null>();
  for (const o of ownerRows) ownerNameMap.set(o.id, o.displayName ?? null);

  // Cold-send usage today, one GROUP BY across email_send_events. We
  // use the operator's tz to anchor "today" so it matches what
  // the rest of the UI shows. Same shape as lib/visible-accounts so
  // the AccountSwitcher dropdown + the composer's From picker agree
  // on the numbers.
  const startOfDay = startOfLocalDay(staff.timezone ?? null);
  const usageMap = new Map<string, number>();
  if (usable.length > 0) {
    const usage = await db.execute<{ account_id: string; used: number }>(sql`
      SELECT
        connected_account_id AS account_id,
        COUNT(*) FILTER (WHERE category = 'cold' AND counted_against_cap = true)::int AS used
      FROM email_send_events
      WHERE sent_at >= ${startOfDay}
      GROUP BY connected_account_id
    `);
    const list = Array.isArray(usage)
      ? (usage as unknown as Array<{ account_id: string; used: number }>)
      : ((usage as unknown as { rows: Array<{ account_id: string; used: number }> }).rows ?? []);
    for (const r of list) usageMap.set(r.account_id, Number(r.used ?? 0));
  }

  // Pull cap from connected_accounts for each row. The usable rows
  // already have it via the initial select — but we didn't carry it.
  // Re-fetch in one go.
  const capMap = new Map<string, number>();
  const cooldownMap = new Map<string, string | null>();
  if (usable.length > 0) {
    const capRows = await db
      .select({
        id: connectedAccounts.id,
        cap: connectedAccounts.dailyColdSendCap,
        cooldownUntil: connectedAccounts.coldSendCooldownUntil,
      })
      .from(connectedAccounts)
      .where(
        inArray(
          connectedAccounts.id,
          usable.map((r) => r.id),
        ),
      );
    for (const c of capRows) {
      capMap.set(c.id, c.cap ?? 30);
      // Surface only a still-active (future) cold-send cooldown (migration 0106).
      cooldownMap.set(
        c.id,
        c.cooldownUntil && c.cooldownUntil.getTime() > Date.now()
          ? c.cooldownUntil.toISOString()
          : null,
      );
    }
  }

  const opts: ConnectedAccountOption[] = usable.map((r) => {
    const cap = capMap.get(r.id) ?? 30;
    const used = usageMap.get(r.id) ?? 0;
    return {
      id: r.id,
      emailAddress: r.emailAddress,
      ownerDisplayName: r.ownerUserId ? (ownerNameMap.get(r.ownerUserId) ?? null) : null,
      scope: r.ownerUserId === staff.id ? "mine" : "team",
      status: r.status as ConnectedAccountOption["status"],
      signatureHtml: r.signatureHtml ?? null,
      coldSendsUsed: used,
      coldSendCap: cap,
      atCap: used >= cap,
      coldSendCooldownUntil: cooldownMap.get(r.id) ?? null,
    };
  });

  opts.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "mine" ? -1 : 1;
    return a.emailAddress.localeCompare(b.emailAddress);
  });

  return opts;
}

/**
 * Bundle the modal's lazy-load: inboxes + team labels in one
 * round trip so the compose modal doesn't have to make two calls
 * the first time it opens.
 */
export interface ComposeTemplate {
  id: string;
  name: string;
  /** e.g. T1, T7A, H0a, V1 -- drives the logical dropdown order. */
  templateCode: string;
  stage: string;
  brandId: string;
  brandName: string;
  isDefaultForStage: boolean;
  /** Raw subject template (Mustache-style merge fields). */
  subjectTemplate: string;
  /** Raw text body template. */
  bodyTemplateText: string;
}

/**
 * Natural order for template codes so the picker reads logically: T<n> first
 * by number (T1 cold opener -> T2 follow-up -> ... -> T17), then H (host) then
 * V (venue) families, then anything else. Suffix breaks ties (T7A < T7B,
 * T9-far < T9-near).
 */
function compareTemplateCode(a: string, b: string): number {
  const parse = (code: string): [number, number, string] => {
    const m = code.match(/^([A-Za-z]+)(\d+)(.*)$/);
    const prefix = (m?.[1] ?? code).toUpperCase();
    const num = m ? Number(m[2]) : Number.MAX_SAFE_INTEGER;
    const suffix = m?.[3] ?? "";
    const rank = prefix === "T" ? 0 : prefix === "H" ? 1 : prefix === "V" ? 2 : 3;
    return [rank, num, suffix];
  };
  const [ar, an, asfx] = parse(a);
  const [br, bn, bsfx] = parse(b);
  return ar - br || an - bn || asfx.localeCompare(bsfx);
}

/**
 * The composer's render context is the engine's flat merge-field map (see
 * lib/template-merge-context). Every known {{field}} resolves from real data;
 * fields that don't apply to the context are blank, never broken markers.
 */
export type ComposeRenderContext = Record<string, string>;

export async function listComposeContext(
  opts: {
    venueId?: string | null;
    /** City-campaign the composer is attributed to -- scopes crawls/slots and
     *  resolves the campaign for company_name + the T7A/T7B insert block. */
    cityCampaignId?: string | null;
    /** Sending email -> its per-campaign brand for {{company_name}}. */
    sendingAccountId?: string | null;
  } = {},
): Promise<{
  inboxes: ConnectedAccountOption[];
  labels: TeamLabelSummary[];
  templates: ComposeTemplate[];
  renderContext: ComposeRenderContext;
  /** Team-label ids to pre-select on a fresh campaign-attributed draft (the
   *  campaign Gmail label + the venue's city), so the operator sees what the
   *  send will tag. Empty when there's no campaign attribution / label. */
  defaultLabelIds: string[];
}> {
  const { staff } = await requireStaff();
  const [inboxes, labels, templateRows] = await Promise.all([
    listSendableInboxes(),
    listTeamLabels(staff.teamId),
    // Templates are scoped to outreach_brands, which are global (not
    // team-scoped — every team picks among the same brand catalog).
    // We surface every non-archived template; the picker UI groups by
    // (brand, stage) so the operator finds the right one fast.
    db
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        templateCode: emailTemplates.templateCode,
        stage: emailTemplates.stage,
        brandId: emailTemplates.outreachBrandId,
        brandName: outreachBrands.displayName,
        isDefaultForStage: emailTemplates.isDefaultForStage,
        subjectTemplate: emailTemplates.subjectTemplate,
        bodyTemplateText: emailTemplates.bodyTemplateText,
      })
      .from(emailTemplates)
      .innerJoin(outreachBrands, eq(outreachBrands.id, emailTemplates.outreachBrandId))
      .where(isNull(emailTemplates.archivedAt))
      .orderBy(
        asc(outreachBrands.displayName),
        asc(emailTemplates.stage),
        // Default-first within each (brand, stage) group so the
        // picker's first entry is the recommended one.
        desc(emailTemplates.isDefaultForStage),
        asc(emailTemplates.name),
      ),
  ]);

  // Resolve the campaign from the city-campaign so company_name + the insert
  // block load correctly, then build the engine's flat merge-field map. Also
  // grab the campaign's Gmail label + the venue's city name so we can pre-tag a
  // fresh campaign-attributed draft (visibility for what the send auto-applies).
  let campaignId: string | null = null;
  let campaignGmailLabel: string | null = null;
  let attributedCityName: string | null = null;
  if (opts.cityCampaignId && UUID_RE.test(opts.cityCampaignId)) {
    const [cc] = await db
      .select({
        campaignId: cityCampaigns.campaignId,
        gmailLabel: campaigns.outreachGmailLabel,
        cityName: cities.name,
      })
      .from(cityCampaigns)
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(eq(cityCampaigns.id, opts.cityCampaignId))
      .limit(1);
    campaignId = cc?.campaignId ?? null;
    campaignGmailLabel = cc?.gmailLabel ?? null;
    attributedCityName = cc?.cityName ?? null;
  }

  // Default the sending email to the composer's default From (first inbox) so
  // {{your_name}} (alias) + {{company_name}} (brand) resolve on first load,
  // before the operator has explicitly picked a From.
  const sendingAccountId = opts.sendingAccountId ?? inboxes[0]?.id ?? null;
  const renderContext = await buildFlatMergeContext({
    venueId: opts.venueId ?? null,
    campaignId,
    cityCampaignId: opts.cityCampaignId ?? null,
    staffId: staff.id,
    sendingAccountId,
  });

  // Logical dropdown order: T-codes by number first (T1 cold opener -> T17),
  // then H (host) then V (venue) families. All templates share stage='custom'
  // + the same auto_pick_priority, so the SQL ORDER BY can't differentiate
  // them; sort by a natural reading of the code here. Brand stays the primary
  // group so a multi-brand catalog still clusters by brand.
  templateRows.sort(
    (a, b) =>
      a.brandName.localeCompare(b.brandName) || compareTemplateCode(a.templateCode, b.templateCode),
  );

  // Pre-tag visibility: ensure the campaign's Gmail label + the venue's city
  // label exist and return their ids so the composer can pre-select them on a
  // fresh campaign-attributed draft. The operator then SEES "halloween 2026" +
  // city in the Label control before sending -- matching what the send pipeline
  // auto-applies. No campaign attribution / no configured label -> empty, so
  // the control reads "none" and the operator knows it WON'T be tagged.
  const defaultLabelIds: string[] = [];
  const labelNames = [campaignGmailLabel, attributedCityName]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  for (const name of labelNames) {
    try {
      const { id } = await ensureTeamLabel({ teamId: staff.teamId, name, createdBy: staff.id });
      if (!defaultLabelIds.includes(id)) defaultLabelIds.push(id);
      if (!labels.some((l) => l.id === id)) labels.push({ id, name, color: null });
    } catch (err) {
      logger.warn({ err, name }, "listComposeContext: ensureTeamLabel for pre-tag failed");
    }
  }

  return { inboxes, labels, templates: templateRows, renderContext, defaultLabelIds };
}

export type ComposeResult =
  | { ok: true; threadId: string }
  | {
      ok: false;
      error: string;
      /** Set when the failure was the daily cold-send cap. UI shows
       *  a "Bypass cap" button (admins only). */
      capBlocked?: boolean;
      usage?: SendUsage;
      /** Set when the venue x sending-brand relationship is flagged 'bad'
       *  (Phase 3.10). Hard-blocked for non-admins; admins override via the
       *  same bypassCap path. */
      relationshipBlocked?: boolean;
      /** Set when the send had no classified intent (a venue email with no
       *  template/touch + not a reply). Hard-blocked for non-admins; admins
       *  override via the same bypassCap path. "Every send has explicit intent." */
      intentAmbiguous?: boolean;
      /** Set when a cold-send pacing cooldown blocked the send (migration
       *  0106). The composer shows the countdown ring; admins bypass via the
       *  same path as the cap. cooldownUntil is the ISO expiry. */
      cooldownBlocked?: boolean;
      cooldownUntil?: string | null;
      /** Set when the cadence floor / hard cap blocked the send (Phase 1.9).
       *  Admins can retry with a cadenceOverrideReason; non-admins are
       *  hard-blocked. The composer UI surfaces this in Phase 2.10. */
      cadenceBlocked?: boolean;
      cadence?: {
        reason: string | null;
        earliestAllowedAt: string | null;
        totalTouchCount: number;
        hardCapReached: boolean;
      };
      /** Set when a hard block (suppression or DNC) blocked the send.
       *  No bypass — operator must fix the underlying state
       *  (un-suppress / clear DNC) before retrying. */
      safetyBlock?: SuppressionBlock | DncBlock;
      /** Set when the send is OK but there are pre-send safety
       *  warnings the operator must acknowledge. UI shows a confirm
       *  step that re-submits with ackDuplicates=1. The field is
       *  named `safetyWarnings` and carries both duplicate
       *  warnings (DuplicateWarning) and recent-decline warnings
       *  (RecentDeclineWarning) — both kinds are produced by
       *  lib/send-safety and acknowledged with the same form
       *  field, since the operator's "I know, send anyway" is a
       *  single decision either way. The old field name
       *  `duplicateWarnings` is kept as an alias for backwards
       *  compatibility with existing client code that only knows
       *  about the duplicate kind; new code should read
       *  safetyWarnings. */
      safetyWarnings?: SafetyWarning[];
      /** @deprecated use safetyWarnings (which includes duplicate
       *  warnings AND recent-decline warnings). Kept so existing
       *  composer-window.tsx code path keeps compiling without a
       *  rip-and-replace; we populate both. */
      duplicateWarnings?: DuplicateWarning[];
      /** Set when a reply was attempted from a connected account
       *  that doesn't match the thread's account. UI surfaces this
       *  as a clear "wrong inbox" warning. Admins can bypass via
       *  the bypassCap form field. */
      wrongAccountBlocked?: boolean;
      /** Email of the inbox that owns the thread (the "right" one
       *  for replies). Set alongside wrongAccountBlocked. */
      threadAccountEmail?: string;
      /** Email of the inbox the operator picked in the From
       *  dropdown. Set alongside wrongAccountBlocked. */
      chosenAccountEmail?: string;
    };

/**
 * Send a brand-new email from a chosen connected inbox. Creates a
 * fresh thread row in our DB so the operator can track replies.
 *
 * Args (FormData):
 *   fromAccountId  — connected_accounts.id (must be on user's team)
 *   to             — recipient email
 *   subject        — string (non-empty)
 *   body           — plain text; converted to light HTML for the
 *                    Gmail send (paragraphs from blank-line breaks,
 *                    newlines to <br>)
 *   venueId?       — optional UUID. When set, the new thread is
 *                    attributed to that venue. When absent, thread
 *                    has venueId = null (operator can attach later).
 */
export async function composeAndSend(_prev: unknown, formData: FormData): Promise<ComposeResult> {
  const { staff } = await requireStaff();
  const { composeAndSendImpl } = await import("@/lib/compose-send-impl");
  return composeAndSendImpl(staff, formData);
}

/**
 * Update the signature for a connected inbox.
 *
 * Auth: must be the inbox owner OR a team admin. The action checks
 * both via the joined query rather than two separate fetches.
 *
 * Returns the new signature (passed back so the UI can confirm
 * without re-fetching).
 */
export async function setInboxSignature(input: {
  connectedAccountId: string;
  signatureHtml: string | null;
}): Promise<{ ok: true; signatureHtml: string | null } | { ok: false; error: string }> {
  const { staff } = await requireStaff();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(input.connectedAccountId)) {
    return { ok: false, error: "Invalid inbox id." };
  }

  const [row] = await db
    .select({
      id: connectedAccounts.id,
      teamId: connectedAccounts.teamId,
      ownerUserId: connectedAccounts.ownerUserId,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, input.connectedAccountId))
    .limit(1);
  if (!row || row.teamId !== staff.teamId) {
    return { ok: false, error: "Inbox not on your team." };
  }
  // Owner of the inbox OR admin on the team.
  if (row.ownerUserId !== staff.id && !hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Only the inbox owner or an admin can edit this signature." };
  }

  // Sanitise + cap the size — signatures shouldn't be giant. 16KB is
  // generous (gmail's typical signature is < 2KB).
  const value = (input.signatureHtml ?? "").trim();
  if (value.length > 16_384) {
    return { ok: false, error: "Signature too large (16KB max)." };
  }

  try {
    await db
      .update(connectedAccounts)
      .set({ signatureHtml: value === "" ? null : value, updatedAt: new Date() })
      .where(eq(connectedAccounts.id, input.connectedAccountId));
    return { ok: true, signatureHtml: value === "" ? null : value };
  } catch (err) {
    logger.error({ err, connectedAccountId: input.connectedAccountId }, "setInboxSignature failed");
    return { ok: false, error: "Couldn't save signature." };
  }
}

/**
 * Save a draft's current subject + body as a new email template.
 *
 * Admin-only — operators on the team can use existing templates but
 * shouldn't be able to add to the canonical template library without
 * curation. Stage defaults to 'custom' since composer-saved templates
 * aren't part of any automatic cadence.
 *
 * Outreach brand is inferred from the inbox's team. If the team has
 * multiple outreach brands, the operator must pass outreachBrandId
 * explicitly; otherwise we auto-pick the single one. (Per
 * DECISIONS.md#010 emails go BY outreach brands, so every team has
 * at least one.)
 */
export async function saveDraftAsTemplate(input: {
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  outreachBrandId?: string | null;
  stage?: "cold" | "follow_up_1" | "follow_up_2" | "custom";
}): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Only admins can save templates." };
  }

  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.bodyText.trim();
  if (!name) return { ok: false, error: "Template name is required." };
  if (!subject) return { ok: false, error: "Template subject is required." };
  if (!body) return { ok: false, error: "Template body is empty." };
  if (name.length > 100) return { ok: false, error: "Template name too long (100 char max)." };

  // Pick the outreach brand. Brands are global (not team-scoped), so
  // an admin saving a template must specify which brand it belongs to
  // when more than one exists. Auto-pick when only one is configured.
  let brandId = input.outreachBrandId ?? null;
  if (!brandId) {
    const brands = await db.select({ id: outreachBrands.id }).from(outreachBrands).limit(2);
    if (brands.length === 0) {
      return { ok: false, error: "No outreach brand configured." };
    }
    if (brands.length > 1) {
      return {
        ok: false,
        error: "Multiple outreach brands — pick one explicitly.",
      };
    }
    brandId = brands[0]?.id ?? null;
    if (!brandId) {
      return { ok: false, error: "Could not resolve outreach brand." };
    }
  } else {
    const [b] = await db
      .select({ id: outreachBrands.id })
      .from(outreachBrands)
      .where(eq(outreachBrands.id, brandId))
      .limit(1);
    if (!b) return { ok: false, error: "Brand not found." };
  }

  const stage = input.stage ?? "custom";

  try {
    const [row] = await db
      .insert(emailTemplates)
      .values({
        outreachBrandId: brandId,
        stage,
        name,
        subjectTemplate: subject,
        bodyTemplateText: body,
        bodyTemplateHtml: input.bodyHtml ?? null,
        isDefaultForStage: false,
        createdBy: staff.id,
        updatedBy: staff.id,
      })
      .returning({ id: emailTemplates.id });
    if (!row) throw new Error("emailTemplates insert returned no rows");
    return { ok: true, templateId: row.id };
  } catch (err) {
    // Unique-constraint violation on (brand, stage, name) is the
    // most likely failure — surface a clearer message.
    if (err instanceof Error && /unique/i.test(err.message)) {
      return {
        ok: false,
        error: "A template with that name + stage already exists for this brand.",
      };
    }
    logger.error({ err, name, brandId }, "saveDraftAsTemplate failed");
    return { ok: false, error: "Couldn't save template." };
  }
}

/**
 * Suggest recipient addresses for the composer's autocomplete.
 *
 * Sources, in order:
 *   1) Venue primary email + alternate_emails when venueId is given
 *   2) Previously-emailed addresses from email_threads on this venue
 *      (most-recent first, deduped against #1)
 *   3) Most-recent outbound addresses across the operator's team
 *      (top 20) when no venueId — generic "people you've emailed"
 *
 * Returns at most LIMIT (15) addresses to keep the popover scannable.
 *
 * Auth: requireStaff. Team-scoped for non-venue results so we never
 * leak addresses across teams.
 */
/**
 * Resolve display names for recipient addresses, for the composer's
 * Gmail-style "name <email>" chips. Returns lowercased-email -> name.
 * A name comes from a matching venue (primary email) or, failing that,
 * the most recent INBOUND message from that address (its from_name --
 * "the name the email was received as"). Best-effort; addresses with no
 * known name are omitted (the chip then shows the raw address).
 */
export async function resolveRecipientNames(emails: string[]): Promise<Record<string, string>> {
  await requireStaff();
  const original = Array.from(
    new Set(emails.map((e) => e.trim()).filter((e) => e.includes("@"))),
  ).slice(0, 50);
  if (original.length === 0) return {};
  const lower = original.map((e) => e.toLowerCase());
  const out: Record<string, string> = {};

  try {
    const venueRows = await db
      .select({ email: venues.email, name: venues.name })
      .from(venues)
      .where(inArray(venues.email, original))
      .limit(200);
    for (const v of venueRows) {
      const key = v.email?.toLowerCase();
      if (key && v.name?.trim()) out[key] = v.name.trim();
    }
  } catch (err) {
    logger.warn({ err }, "resolveRecipientNames: venue lookup failed");
  }

  const stillUnnamed = lower.filter((e) => !out[e]);
  if (stillUnnamed.length > 0) {
    try {
      const msgRows = await db
        .select({ from: emailMessages.fromEmailNormalized, name: emailMessages.fromName })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.direction, "inbound"),
            inArray(emailMessages.fromEmailNormalized, stillUnnamed),
          ),
        )
        .orderBy(desc(emailMessages.sentAt))
        .limit(300);
      for (const m of msgRows) {
        const key = m.from?.toLowerCase();
        if (key && !out[key] && m.name?.trim()) out[key] = m.name.trim();
      }
    } catch (err) {
      logger.warn({ err }, "resolveRecipientNames: from_name lookup failed");
    }
  }
  return out;
}

export async function suggestRecipients(input: {
  venueId?: string | null;
  query?: string;
  /** Optional inbox to use for the Gmail Contacts lookup. When set,
   *  we hit the People API as that operator and merge results in.
   *  When absent (or the inbox isn't on the team), we skip the
   *  remote lookup and use only venue/team-recent suggestions. */
  fromAccountId?: string | null;
}): Promise<
  Array<{
    email: string;
    /** Where this address came from — drives the row icon. */
    source: "venue_primary" | "venue_alt" | "venue_thread" | "team_recent" | "gmail_contact";
    /** Optional display label (venue name / contact label). */
    label?: string | null;
  }>
> {
  const LIMIT = 15;
  const { staff } = await requireStaff();
  const queryLower = (input.query ?? "").trim().toLowerCase();

  const seen = new Set<string>();
  const results: Array<{
    email: string;
    source: "venue_primary" | "venue_alt" | "venue_thread" | "team_recent" | "gmail_contact";
    label?: string | null;
  }> = [];

  function tryAdd(
    email: string | null | undefined,
    source: "venue_primary" | "venue_alt" | "venue_thread" | "team_recent" | "gmail_contact",
    label?: string | null,
  ) {
    if (!email) return;
    const e = email.trim();
    if (!e) return;
    const key = e.toLowerCase();
    if (seen.has(key)) return;
    if (queryLower && !key.includes(queryLower)) return;
    if (results.length >= LIMIT) return;
    seen.add(key);
    results.push({ email: e, source, label });
  }

  if (input.venueId && UUID_RE.test(input.venueId)) {
    const [v] = await db
      .select({
        email: venues.email,
        alternateEmails: venues.alternateEmails,
        name: venues.name,
      })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1);
    if (v) {
      tryAdd(v.email, "venue_primary", v.name);
      for (const alt of v.alternateEmails ?? []) tryAdd(alt, "venue_alt", v.name);
    }

    // Previously-emailed addresses on this venue.
    const recentThreads = await db
      .select({
        to: emailMessages.toAddresses,
        cc: emailMessages.ccAddresses,
      })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .where(and(eq(emailThreads.venueId, input.venueId), eq(emailMessages.direction, "outbound")))
      .orderBy(desc(emailMessages.sentAt))
      .limit(20);
    for (const r of recentThreads) {
      for (const addr of r.to ?? []) tryAdd(addr, "venue_thread");
      for (const addr of r.cc ?? []) tryAdd(addr, "venue_thread");
    }

    // Inbound SENDERS on this venue's threads — people who emailed US
    // (synced correspondence), not only addresses we sent to. Without
    // this, autocomplete worked for dashboard-sent recipients but not for
    // contacts from previously-synced inbound email.
    const inboundVenue = await db
      .select({ from: emailMessages.fromEmailNormalized })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .where(and(eq(emailThreads.venueId, input.venueId), eq(emailMessages.direction, "inbound")))
      .orderBy(desc(emailMessages.sentAt))
      .limit(20);
    for (const r of inboundVenue) tryAdd(r.from, "venue_thread");
  }

  // Fill remaining slots with most-recent team-wide outbound addresses.
  if (results.length < LIMIT) {
    const recent = await db
      .select({
        to: emailMessages.toAddresses,
      })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(
        and(eq(connectedAccounts.teamId, staff.teamId), eq(emailMessages.direction, "outbound")),
      )
      .orderBy(desc(emailMessages.sentAt))
      .limit(40);
    for (const r of recent) {
      for (const addr of r.to ?? []) tryAdd(addr, "team_recent");
    }
  }

  // Fill remaining slots with most-recent team-wide INBOUND senders —
  // synced contacts who have emailed us (the "Contacts" the operator
  // expects to autocomplete), not just people we've sent to.
  if (results.length < LIMIT) {
    const recentInbound = await db
      .select({ from: emailMessages.fromEmailNormalized })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(
        and(eq(connectedAccounts.teamId, staff.teamId), eq(emailMessages.direction, "inbound")),
      )
      .orderBy(desc(emailMessages.sentAt))
      .limit(40);
    for (const r of recentInbound) tryAdd(r.from, "team_recent");
  }

  // Gmail Contacts (People API) — only when the caller specified an
  // inbox (so we know whose contacts to query) and when we still have
  // room in the result set. Skips entirely when the user hasn't typed
  // anything yet (the People API's search endpoint requires a query).
  if (
    input.fromAccountId &&
    UUID_RE.test(input.fromAccountId) &&
    queryLower &&
    results.length < LIMIT
  ) {
    try {
      const [inbox] = await db
        .select({
          token: connectedAccounts.gmailOauthRefreshToken,
        })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.id, input.fromAccountId),
            eq(connectedAccounts.teamId, staff.teamId),
          ),
        )
        .limit(1);
      if (inbox?.token) {
        const contacts = await searchGmailContacts({
          encryptedRefreshToken: inbox.token,
          query: input.query ?? "",
          limit: LIMIT - results.length,
        });
        for (const c of contacts) tryAdd(c.email, "gmail_contact", c.displayName);
      }
    } catch (err) {
      // Best-effort — autocomplete shouldn't surface People API
      // failures (most often: scope not granted yet, expired token).
      logger.warn(
        { err, fromAccountId: input.fromAccountId },
        "searchGmailContacts within suggestRecipients failed",
      );
    }
  }

  return results;
}

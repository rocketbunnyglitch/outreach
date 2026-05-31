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
  cities,
  connectedAccounts,
  emailMessages,
  emailTemplates,
  emailThreads,
  outreachBrands,
  users,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchGmailContacts } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import type { SendUsage } from "@/lib/send-cap";
import { startOfLocalDay } from "@/lib/send-cap";
import type { DncBlock, DuplicateWarning, SuppressionBlock } from "@/lib/send-safety";
import { type TeamLabelSummary, listTeamLabels } from "@/lib/team-labels";
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
  if (usable.length > 0) {
    const capRows = await db
      .select({ id: connectedAccounts.id, cap: connectedAccounts.dailyColdSendCap })
      .from(connectedAccounts)
      .where(
        inArray(
          connectedAccounts.id,
          usable.map((r) => r.id),
        ),
      );
    for (const c of capRows) capMap.set(c.id, c.cap ?? 30);
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
  stage: string;
  brandId: string;
  brandName: string;
  isDefaultForStage: boolean;
  /** Raw subject template (Mustache-style merge fields). */
  subjectTemplate: string;
  /** Raw text body template. */
  bodyTemplateText: string;
}

export interface ComposeRenderContext {
  /** Mirrors lib/template-render RenderContext but trimmed for the
   *  fields we can populate from a venue + staff. */
  venue?: {
    name?: string;
    city?: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  };
  staff?: { displayName?: string; primaryEmail?: string };
}

export async function listComposeContext(opts: { venueId?: string | null } = {}): Promise<{
  inboxes: ConnectedAccountOption[];
  labels: TeamLabelSummary[];
  templates: ComposeTemplate[];
  renderContext: ComposeRenderContext;
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

  // Build the render context. Staff always populates; venue only
  // when the caller passed venueId. Fields the template references
  // but we can't resolve will render as `[??field.path??]` markers
  // — that's the desired UX so the operator sees broken merges
  // before they hit Send.
  const renderContext: ComposeRenderContext = {
    staff: {
      displayName: staff.displayName ?? undefined,
      primaryEmail: staff.primaryEmail ?? undefined,
    },
  };

  if (opts.venueId && UUID_RE.test(opts.venueId)) {
    const venueRow = await db
      .select({
        name: venues.name,
        cityName: cities.name,
        phone: venues.phoneE164,
        email: venues.email,
        website: venues.websiteUrl,
      })
      .from(venues)
      .leftJoin(cities, eq(cities.id, venues.cityId))
      .where(eq(venues.id, opts.venueId))
      .limit(1);
    const v = venueRow[0];
    if (v) {
      renderContext.venue = {
        name: v.name ?? undefined,
        city: v.cityName ?? undefined,
        phone: v.phone,
        email: v.email,
        website: v.website,
      };
    }
  }

  return { inboxes, labels, templates: templateRows, renderContext };
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
      /** Set when a hard block (suppression or DNC) blocked the send.
       *  No bypass — operator must fix the underlying state
       *  (un-suppress / clear DNC) before retrying. */
      safetyBlock?: SuppressionBlock | DncBlock;
      /** Set when the send is OK but there are duplicate-outreach
       *  warnings the operator must acknowledge. UI shows a confirm
       *  step that re-submits with ackDuplicates=1. */
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
  if (row.ownerUserId !== staff.id && staff.role !== "admin") {
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
  if (staff.role !== "admin") {
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

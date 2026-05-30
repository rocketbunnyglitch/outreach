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
  emailTemplates,
  outreachBrands,
  users,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { SendUsage } from "@/lib/send-cap";
import type { DncBlock, DuplicateWarning, SuppressionBlock } from "@/lib/send-safety";
import { type TeamLabelSummary, listTeamLabels } from "@/lib/team-labels";
import { asc, desc, eq, inArray, isNull } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConnectedAccountOption {
  id: string;
  emailAddress: string;
  ownerDisplayName: string | null;
  /** "mine" if owned by current user; "team" otherwise. UI uses this
   *  to group + sort the dropdown so the user's own accounts come first. */
  scope: "mine" | "team";
  status: "connected" | "needs_reauth" | "disconnected";
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

  const opts: ConnectedAccountOption[] = usable.map((r) => ({
    id: r.id,
    emailAddress: r.emailAddress,
    ownerDisplayName: r.ownerUserId ? (ownerNameMap.get(r.ownerUserId) ?? null) : null,
    scope: r.ownerUserId === staff.id ? "mine" : "team",
    status: r.status as ConnectedAccountOption["status"],
  }));

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
